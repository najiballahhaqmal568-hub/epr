// Local-only: real sync + IndexedDB, fake transport. Never contacts Supabase.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5192/sync-safety'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5192', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage()
  await page.route('**/*', async route => {
    const request = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
    if (request.pathname === '/sync-safety') return route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' })
    if (request.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa() { return window.testServer }; export async function getProfile() { return { shop_id: "test-shop", role: "owner" } }' })
    return route.continue()
  })
  await page.goto(url)
  const result = await page.evaluate(async () => {
    const { db, SYNC_TABLES } = await import('/src/db.ts')
    const { syncNow } = await import('/src/lib/sync.ts')
    await db.open()
    for (const name of SYNC_TABLES) await db.table(name).clear()
    const stamp = '2026-09-01T12:00:00.000000+00:00'
    const remote = Array.from({ length: 1001 }, (_, i) => ({
      uuid: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`,
      generation: 0, updated_at: stamp, device_id: 'other-device', deleted: false,
      data: { name: `Customer ${i}`, type: 'retail', balance: 0, createdAt: 1 }
    }))
    let interruptBoundary = false
    window.testServer = {
      auth: { getSession: async () => ({ data: { session: {} } }) },
      from(table) {
        let filters = [], orders = [], limit = 1000
        const query = {
          select() { return query },
          eq(key, value) { filters.push(row => row[key] === value); return query },
          gt(key, value) { filters.push(row => row[key] > value); return query },
          gte(key, value) { filters.push(row => row[key] >= value); return query },
          or(expression) {
            const match = expression.match(/^updated_at.gt.(.+),and\(updated_at.eq.(.+),uuid.gt.(.+)\)$/)
            if (!match) throw new Error(`Unsupported test filter: ${expression}`)
            filters.push(row => row.updated_at > match[1] || (row.updated_at === match[2] && row.uuid > match[3]))
            return query
          },
          order(key) { orders.push(key); return query },
          limit(value) { limit = value; return query },
          single: async () => ({ data: { restore_generation: 0 } }),
          upsert: async () => ({ error: null }),
          then(resolve, reject) {
            return Promise.resolve().then(() => {
              const data = (table === 'customers' ? remote : [])
              .filter(row => filters.every(filter => filter(row)))
              .sort((a, b) => { for (const key of orders) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1 } return 0 })
              .slice(0, limit)
              if (interruptBoundary && table === 'customers' && data[0]?.uuid === remote[1000].uuid) {
                interruptBoundary = false
                return { data: null, error: { message: 'simulated interrupted download' } }
              }
              return { data, error: null }
            }).then(resolve, reject)
          }
        }
        return query
      }
    }
    await syncNow(true)
    const first = await db.customers.count()
    await syncNow(true)
    const second = await db.customers.count()
    // Legacy timestamp-only cursors must replay their boundary to recover ties.
    await db.customers.clear()
    await db.syncState.delete('pullUuid:customers')
    await db.syncState.put({ key: 'pull:customers', value: stamp })
    await syncNow(true)
    const legacy = await db.customers.count()
    await db.customers.clear()
    await db.syncState.bulkDelete(['pull:customers', 'pullUuid:customers'])
    interruptBoundary = true
    let interrupted = false
    try { await syncNow(true) } catch { interrupted = true }
    const partial = await db.customers.count()
    const errorState = window.__syncStatus.state
    await syncNow(true)
    const resumed = await db.customers.count()
    await db.syncState.put({ key: 'restorePending', value: true })
    let blocked = false
    try { await syncNow(true) } catch { blocked = true }
    return { first, second, legacy, interrupted, partial, errorState, resumed, blocked, preserved: await db.customers.count() }
  })
  console.log(result)
  assert.equal(result.first, 1001, 'One sync must receive every row, including equal-timestamp page boundaries')
  assert.equal(result.second, 1001, 'Repeating sync must not duplicate rows')
  assert.equal(result.legacy, 1001, 'Legacy cursors must recover equal-timestamp rows')
  assert.equal(result.interrupted, true, 'A failed download must reject, not report success')
  assert.equal(result.partial, 1000, 'A failed page must not undo completed pages')
  assert.equal(result.errorState, 'error', 'Incomplete download must not show synchronized')
  assert.equal(result.resumed, 1001, 'Retry must resume at the failed boundary without duplicates')
  assert.equal(result.blocked, true, 'Interrupted restore must block ordinary sync')
  assert.equal(result.preserved, 1001, 'Blocked sync must preserve local data')
  console.log('PASS: complete paginated pull; retry idempotence; legacy boundary recovery; interrupted-restore guard')
} finally { await browser?.close(); server.kill() }
