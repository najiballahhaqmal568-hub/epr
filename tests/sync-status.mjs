// Isolated browser + real IndexedDB/sync; no external requests or real accounts.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5193/sync-status'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5193', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/*', route => {
    const request = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
    // Let Vite provide the React refresh preamble; replace only the app entry.
    if (request.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    if (request.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa() { return window.testServer }; export async function getProfile() { return { shop_id: "test-shop", role: "owner" } }' })
    return route.continue()
  })
  await page.goto(url)
  const failures = []
  function check(name, actual, expected) { if (actual !== expected) failures.push(`${name}: ${actual} !== ${expected}`) }
  const result = await page.evaluate(async () => {
    const { db, SYNC_TABLES } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    await db.open()
    for (const table of SYNC_TABLES) await db.table(table).clear()
    function StatusProbe() { window.observedStatus = sync.useSyncStatus(); return React.createElement('output', null, JSON.stringify(window.observedStatus)) }
    const probe = document.createElement('div'); probe.hidden = true; document.body.append(probe)
    ReactDOM.createRoot(probe).render(React.createElement(StatusProbe))
    let signedIn = true, fail = false, clock = 1800000000000
    Date.now = () => clock
    window.advanceTestClock = () => { clock += 1000 }
    window.testServer = {
      auth: { getSession: async () => ({ data: { session: signedIn ? {} : null } }) },
      from() {
        const query = {
          select: () => query, eq: () => query, gt: () => query, gte: () => query,
          or: () => query, order: () => query, limit: () => query,
          single: async () => ({ data: { restore_generation: 0 } }),
          upsert: async () => ({ error: fail ? { message: 'test upload failed' } : null }),
          then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject)
        }
        return query
      }
    }
    window.setTestFailure = value => { fail = value }
    const rejects = async fn => { try { await fn(); return false } catch { return true } }
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    const offlineRejected = await rejects(() => sync.syncNow(true))
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    signedIn = false
    const loggedOutRejected = await rejects(() => sync.syncNow(true))
    signedIn = true
    await sync.syncNow(true)
    await db.customers.add({ name: 'Local test customer', type: 'retail', balance: 0, createdAt: clock })
    return { offlineRejected, loggedOutRejected }
  })
  check('strict offline sync rejects', result.offlineRejected, true)
  check('strict logged-out sync rejects', result.loggedOutRejected, true)
  // Poll rendering, not network timing. The record is created after a successful sync.
  try { await page.waitForFunction(() => window.observedStatus?.pending === 1, { timeout: 4000 }) }
  catch { failures.push('new local record is not reflected in pending count') }
  const successTime = await page.evaluate(() => window.observedStatus.lastSync)
  check('successful sync time exists', typeof successTime, 'number')
  await page.evaluate(async () => { window.advanceTestClock(); await (await import('/src/lib/sync.ts')).syncNow(true) })
  try { await page.waitForFunction(() => window.observedStatus?.pending === 0, { timeout: 4000 }) }
  catch { failures.push('acknowledged upload is still pending') }
  const persisted = await page.evaluate(async () => (await (await import('/src/db.ts')).db.syncState.get('lastSuccessfulSync'))?.value)
  check('successful sync time persists', typeof persisted, 'number')
  await page.evaluate(async () => {
    const { db, syncFlags } = await import('/src/db.ts')
    const { syncNow } = await import('/src/lib/sync.ts')
    window.advanceTestClock()
    await db.customers.update(1, { deleted: true })
    syncFlags.applyingRemote = true
    try { await db.customers.add({ name: 'Remote customer', type: 'retail', balance: 0, createdAt: 1 }) }
    finally { syncFlags.applyingRemote = false }
    window.setTestFailure(true)
    await syncNow()
  })
  await page.waitForFunction(() => window.observedStatus.state === 'error' && window.observedStatus.pending === 1)
  check('failure preserves success time', await page.evaluate(() => window.observedStatus.lastSync), persisted)
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Details } = await import('/src/components/SyncDetails.tsx')
    const host = document.createElement('div'); document.body.append(host)
    ReactDOM.createRoot(host).render(React.createElement(Details))
  })
  await page.getByRole('heading', { name: 'وضعیت همگام‌سازی' }).waitFor()
  await page.getByText('جزئیات خطا', { exact: true }).focus()
  await page.keyboard.press('Enter')
  await page.getByText('customers: test upload failed', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'تلاش دوباره' }).click()
  await page.waitForFunction(() => window.observedStatus.state === 'error')
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
    window.dispatchEvent(new Event('offline'))
  })
  await page.getByText('آفلاین', { exact: true }).waitFor()
  check('offline retry disabled', await page.getByRole('button', { name: 'همگام‌سازی اکنون' }).isDisabled(), true)
  await page.screenshot({ path: 'qa-sync-status-offline.png', fullPage: true })
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    check(`no overflow at ${width}px`, await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  const lifecycle = await page.evaluate(async () => {
    const sync = await import('/src/lib/sync.ts')
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
    window.setTestFailure(false)
    const auth = window.testServer.auth
    const original = auth.getSession
    let release
    auth.getSession = () => new Promise(resolve => { release = resolve })
    const first = sync.syncNow(true)
    await new Promise(resolve => setTimeout(resolve, 0))
    let busyRejected = false
    try { await sync.syncNow(true) } catch { busyRejected = true }
    release({ data: { session: {} } })
    await first
    let calls = 0
    auth.getSession = async () => { calls++; return original() }
    sync.startSync()
    await new Promise(resolve => setTimeout(resolve, 100))
    sync.stopSync()
    calls = 0
    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('online'))
    await new Promise(resolve => setTimeout(resolve, 100))
    return { busyRejected, afterStop: calls }
  })
  check('concurrent strict sync rejects instead of pretending success', lifecycle.busyRejected, true)
  check('stop removes auto-sync event handlers', lifecycle.afterStop, 0)
  await page.reload()
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Details } = await import('/src/components/SyncDetails.tsx')
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Details))
  })
  await page.locator('time').waitFor()
  const savedAfterReload = await page.evaluate(async () => (await (await import('/src/db.ts')).db.syncState.get('lastSuccessfulSync')).value)
  check('success survives reload', await page.locator('time').getAttribute('datetime'), new Date(savedAfterReload).toISOString())
  await page.unroute('**/*')
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('http://localhost:5193/?ui-preview')
  await page.getByRole('heading', { name: 'میز فروش' }).waitFor()
  await page.getByRole('button', { name: /^وضعیت همگام‌سازی:/ }).click()
  await page.getByRole('heading', { name: 'وضعیت همگام‌سازی', exact: true }).waitFor()
  await page.screenshot({ path: 'qa-sync-status-in-app.png', fullPage: true })
  console.log(failures.length ? failures : 'PASS: strict sync failures, live pending count, persisted success time')
  assert.deepEqual(failures, [])
} finally { await browser?.close(); server.kill() }
