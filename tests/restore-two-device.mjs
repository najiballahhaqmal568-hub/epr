/**
 * Focused end-to-end test for authoritative backup restore.
 * Creates a disposable shop, never touches a real owner's data.
 *
 * Run Vite on port 4191, then: node tests/restore-two-device.mjs
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const SUPA_URL = 'https://xkvpdeguayorxzvjgpmv.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrdnBkZWd1YXlvcnh6dmpncG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1ODMyNzUsImV4cCI6MjA5OTE1OTI3NX0.tECj4Lx4wSO5ogtXbIVe2pQh2Su7HzHZV6EEzDU2jgE'
const APP_URL = 'http://127.0.0.1:4191/'
const suffix = `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`
const email = `test.restore.${suffix}@gmail.com`
const password = 'test123456'

const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)
const executablePath = candidates.find((candidate) => existsSync(candidate))
if (!executablePath) throw new Error('Chromium/Chrome/Edge not found; set CHROMIUM_PATH')

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
let failures = 0
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures++
  console.log(`${ok ? '✅' : '❌'} ${name}:`, actual, ok ? '' : `(expected ${JSON.stringify(expected)})`)
}

async function newDevice() {
  const context = await browser.newContext()
  await context.route(`${SUPA_URL}/**`, async (route) => {
    const request = route.request()
    try {
      const headers = { ...request.headers() }
      delete headers['accept-encoding']
      const response = await fetch(request.url(), {
        method: request.method(),
        headers,
        body: ['GET', 'HEAD'].includes(request.method()) ? undefined : request.postDataBuffer()
      })
      const responseHeaders = {}
      response.headers.forEach((value, key) => {
        if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key)) responseHeaders[key] = value
      })
      await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) })
    } catch {
      await route.abort('failed').catch(() => {})
    }
  })
  const page = await context.newPage()
  await page.goto(APP_URL)
  return { context, page }
}

async function configure(page) {
  await page.evaluate(async ({ url, anonKey }) => {
    const { setServerConfig } = await import('/src/lib/supa.ts')
    await setServerConfig({ url, anonKey })
  }, { url: SUPA_URL, anonKey: SUPA_KEY })
}

async function sync(page) {
  await page.evaluate(async () => {
    const { syncNow } = await import('/src/lib/sync.ts')
    await syncNow(true)
  })
}

async function customerState(page) {
  return page.evaluate(async () => {
    const db = (await import('/src/db.ts')).db
    return {
      names: (await db.customers.filter((row) => !row.deleted).toArray()).map((row) => row.name).sort(),
      generation: (await db.syncState.get('restoreGeneration'))?.value
    }
  })
}

try {
  const a = await newDevice()
  await configure(a.page)
  await a.page.evaluate(async ({ email, password }) => {
    const { registerOwner } = await import('/src/lib/supa.ts')
    const { db, newUuid } = await import('/src/db.ts')
    await registerOwner(email, password, 'Restore owner', 'Disposable restore shop')
    await db.customers.add({
      uuid: newUuid(),
      name: 'baseline',
      type: 'retail',
      balance: 0,
      createdAt: Date.now(),
      localUpdatedAt: Date.now()
    })
  }, { email, password })
  await sync(a.page)
  const backup = await a.page.evaluate(async () => (await import('/src/lib/ops.ts')).exportBackup())

  const b = await newDevice()
  await configure(b.page)
  await b.page.evaluate(async ({ email, password }) => {
    const { login } = await import('/src/lib/supa.ts')
    await login(email, password)
  }, { email, password })
  await sync(b.page)
  check('device B receives baseline', (await customerState(b.page)).names, ['baseline'])

  await b.page.evaluate(async () => {
    const { db, newUuid } = await import('/src/db.ts')
    await db.customers.add({
      uuid: newUuid(),
      name: 'later server change',
      type: 'retail',
      balance: 0,
      createdAt: Date.now(),
      localUpdatedAt: Date.now()
    })
  })
  await sync(b.page)
  await sync(a.page)
  check('later change reaches device A before restore', (await customerState(a.page)).names, ['baseline', 'later server change'])

  await a.page.evaluate(async (backup) => {
    const { importBackup } = await import('/src/lib/ops.ts')
    await importBackup(backup, 'replace')
  }, backup)
  await sync(b.page)
  await sync(a.page)
  await sync(b.page)

  const restoredA = await customerState(a.page)
  const restoredB = await customerState(b.page)
  check('device A matches authoritative backup', restoredA.names, ['baseline'])
  check('stale device B cannot resurrect later change', restoredB.names, ['baseline'])
  check('both devices use the same restore generation', restoredB.generation, restoredA.generation)
  check('restore generation increased', Number(restoredA.generation) > 0, true)

  await a.context.close()
  await b.context.close()
} finally {
  await browser.close()
}

console.log(failures === 0 ? '\n✅ authoritative two-device restore passed' : `\n❌ ${failures} restore checks failed`)
process.exit(failures === 0 ? 0 : 1)
