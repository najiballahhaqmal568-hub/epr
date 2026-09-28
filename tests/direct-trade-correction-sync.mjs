// Local-only: a trade corrected, a payment replaced, and the trade cancelled on device A
// must rebuild exactly the same balances, till and trade state on device B through real sync.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5201/direct-trade-correction-sync'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5201', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--no-sandbox'] })
  const remote = new Map()
  let clock = 0
  const install = async context => {
    const page = await context.newPage()
    await page.route('**/*', route => {
      const request = new URL(route.request().url())
      if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
      if (request.pathname === '/direct-trade-correction-sync') return route.fulfill({ contentType: 'text/html', body: '<html></html>' })
      if (request.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa(){return window.testServer}; export async function getProfile(){return {shop_id:"test-shop",role:"owner"}}' })
      return route.continue()
    })
    await page.goto(url)
    await page.exposeFunction('remoteQuery', async ({ table, filters, orders, limit }) => {
      const rows = [...(remote.get(table) ?? new Map()).values()].filter(row => filters.every(([kind, key, value]) => kind === 'eq' ? row[key] === value : kind === 'gte' ? row[key] >= value : row[key] > value))
      rows.sort((a, b) => { for (const key of orders) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1 } return 0 })
      return rows.slice(0, limit)
    })
    await page.exposeFunction('remoteUpsert', async ({ table, rows }) => {
      if (!remote.has(table)) remote.set(table, new Map())
      for (const row of rows) { clock++; remote.get(table).set(row.uuid, { ...row, updated_at: `2026-09-08T00:${String(Math.floor(clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}Z` }) }
    })
    await page.evaluate(() => {
      window.testServer = {
        auth: { getSession: async () => ({ data: { session: {} } }) },
        from(table) {
          let filters = [], orders = [], limit = 1000
          const q = { select() { return q }, eq(k, v) { filters.push(['eq', k, v]); return q }, gt(k, v) { filters.push(['gt', k, v]); return q }, gte(k, v) { filters.push(['gte', k, v]); return q },
            or(expression) { const m = expression.match(/^updated_at.gt.(.+),and\(updated_at.eq.(.+),uuid.gt.(.+)\)$/); q._or = m; return q }, order(k) { orders.push(k); return q }, limit(v) { limit = v; return q },
            single: async () => ({ data: { restore_generation: 0 } }), upsert: async rows => { await window.remoteUpsert({ table, rows }); return { error: null } },
            then(resolve, reject) { return window.remoteQuery({ table, filters, orders, limit }).then(data => resolve({ data: data.filter(row => !q._or || row.updated_at > q._or[1] || (row.updated_at === q._or[2] && row.uuid > q._or[3])), error: null }), reject) } }
          return q
        }
      }
    })
    return page
  }
  const a = await install(await browser.newContext()), b = await install(await browser.newContext())
  const CUSTOMER = '11111111-1111-4111-8111-111111111111', SUPPLIER = '22222222-2222-4222-8222-222222222222'
  const seed = (page, padding) => page.evaluate(async ({ padding, CUSTOMER, SUPPLIER }) => {
    const { db, SYNC_TABLES } = await import('/src/db.ts'); await db.open()
    for (const t of SYNC_TABLES) await db.table(t).clear(); await db.syncState.clear()
    await db.settings.put({ key: 'directTrades.enabled', value: true })
    await db.settings.put({ key: 'cachedProfile', value: { role: 'owner', shop_id: 'test-shop' } })
    // Different local numeric IDs on each device prove references travel by UUID.
    for (let i = 0; i < padding; i++) await db.customers.add({ uuid: `pad-${i}`, name: 'pad', type: 'retail', balance: 0, deleted: true })
    for (let i = 0; i < padding; i++) await db.suppliers.add({ uuid: `spad-${i}`, name: 'pad', balance: 0, deleted: true })
    await db.customers.add({ uuid: CUSTOMER, name: 'مشتری', type: 'wholesale', balance: 0 })
    await db.suppliers.add({ uuid: SUPPLIER, name: 'فروشنده', kind: 'supplier', balance: 0 })
  }, { padding, CUSTOMER, SUPPLIER })
  await seed(a, 0); await seed(b, 3)
  const view = page => page.evaluate(async ({ CUSTOMER, SUPPLIER }) => {
    const { db } = await import('/src/db.ts')
    const { loadDirectTrade } = await import('/src/lib/directTradeState.ts')
    const { cashBalance } = await import('/src/lib/ops.ts')
    const { runIntegrityCheck } = await import('/src/lib/integrity.ts')
    const state = await loadDirectTrade('33333333-3333-4333-8333-333333333333')
    return {
      customer: (await db.customers.where('uuid').equals(CUSTOMER).first()).balance,
      supplier: (await db.suppliers.where('uuid').equals(SUPPLIER).first()).balance,
      cash: await cashBalance('دکان'), status: state.status, totals: state.totals,
      remaining: [state.balances.customerRemaining, state.balances.supplierRemaining],
      payments: state.payments.map(p => [p.directPayment.route, p.amount]).sort(),
      mismatches: (await runIntegrityCheck()).mismatches.length
    }
  }, { CUSTOMER, SUPPLIER })
  const sync = page => page.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  const step = async (label, action) => {
    await a.evaluate(action.fn, action.arg)
    await sync(a); await sync(b)
    const [va, vb] = [await view(a), await view(b)]
    assert.deepEqual(vb, va, `${label}: device B must match device A`)
    assert.equal(va.mismatches, 0, `${label}: stored numbers match documents`)
    // Replaying the same rows again changes nothing.
    await sync(b)
    assert.deepEqual(await view(b), va, `${label}: repeated replay is idempotent`)
    return va
  }

  const created = await step('create', { arg: { CUSTOMER, SUPPLIER }, fn: async ({ CUSTOMER, SUPPLIER }) => {
    const { db } = await import('/src/db.ts'); const { createDirectTrade } = await import('/src/lib/directTradeOps.ts')
    const customerId = (await db.customers.where('uuid').equals(CUSTOMER).first()).id
    const supplierId = (await db.suppliers.where('uuid').equals(SUPPLIER).first()).id
    await createDirectTrade({ tradeUuid: '33333333-3333-4333-8333-333333333333', date: 1000, customerId, supplierId,
      lines: [{ lineUuid: '44444444-4444-4444-8444-444444444444', productName: 'بوت', size: '40', color: 'سیاه', qty: 10, unitCost: 1000, unitPrice: 1200 }],
      payments: [
        { eventUuid: '55555555-5555-4555-8555-555555555555', route: 'customerCash', date: 1000, amount: 3000 },
        { eventUuid: '66666666-6666-4666-8666-666666666666', route: 'customerToSupplier', date: 1000, amount: 7000 }
      ] })
  } })
  assert.deepEqual([created.customer, created.supplier, created.cash, created.status], [2000, 3000, 3000, 'ready'])

  const corrected = await step('correct trade', { arg: null, fn: async () => {
    const api = await import('/src/lib/directTradeCorrections.ts')
    const input = { date: 2000, lines: [{ lineUuid: '44444444-4444-4444-8444-444444444444', productName: 'بوت', size: '40', color: 'سیاه', qty: 9, unitCost: 1000, unitPrice: 1200 }], reason: 'یک جوره کم' }
    const preview = await api.previewDirectTradeCorrection('33333333-3333-4333-8333-333333333333', input)
    await api.correctDirectTrade('33333333-3333-4333-8333-333333333333', input, preview.token)
  } })
  assert.deepEqual([corrected.customer, corrected.supplier, corrected.cash, corrected.totals.sale, corrected.status], [800, 2000, 3000, 10800, 'ready'])

  const paymentFixed = await step('correct payment', { arg: null, fn: async () => {
    const api = await import('/src/lib/directTradeCorrections.ts')
    const input = { action: 'replace', date: 1000, amount: 2500, reason: 'کمتر گرفته شد' }
    const preview = await api.previewDirectPaymentCorrection('33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', input)
    await api.correctDirectPayment('33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', input, preview.token)
  } })
  assert.deepEqual([paymentFixed.customer, paymentFixed.cash, paymentFixed.payments], [1300, 2500, [['customerCash', 2500], ['customerToSupplier', 7000]]])

  const cancelled = await step('cancel trade', { arg: null, fn: async () => {
    const api = await import('/src/lib/directTradeCorrections.ts')
    const preview = await api.previewDirectTradeCancellation('33333333-3333-4333-8333-333333333333')
    await api.cancelDirectTrade('33333333-3333-4333-8333-333333333333', 'اشتباه', preview.token)
  } })
  // Paid 9,500 against a cancelled trade → shop owes the customer 9,500; supplier owes the shop 7,000; till unchanged.
  assert.deepEqual([cancelled.customer, cancelled.supplier, cancelled.cash, cancelled.status], [-9500, -7000, 2500, 'cancelled'])
  console.log('PASS: direct trade correction, payment replacement and cancellation converge on a second device with idempotent replay')
} finally { await browser?.close(); server.kill() }
