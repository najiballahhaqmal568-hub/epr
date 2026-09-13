// Isolated IndexedDB only: no production accounts, backups or network writes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5202/direct-backup-check'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5202', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const page = await browser.newPage()
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/direct-backup-check') return route.fulfill({ contentType: 'text/html', body: '<html><body>Local test</body></html>' })
    return route.continue()
  })
  await page.goto(url)
  const result = await page.evaluate(async () => {
    const { db, newUuid } = await import('/src/db.ts')
    const { seed, line, equal, snapshot, rejects } = await import('/tests/direct-trade-fixtures.ts')
    const { createDirectTrade } = await import('/src/lib/directTradeOps.ts')
    const { loadDirectTrade, directFeatureEnabled } = await import('/src/lib/directTradeState.ts')
    const { exportBackup, importBackup, cashBalance } = await import('/src/lib/ops.ts')
    const { stopSync } = await import('/src/lib/sync.ts')
    const f = await seed()
    // Keep legacy SKU/category backfill out of this direct-record preservation check.
    await db.variants.update(f.variantId, { sku: 'BACKUP-40' })
    await db.expenseCategories.add({ name: 'مصرف آزمایشی', isDefault: true })
    const uuid = newUuid()
    await createDirectTrade({ tradeUuid: uuid, date: 1000, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [
      { eventUuid: newUuid(), date: 1000, route: 'customerCash', amount: 3000 },
      { eventUuid: newUuid(), date: 1000, route: 'customerToSupplier', amount: 7000 },
      { eventUuid: newUuid(), date: 1000, route: 'supplierPayment', amount: 2000, sarrafId: f.sarrafId, sarrafAmount: 1000 }
    ] })
    const saved = JSON.parse(await exportBackup())
    // Without the settings filter, merely restoring a backup enables writes on an old device.
    equal(saved.data.settings.some(row => row.key === 'directTrades.enabled'), false)
    const before = await snapshot()
    for (const mutate of [
      data => { data.sales.find(row => row.directTrade).directLines[0].qty = -1 },
      data => { data.payments.find(row => row.directPayment).directPayment.route = 'unknown' },
      data => { data.payments.find(row => row.directPayment?.route === 'customerToSupplier').cashDelta = 100 },
      data => { data.purchases.find(row => row.directTrade).received = true },
      data => { data.sales.find(row => row.directTrade).lines = [{ variantId: f.variantId, qty: 3 }] },
      data => { data.cashMovements.find(row => row.directPaymentUuid).amount += 100 },
      data => { data.sales.find(row => row.directTrade).directLines[0].lineUuid = 'x' },
      data => { data.sales.find(row => row.directTrade).directTrade.creationFingerprint = 12 }
    ]) {
      const bad = structuredClone(saved)
      mutate(bad.data)
      await rejects(() => importBackup(JSON.stringify(bad), 'merge'))
      equal(await snapshot(), before)
      equal(await directFeatureEnabled(), true)
    }
    // An older backup may contain this key: import must ignore it too.
    saved.data.settings.push({ key: 'directTrades.enabled', value: true })
    await importBackup(JSON.stringify(saved), 'merge')
    stopSync()
    const normalize = value => JSON.parse(JSON.stringify(value, (key, child) => key === 'localUpdatedAt' ? undefined : child))
    equal(normalize(await snapshot()), normalize(before))
    equal(await directFeatureEnabled(), false)
    const state = await loadDirectTrade(uuid)
    equal([state.status, state.totals.profit, state.balances.customerRemaining, state.balances.supplierRemaining], ['ready', 2000, 2000, 1000])
    equal([(await db.customers.get(f.customerId)).balance, (await db.suppliers.get(f.supplierId)).balance,
      (await db.suppliers.get(f.sarrafId)).balance, await cashBalance(), (await db.variants.get(f.variantId)).stockQty], [3000, 3000, -3000, 18000, 30])
    // Interrupted download is a valid backup state, not permission to delete its surviving half.
    const partial = JSON.parse(await exportBackup())
    partial.data.purchases = partial.data.purchases.filter(row => !row.directTrade)
    await importBackup(JSON.stringify(partial), 'merge')
    stopSync()
    equal((await loadDirectTrade(uuid)).status, 'incomplete')
    return { passed: 11 }
  })
  assert.equal(result.passed, 11)
  console.log('PASS: direct backup gate exclusion, eight malformed snapshots rejected atomically, accounting/UUID roundtrip and orphan preservation')
} finally {
  await browser?.close()
  server.kill()
}
