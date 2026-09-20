// Real IndexedDB/ops integration. Never uses a production profile or remote service.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'

const port = 5193
const origin = `http://localhost:${port}`
const vite = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), '--port', String(port), '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 200; i++) {
    try { if ((await fetch(origin)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  const executablePath = [process.env.CHROMIUM_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p))
  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  const context = await browser.newContext({ serviceWorkers: 'block' })
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) return route.abort()
    if (url.pathname === '/receipt-test') return route.fulfill({ contentType: 'text/html', body: '<title>Isolated receipt test</title>' })
    return route.continue()
  })
  const page = await context.newPage()
  await page.goto(`${origin}/receipt-test`)
  const result = await page.evaluate(async () => {
    const report = []
    const eq = (got, want, name) => { if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${name}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`); report.push(name) }
    let receipt
    try { receipt = await import('/src/lib/customerGoodsReceiptOps.ts') } catch { receipt = {} }
    eq(typeof receipt.createCustomerGoodsReceipt, 'function', 'dedicated creation export exists')
    const { db, accessFlags } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const { cashBalance } = ops
    const { commercialSaleLines } = await import('/src/lib/commercialLines.ts')
    const rejected = async (work, name) => { let failed = false; try { await work() } catch { failed = true }; eq(failed, true, name) }
    const uuid = () => crypto.randomUUID()
    const sourceId = await db.customers.add({ uuid: uuid(), name: 'source', type: 'wholesale', balance: 10000 })
    await db.settings.put({ key: 'goodsReceiptCompatibilityAcknowledged', value: true })
    const input = { receiptUuid: uuid(), date: 1700000000000, customerId: sourceId, destination: 'warehouse', lines: [{ lineUuid: uuid(), productName: 'Boot', size: '40', color: 'Black', qty: 2, unitCost: 1000 }] }
    const created = await receipt.createCustomerGoodsReceipt(input)
    eq((await db.customers.get(sourceId)).balance, 8000, 'warehouse source debt')
    eq((await db.variants.toArray())[0].stockQty, 2, 'warehouse stock')
    eq((await db.variants.toArray())[0].purchasePrice, 1000, 'warehouse cost')
    eq(await cashBalance(), 0, 'warehouse no cash')
    eq(await db.sales.count(), 0, 'warehouse no sale')
    eq(created.status, 'ready', 'warehouse ready')
    await receipt.createCustomerGoodsReceipt(input)
    eq((await db.customers.get(sourceId)).balance, 8000, 'exact retry no duplicate debt')
    await rejected(() => receipt.createCustomerGoodsReceipt({ ...input, lines: [{ ...input.lines[0], qty: 3 }] }), 'changed retry blocked')
    const preview = await receipt.previewCustomerGoodsReceiptCorrection(input.receiptUuid, { ...input, receiptUuid: uuid(), lines: [{ ...input.lines[0], qty: 3 }] })
    eq(preview.net.sourceDebt, -1000, 'correction previews net debt')
    eq(preview.net.stock, 1, 'correction previews net stock')
    const next = { ...input, receiptUuid: uuid(), lines: [{ ...input.lines[0], qty: 3 }] }
    const corrected = await receipt.correctCustomerGoodsReceipt(input.receiptUuid, next, preview.token, 'quantity correction')
    eq(corrected.status, 'ready', 'corrected ready')
    eq((await db.customers.get(sourceId)).balance, 7000, 'corrected debt')
    eq((await db.variants.toArray()).reduce((n, v) => n + v.stockQty, 0), 3, 'corrected net stock')
    eq((await receipt.loadCustomerGoodsReceipt(input.receiptUuid)).status, 'cancelled', 'original audit retained')
    await receipt.correctCustomerGoodsReceipt(input.receiptUuid, next, preview.token, 'quantity correction')
    eq((await db.customers.get(sourceId)).balance, 7000, 'correction retry idempotent')
    const cancel = await receipt.previewCustomerGoodsReceiptCancellation(next.receiptUuid)
    await receipt.cancelCustomerGoodsReceipt(next.receiptUuid, cancel.token, 'wrong receipt')
    await receipt.cancelCustomerGoodsReceipt(next.receiptUuid, cancel.token, 'wrong receipt')
    eq((await db.customers.get(sourceId)).balance, 10000, 'cancel restores source debt once')
    eq((await db.variants.toArray()).reduce((n, v) => n + v.stockQty, 0), 0, 'cancel restores stock once')
    const buyerId = await db.customers.add({ uuid: uuid(), name: 'buyer', type: 'wholesale', balance: 0 })
    const supplierId = await db.suppliers.add({ uuid: uuid(), name: 'former owner', balance: 9000 })
    const masters = await db.variants.count()
    const onward = { ...input, receiptUuid: uuid(), destination: 'onward', lines: [{ ...input.lines[0], unitPrice: 1300 }], onward: { buyerId, paid: 500 } }
    const sold = await receipt.createCustomerGoodsReceipt(onward)
    eq(sold.status, 'ready', 'onward ready')
    eq((await db.customers.get(sourceId)).balance, 8000, 'onward source debt')
    eq((await db.customers.get(buyerId)).balance, 2100, 'onward buyer debt')
    eq(await cashBalance(), 500, 'onward real cash only')
    eq(commercialSaleLines(sold.sale)[0].unitCost, 1000, 'commercial agreed cost')
    eq(sold.sale.lines.length, 0, 'onward no physical lines')
    eq(sold.totals.profit, 600, 'onward profit')
    eq(await db.variants.count(), masters, 'onward creates no masters')
    eq(await db.purchases.count(), 0, 'no fictional purchases')
    eq((await db.suppliers.get(supplierId)).balance, 9000, 'former owner unchanged')
    await rejected(() => ops.addPayment({ ...sold.payment, id: undefined, uuid: uuid() }), 'generic payment creation blocked')
    await rejected(() => ops.deletePayment(sold.payment.id), 'generic payment delete blocked')
    await rejected(() => ops.previewCustomerPaymentCorrection(sold.payment.id, { amount: 100, date: onward.date }), 'generic payment correction blocked')
    await rejected(() => ops.addSale({ ...sold.sale, id: undefined, uuid: uuid() }), 'generic sale creation blocked')
    await rejected(() => ops.deleteSale(sold.sale.id), 'generic sale delete blocked')
    const { ledgerSaleCancellationPreview } = await import('/src/lib/ledgerSaleCancellation.ts')
    await rejected(() => ledgerSaleCancellationPreview(sold.sale.id, buyerId), 'ledger sale cancellation blocked')
    await rejected(() => ops.addExchange({ date: onward.date, kind: 'customer', refId: sold.sale.id, lines: [], amount: 0, reason: 'exchange', settlement: 'reduceDebt' }, { ...sold.sale, id: undefined, uuid: uuid() }), 'ordinary exchange blocked')
    await rejected(() => ops.addSaleShipping(sold.sale.id, { date: onward.date, total: 100, customerShare: 0, received: 0 }), 'generic shipping blocked')
    await rejected(() => ops.addCustomerReturn({ date: onward.date, kind: 'customer', refId: sold.sale.id, partyId: buyerId, partyName: 'buyer', lines: [], settlement: 'reduceDebt', amount: 100, reason: 'return' }), 'ordinary return blocked')
    accessFlags.readOnly = true
    await rejected(() => receipt.createCustomerGoodsReceipt({ ...input, receiptUuid: uuid() }), 'read only blocked')
    accessFlags.readOnly = false
    const dump = async () => JSON.stringify(await Promise.all(['customers', 'suppliers', 'products', 'variants', 'payments', 'adjustments', 'sales', 'purchases', 'returns', 'cashMovements'].map(t => db.table(t).toArray())))
    for (const [name, mutate] of [
      ['fractional quantity', x => { x.lines[0].qty = 1.5 }], ['zero cost', x => { x.lines[0].unitCost = 0 }],
      ['negative cost', x => { x.lines[0].unitCost = -1 }], ['overflow', x => { x.lines[0].qty = Number.MAX_SAFE_INTEGER }],
      ['over debt', x => { x.lines[0].qty = 100 }], ['self buyer', x => { x.destination = 'onward'; x.lines[0].unitPrice = 1300; x.onward = { buyerId: sourceId, paid: 0 } }],
      ['negative cash', x => { x.destination = 'onward'; x.lines[0].unitPrice = 1300; x.onward = { buyerId, paid: -1 } }],
      ['overpaid', x => { x.destination = 'onward'; x.lines[0].unitPrice = 1300; x.onward = { buyerId, paid: 3000 } }],
      ['fractional price', x => { x.destination = 'onward'; x.lines[0].unitPrice = 1.5; x.onward = { buyerId, paid: 0 } }],
      ['missing source', x => { x.customerId = 999999 }], ['invalid date', x => { x.date = Infinity }],
      ['empty lines', x => { x.lines = [] }], ['duplicate lines', x => { x.lines.push({ ...x.lines[0] }) }]
    ]) {
      const bad = structuredClone(input); bad.receiptUuid = uuid(); mutate(bad)
      const before = await dump()
      await rejected(() => receipt.createCustomerGoodsReceipt(bad), `${name} blocked`)
      eq(await dump(), before, `${name} no partial writes`)
    }
    await db.settings.delete('goodsReceiptCompatibilityAcknowledged')
    eq(await receipt.customerGoodsReceiptFeatureEnabled(), false, 'feature off by default')
    await rejected(() => receipt.createCustomerGoodsReceipt({ ...input, receiptUuid: uuid() }), 'device acknowledgement required')
    await db.settings.put({ key: 'goodsReceiptCompatibilityAcknowledged', value: true })
    const onwardPreview = await receipt.previewCustomerGoodsReceiptCancellation(onward.receiptUuid)
    await ops.addPayment({ date: onward.date + 1, partyType: 'customer', partyId: buyerId, partyName: 'buyer', amount: 100 })
    await rejected(() => receipt.cancelCustomerGoodsReceipt(onward.receiptUuid, onwardPreview.token, 'cancel'), 'later buyer collection blocks cancel')
    const depPreview = await receipt.previewCustomerGoodsReceiptCancellation(onward.receiptUuid)
    eq(depPreview.allowed, false, 'dependent buyer preview blocked')
    eq((await db.customers.get(buyerId)).balance, 2000, 'later collection retained')
    const warehouse = { ...input, receiptUuid: uuid() }
    const stocked = await receipt.createCustomerGoodsReceipt(warehouse)
    const variantId = stocked.adjustments[0].variantId
    const stockedPreview = await receipt.previewCustomerGoodsReceiptCancellation(warehouse.receiptUuid)
    await ops.addSale({ date: warehouse.date + 1, saleType: 'retail', lines: [{ variantId, productName: 'Boot', size: '40', color: 'Black', qty: 2, unitPrice: 1300 }], total: 2600, paid: 2600 })
    await ops.addAdjustment({ date: warehouse.date + 2, variantId, productName: 'Boot', size: '40', color: 'Black', qtyChange: 2, reason: 'correction' })
    eq((await db.variants.get(variantId)).stockQty, 2, 'consumed then replenished fixture')
    await rejected(() => receipt.cancelCustomerGoodsReceipt(warehouse.receiptUuid, stockedPreview.token, 'cancel'), 'replenishment does not unlock consumed stock')
    eq((await receipt.previewCustomerGoodsReceiptCancellation(warehouse.receiptUuid)).allowed, false, 'replenished dependency preview blocked')
    const { validateCustomerGoodsReceiptRows } = await import('/src/lib/customerGoodsReceiptState.ts')
    const rows = { payments: [stocked.payment], adjustments: stocked.adjustments, sales: [], cashMovements: [] }
    eq(validateCustomerGoodsReceiptRows(warehouse.receiptUuid, { ...rows, adjustments: [] }).status, 'incomplete', 'missing child incomplete')
    eq(validateCustomerGoodsReceiptRows(warehouse.receiptUuid, { ...rows, adjustments: [{ ...stocked.adjustments[0], unitCost: 999 }] }).status, 'conflict', 'changed child conflict')
    eq(validateCustomerGoodsReceiptRows(warehouse.receiptUuid, { ...rows, adjustments: [...stocked.adjustments, ...stocked.adjustments] }).status, 'conflict', 'duplicate child conflict')
    const fresh = await receipt.createCustomerGoodsReceipt({ ...input, receiptUuid: uuid() })
    const stale = await receipt.previewCustomerGoodsReceiptCancellation(fresh.receiptUuid)
    await db.customers.update(sourceId, { balance: 12000 })
    await rejected(() => receipt.cancelCustomerGoodsReceipt(fresh.receiptUuid, stale.token, 'cancel'), 'stale token rejected')
    const deleted = await receipt.previewCustomerGoodsReceiptCancellation(fresh.receiptUuid)
    await db.customers.update(sourceId, { deleted: true })
    await rejected(() => receipt.cancelCustomerGoodsReceipt(fresh.receiptUuid, deleted.token, 'cancel'), 'deleted source rejected')
    await db.customers.update(sourceId, { deleted: false })
    const overflowBuyerId = await db.customers.add({ uuid: uuid(), name: 'overflow', type: 'wholesale', balance: Number.MAX_SAFE_INTEGER })
    const beforeLateFailure = await dump()
    await rejected(() => receipt.createCustomerGoodsReceipt({ ...onward, receiptUuid: uuid(), onward: { buyerId: overflowBuyerId, paid: 500 } }), 'late buyer balance overflow blocked')
    eq(await dump(), beforeLateFailure, 'late sale insert rolled back completely')
    const last = await receipt.previewCustomerGoodsReceiptCancellation(fresh.receiptUuid)
    await receipt.cancelCustomerGoodsReceipt(fresh.receiptUuid, last.token, 'cancel')
    await rejected(() => receipt.cancelCustomerGoodsReceipt(fresh.receiptUuid, last.token, 'different'), 'changed cancellation retry rejected')
    eq(last.token.length < 100, true, 'preview token is compact')
    const productId = await db.products.add({ uuid: uuid(), name: 'Existing', createdAt: 1600000000000 })
    const existingId = await db.variants.add({ uuid: uuid(), productId, size: '42', color: 'Brown', stockQty: 2, purchasePrice: 500, retailPrice: 0, wholesalePrice: 0, lowStock: 0 })
    await db.adjustments.add({ uuid: uuid(), date: 1600000000000, variantId: existingId, productName: 'Existing', size: '42', color: 'Brown', qtyChange: 2, unitCost: 500, reason: 'correction' })
    const existingInput = { ...input, receiptUuid: uuid(), date: Date.now() + 10000, lines: [{ lineUuid: uuid(), productName: 'Existing', size: '42', color: 'Brown', qty: 2, unitCost: 1000, variantId: existingId }] }
    const existingState = await receipt.createCustomerGoodsReceipt(existingInput)
    eq((await db.variants.get(existingId)).stockQty, 4, 'selected existing stock')
    eq((await db.variants.get(existingId)).purchasePrice, 750, 'selected existing weighted cost')
    const existingCancel = await receipt.previewCustomerGoodsReceiptCancellation(existingInput.receiptUuid)
    await receipt.cancelCustomerGoodsReceipt(existingInput.receiptUuid, existingCancel.token, 'cancel existing')
    eq((await db.variants.get(existingId)).stockQty, 2, 'selected existing stock restored')
    eq((await db.variants.get(existingId)).purchasePrice, 500, 'selected existing cost restored')
    await rejected(() => receipt.createCustomerGoodsReceipt({ ...existingInput, receiptUuid: uuid(), date: 1599999999999 }), 'backdated receipt before existing inventory activity blocked')
    const buyer2 = await db.customers.add({ uuid: uuid(), name: 'buyer2', type: 'wholesale', balance: 0 })
    const onward2 = { ...onward, receiptUuid: uuid(), date: Date.now() + 10000, onward: { buyerId: buyer2, paid: 500 } }
    await receipt.createCustomerGoodsReceipt(onward2)
    const onwardNext = { ...onward2, receiptUuid: uuid(), lines: [{ ...onward2.lines[0], qty: 3 }] }
    const onwardCorrect = await receipt.previewCustomerGoodsReceiptCorrection(onward2.receiptUuid, onwardNext)
    await receipt.correctCustomerGoodsReceipt(onward2.receiptUuid, onwardNext, onwardCorrect.token, 'more goods')
    eq((await db.customers.get(buyer2)).balance, 3400, 'onward correction net buyer debt')
    const beforeCancelCash = await cashBalance()
    const onwardCancel = await receipt.previewCustomerGoodsReceiptCancellation(onwardNext.receiptUuid)
    await receipt.cancelCustomerGoodsReceipt(onwardNext.receiptUuid, onwardCancel.token, 'cancel onward')
    eq((await db.customers.get(buyer2)).balance, 0, 'onward cancellation restores buyer')
    eq(await cashBalance(), beforeCancelCash - 500, 'onward cancellation reverses real cash')
    const { receiptStableUuid } = await import('/src/lib/customerGoodsReceiptTypes.ts')
    const collision = { ...input, receiptUuid: uuid() }
    await db.adjustments.add({ uuid: receiptStableUuid(`goods-adjustment:${collision.receiptUuid}:${collision.lines[0].lineUuid}`), date: 1600000000000, variantId: existingId, productName: 'Existing', size: '42', color: 'Brown', qtyChange: 0, reason: 'correction' })
    const beforeCollision = await dump()
    await rejected(() => receipt.createCustomerGoodsReceipt(collision), 'existing deterministic child UUID rejected')
    eq(await dump(), beforeCollision, 'child collision rolls back everything')
    await db.cashMovements.add({ uuid: uuid(), date: 1600000000000, type: 'sale', amount: Number.MAX_SAFE_INTEGER, box: 'Overflow' })
    const beforeCashOverflow = await dump()
    await rejected(() => receipt.createCustomerGoodsReceipt({ ...onward2, receiptUuid: uuid(), onward: { buyerId: buyer2, paid: 500, box: 'Overflow' } }), 'cash box overflow blocked')
    eq(await dump(), beforeCashOverflow, 'cash overflow complete rollback')
    const wrongRevision = structuredClone(rows)
    wrongRevision.payments[0].goodsReceipt.revision = uuid()
    wrongRevision.adjustments[0].goodsReceiptChild.revision = wrongRevision.payments[0].goodsReceipt.revision
    eq(validateCustomerGoodsReceiptRows(warehouse.receiptUuid, wrongRevision).status, 'conflict', 'forged matching revision rejected')
    const wrongCost = structuredClone(rows)
    wrongCost.payments[0].goodsReceipt.members[0].priorUnitCost = -5
    eq(validateCustomerGoodsReceiptRows(warehouse.receiptUuid, wrongCost).status, 'conflict', 'invalid saved prior cost rejected')
    return report
  })
  assert.ok(result.length)
  console.log(`PASS ${result.length} checks\n${result.join('\n')}`)
} finally {
  await browser?.close()
  vite.kill('SIGTERM')
}
