// Local-only: isolated IndexedDB devices + real receipt sync/backup code.
// Every non-localhost request is blocked. Never use production Supabase data here.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5204/customer-goods-receipt-sync'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5204', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let browser
let serverOutput = ''
server.stdout.on('data', chunk => { serverOutput += chunk })
server.stderr.on('data', chunk => { serverOutput += chunk })

try {
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  if (!ready) throw new Error(`Vite did not start:\n${serverOutput}`)
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const remote = new Map()
  let remoteClock = 0
  const install = async context => {
    const page = await context.newPage()
    await page.route('**/*', route => {
      const request = new URL(route.request().url())
      if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
      if (request.pathname === '/customer-goods-receipt-sync') return route.fulfill({ contentType: 'text/html', body: '<html></html>' })
      if (request.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa(){return window.testServer}; export async function getProfile(){return {shop_id:"test-shop",role:"owner"}}' })
      return route.continue()
    })
    await page.goto(url)
    await page.exposeFunction('remoteQuery', async ({ table, filters, orders, limit }) => {
      const rows = [...(remote.get(table) ?? new Map()).values()].filter(row => filters.every(([kind, key, value]) => kind === 'eq' ? row[key] === value : kind === 'gte' ? row[key] >= value : row[key] > value))
      rows.sort((left, right) => { for (const key of orders) { if (left[key] < right[key]) return -1; if (left[key] > right[key]) return 1 } return 0 })
      return rows.slice(0, limit)
    })
    await page.exposeFunction('remoteUpsert', async ({ table, rows }) => {
      if (!remote.has(table)) remote.set(table, new Map())
      for (const row of rows) {
        remoteClock += 1
        remote.get(table).set(row.uuid, { ...row, updated_at: new Date(Date.UTC(2026, 8, 21, 0, 0, 0, remoteClock)).toISOString() })
      }
    })
    await page.evaluate(() => {
      window.testServer = {
        auth: { getSession: async () => ({ data: { session: {} } }) },
        from(table) {
          let filters = [], orders = [], limit = 1000
          const query = {
            select() { return query }, eq(key, value) { filters.push(['eq', key, value]); return query },
            gt(key, value) { filters.push(['gt', key, value]); return query }, gte(key, value) { filters.push(['gte', key, value]); return query },
            or(expression) { query._or = expression.match(/^updated_at.gt.(.+),and\(updated_at.eq.(.+),uuid.gt.(.+)\)$/); return query },
            order(key) { orders.push(key); return query }, limit(value) { limit = value; return query },
            single: async () => ({ data: { restore_generation: 0 } }),
            upsert: async rows => { await window.remoteUpsert({ table, rows }); return { error: null } },
            then(resolve, reject) {
              return window.remoteQuery({ table, filters, orders, limit }).then(data => resolve({ data: data.filter(row => !query._or || row.updated_at > query._or[1] || (row.updated_at === query._or[2] && row.uuid > query._or[3])), error: null }), reject)
            }
          }
          return query
        }
      }
    })
    return page
  }
  const a = await install(await browser.newContext({ serviceWorkers: 'block' }))

  const result = await a.evaluate(async () => {
    const { db, SYNC_TABLES } = await import('/src/db.ts')
    const { encodeRefs, decodeRefs } = await import('/src/lib/sync.ts')
    await db.open()
    for (const table of SYNC_TABLES) await db.table(table).clear()
    await db.syncState.clear()
    const sourceUuid = '10000000-0000-4000-8000-000000000001'
    const buyerUuid = '10000000-0000-4000-8000-000000000002'
    const productUuid = '10000000-0000-4000-8000-000000000003'
    const variantUuid = '10000000-0000-4000-8000-000000000004'
    const receiptUuid = '20000000-0000-4000-8000-000000000001'
    const sourceId = await db.customers.add({ uuid: sourceUuid, name: 'Source', type: 'wholesale', balance: 5000 })
    const buyerId = await db.customers.add({ uuid: buyerUuid, name: 'Buyer', type: 'wholesale', balance: 0 })
    const productId = await db.products.add({ uuid: productUuid, name: 'Boot', createdAt: 1600000000000 })
    const variantId = await db.variants.add({ uuid: variantUuid, productId, size: '40', color: 'Black', stockQty: 0, purchasePrice: 0, retailPrice: 0, wholesalePrice: 0, lowStock: 0 })
    const receipt = {
      schema: 1,
      receiptUuid,
      revision: '30000000-0000-5000-8000-000000000001',
      status: 'active',
      createdAt: 1700000000000,
      creationFingerprint: '{}',
      snapshot: { receiptUuid, date: 1700000000000, customerUuid: sourceUuid, destination: 'warehouse', lines: [] },
      members: []
    }
    const encoded = await encodeRefs('payments', {
      uuid: receiptUuid,
      date: 1700000000000,
      partyType: 'customer',
      partyId: sourceId,
      partyName: 'Source',
      amount: 1000,
      cashDelta: 0,
      via: 'goods',
      goodsReceipt: receipt
    })
    let missingRejected = false
    try {
      await decodeRefs('payments', {
        date: 1700000000000,
        partyType: 'customer',
        partyId: sourceId,
        partyUuid: '10000000-0000-4000-8000-000000000099',
        partyName: 'Foreign numeric fallback',
        amount: 1000,
        cashDelta: 0,
        via: 'goods',
        goodsReceipt: receipt
      })
    } catch { missingRejected = true }
    const mismatchedReceipt = structuredClone(receipt)
    mismatchedReceipt.snapshot.customerUuid = buyerUuid
    let nestedEncodeRejected = false, nestedDecodeRejected = false
    try { await encodeRefs('payments', { date: receipt.createdAt, partyType: 'customer', partyId: sourceId, amount: 1, cashDelta: 0, via: 'goods', goodsReceipt: mismatchedReceipt }) } catch { nestedEncodeRejected = true }
    try { await decodeRefs('payments', { date: receipt.createdAt, partyType: 'customer', partyUuid: sourceUuid, amount: 1, cashDelta: 0, via: 'goods', goodsReceipt: mismatchedReceipt }) } catch { nestedDecodeRejected = true }
    const child = { receiptUuid, revision: receipt.revision, status: 'active' }
    const encodedSale = await encodeRefs('sales', { uuid: '20000000-0000-4000-8000-000000000002', date: receipt.createdAt, customerId: buyerId, saleType: 'wholesale', lines: [], goodsReceiptLines: [], goodsReceiptChild: child, total: 0, paid: 0 })
    const encodedAdjustment = await encodeRefs('adjustments', { uuid: '20000000-0000-4000-8000-000000000003', date: receipt.createdAt, variantId, productName: 'Boot', size: '40', color: 'Black', qtyChange: 1, unitCost: 1000, reason: 'correction', goodsReceiptChild: child })
    const encodedCash = await encodeRefs('cashMovements', { uuid: '20000000-0000-4000-8000-000000000004', date: receipt.createdAt, type: 'sale', amount: 1, refId: 999, goodsReceiptChild: child })
    const strictDecode = async (table, data) => { try { await decodeRefs(table, data); return false } catch { return true } }
    const saleMissingRejected = await strictDecode('sales', { ...encodedSale, customerUuid: '10000000-0000-4000-8000-000000000099', customerId: buyerId })
    const adjustmentMissingRejected = await strictDecode('adjustments', { ...encodedAdjustment, variantUuid: '10000000-0000-4000-8000-000000000099', variantId })
    await db.customers.update(buyerId, { deleted: true })
    await db.variants.update(variantId, { deleted: true })
    const saleDeletedRejected = await strictDecode('sales', encodedSale)
    const adjustmentDeletedRejected = await strictDecode('adjustments', encodedAdjustment)
    await db.customers.update(buyerId, { deleted: false })
    await db.variants.update(variantId, { deleted: false })
    return {
      encodedPartyUuid: encoded.partyUuid,
      encodedHasPartyId: 'partyId' in encoded,
      missingRejected,
      nestedEncodeRejected,
      nestedDecodeRejected,
      sale: { uuid: encodedSale.customerUuid, hasId: 'customerId' in encodedSale, missingRejected: saleMissingRejected, deletedRejected: saleDeletedRejected },
      adjustment: { uuid: encodedAdjustment.variantUuid, hasId: 'variantId' in encodedAdjustment, missingRejected: adjustmentMissingRejected, deletedRejected: adjustmentDeletedRejected }
      , cashHasLocalRef: 'refId' in encodedCash
    }
  })

  assert.deepEqual(result, {
    encodedPartyUuid: '10000000-0000-4000-8000-000000000001', encodedHasPartyId: false, missingRejected: true, nestedEncodeRejected: true, nestedDecodeRejected: true,
    sale: { uuid: '10000000-0000-4000-8000-000000000002', hasId: false, missingRejected: true, deletedRejected: true },
    adjustment: { uuid: '10000000-0000-4000-8000-000000000004', hasId: false, missingRejected: true, deletedRejected: true },
    cashHasLocalRef: false
  })

  const b = await install(await browser.newContext({ serviceWorkers: 'block' }))
  const c = await install(await browser.newContext({ serviceWorkers: 'block' }))
  const SOURCE_UUID = '40000000-0000-4000-8000-000000000001'
  const BUYER_UUID = '40000000-0000-4000-8000-000000000002'
  const seed = async (page, padding) => page.evaluate(async ({ padding, SOURCE_UUID, BUYER_UUID }) => {
    const { db, SYNC_TABLES } = await import('/src/db.ts')
    await db.open()
    for (const table of SYNC_TABLES) await db.table(table).clear()
    await db.settings.clear(); await db.syncState.clear()
    for (let i = 0; i < padding; i++) await db.customers.add({ uuid: `50000000-0000-4000-8000-${String(i).padStart(12, '0')}`, name: 'padding', type: 'retail', balance: 0, deleted: true })
    const sourceId = await db.customers.add({ uuid: SOURCE_UUID, name: 'Source', type: 'wholesale', balance: 50000 })
    const buyerId = await db.customers.add({ uuid: BUYER_UUID, name: 'Buyer', type: 'wholesale', balance: 0 })
    await db.settings.put({ key: 'goodsReceiptCompatibilityAcknowledged', value: true })
    return { sourceId, buyerId }
  }, { padding, SOURCE_UUID, BUYER_UUID })
  const idsA = await seed(a, 0), idsB = await seed(b, 3), idsC = await seed(c, 6)
  assert.notEqual(idsA.sourceId, idsB.sourceId)

  const warehouse1 = await a.evaluate(async ids => {
    const receipt = await import('/src/lib/customerGoodsReceiptOps.ts')
    const input = { receiptUuid: crypto.randomUUID(), date: 1700000000000, customerId: ids.sourceId, destination: 'warehouse', lines: [{ lineUuid: crypto.randomUUID(), productName: 'Boot', size: '40', color: 'Black', qty: 2, unitCost: 500 }] }
    const state = await receipt.createCustomerGoodsReceipt(input)
    await (await import('/src/lib/sync.ts')).syncNow(true)
    return { input, variantUuid: state.payment.goodsReceipt.members[0].variantUuid }
  }, idsA)
  await b.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))

  const accounting = async page => page.evaluate(async ({ SOURCE_UUID, BUYER_UUID }) => {
    const { db } = await import('/src/db.ts')
    const source = await db.customers.where('uuid').equals(SOURCE_UUID).first()
    const buyer = await db.customers.where('uuid').equals(BUYER_UUID).first()
    const variants = (await db.variants.toArray()).filter(row => !row.deleted).map(row => ({ uuid: row.uuid, stock: row.stockQty, cost: row.purchasePrice })).sort((x, y) => x.uuid.localeCompare(y.uuid))
    const cash = (await db.cashMovements.toArray()).filter(row => !row.deleted).reduce((sum, row) => sum + row.amount, 0)
    const sales = (await db.sales.toArray()).filter(row => !row.deleted && row.goodsReceiptChild).map(row => ({ uuid: row.uuid, total: row.total, paid: row.paid, cost: row.goodsReceiptLines.reduce((sum, line) => sum + line.qty * line.unitCost, 0) })).sort((x, y) => x.uuid.localeCompare(y.uuid))
    return { source: source.balance, buyer: buyer.balance, variants, cash, sales }
  }, { SOURCE_UUID, BUYER_UUID })
  assert.deepEqual(await accounting(b), await accounting(a), 'first warehouse receipt converges across different local IDs')
  await b.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  assert.deepEqual(await accounting(b), await accounting(a), 'repeated replay applies once')

  const warehouse2 = await a.evaluate(async ({ ids, warehouse1 }) => {
    const { db } = await import('/src/db.ts')
    const receipt = await import('/src/lib/customerGoodsReceiptOps.ts')
    const variant = await db.variants.where('uuid').equals(warehouse1.variantUuid).first()
    const input = { receiptUuid: crypto.randomUUID(), date: 1700000001000, customerId: ids.sourceId, destination: 'warehouse', lines: [{ lineUuid: crypto.randomUUID(), productName: 'Boot', size: '40', color: 'Black', qty: 2, unitCost: 1000, variantId: variant.id }] }
    const state = await receipt.createCustomerGoodsReceipt(input)
    await (await import('/src/lib/sync.ts')).syncNow(true)
    return { input, status: state.status }
  }, { ids: idsA, warehouse1 })
  await b.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  assert.deepEqual(await accounting(b), await accounting(a), 'weighted receipt cost converges')
  assert.deepEqual((await accounting(b)).variants[0], { uuid: warehouse1.variantUuid, stock: 4, cost: 750 })

  await a.evaluate(async receiptUuid => {
    const receipt = await import('/src/lib/customerGoodsReceiptOps.ts')
    const preview = await receipt.previewCustomerGoodsReceiptCancellation(receiptUuid)
    await receipt.cancelCustomerGoodsReceipt(receiptUuid, preview.token, 'cancel second receipt')
    await (await import('/src/lib/sync.ts')).syncNow(true)
  }, warehouse2.input.receiptUuid)
  await b.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  assert.deepEqual(await accounting(b), await accounting(a), 'cancellation effects converge')
  assert.deepEqual((await accounting(b)).variants[0], { uuid: warehouse1.variantUuid, stock: 2, cost: 500 }, 'cancellation restores stock and acquisition cost')

  const onward = await a.evaluate(async ids => {
    const receipt = await import('/src/lib/customerGoodsReceiptOps.ts')
    const sync = await import('/src/lib/sync.ts')
    const input = { receiptUuid: crypto.randomUUID(), date: 1700000002000, customerId: ids.sourceId, destination: 'onward', lines: [{ lineUuid: crypto.randomUUID(), productName: 'Sandal', size: '41', color: 'Tan', qty: 2, unitCost: 1000, unitPrice: 1300 }], onward: { buyerId: ids.buyerId, paid: 500, box: 'Shop' } }
    const state = await receipt.createCustomerGoodsReceipt(input)
    const sale = await sync.encodeRefs('sales', state.sale)
    const payment = await sync.encodeRefs('payments', state.payment)
    const cash = await sync.encodeRefs('cashMovements', state.cashMovements[0])
    return { input, rows: { sale: { uuid: state.sale.uuid, deleted: false, data: sale }, payment: { uuid: state.payment.uuid, deleted: false, data: payment }, cash: { uuid: state.cashMovements[0].uuid, deleted: false, data: cash } } }
  }, idsA)
  const shuffled = await c.evaluate(async rows => {
    const { db } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const state = await import('/src/lib/customerGoodsReceiptState.ts')
    await sync.applyRemoteRow('sales', rows.sale)
    const incomplete = await state.loadCustomerGoodsReceipt(rows.payment.uuid)
    const buyerAfterChild = (await db.customers.where('uuid').equals('40000000-0000-4000-8000-000000000002').first()).balance
    await sync.applyRemoteRow('cashMovements', rows.cash)
    await sync.applyRemoteRow('payments', rows.payment)
    const ready = await state.loadCustomerGoodsReceipt(rows.payment.uuid)
    const beforeReplay = { source: (await db.customers.where('uuid').equals('40000000-0000-4000-8000-000000000001').first()).balance, buyer: (await db.customers.where('uuid').equals('40000000-0000-4000-8000-000000000002').first()).balance }
    await sync.applyRemoteRow('sales', rows.sale); await sync.applyRemoteRow('payments', rows.payment); await sync.applyRemoteRow('cashMovements', rows.cash)
    const afterReplay = { source: (await db.customers.where('uuid').equals('40000000-0000-4000-8000-000000000001').first()).balance, buyer: (await db.customers.where('uuid').equals('40000000-0000-4000-8000-000000000002').first()).balance }
    return { incomplete: incomplete.status, ready: ready.status, buyerAfterChild, beforeReplay, afterReplay }
  }, onward.rows)
  assert.deepEqual(shuffled, { incomplete: 'incomplete', ready: 'ready', buyerAfterChild: 2100, beforeReplay: { source: 48000, buyer: 2100 }, afterReplay: { source: 48000, buyer: 2100 } })

  await a.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  await b.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  assert.deepEqual(await accounting(b), await accounting(a), 'onward sale cash, debt, frozen cost and profit inputs converge')

  const correction = await a.evaluate(async ({ ids, input }) => {
    const receipt = await import('/src/lib/customerGoodsReceiptOps.ts')
    const next = { ...input, receiptUuid: crypto.randomUUID(), lines: [{ ...input.lines[0], qty: 3 }] }
    const preview = await receipt.previewCustomerGoodsReceiptCorrection(input.receiptUuid, next)
    await receipt.correctCustomerGoodsReceipt(input.receiptUuid, next, preview.token, 'correct onward quantity')
    await (await import('/src/lib/sync.ts')).syncNow(true)
    return { oldUuid: input.receiptUuid, newUuid: next.receiptUuid }
  }, { ids: idsA, input: onward.input })
  await b.evaluate(async () => await (await import('/src/lib/sync.ts')).syncNow(true))
  assert.deepEqual(await accounting(b), await accounting(a), 'correction successor converges')

  const conflict = await b.evaluate(async ({ oldUuid, alternate }) => {
    const { db } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const state = await import('/src/lib/customerGoodsReceiptState.ts')
    const anchor = await db.payments.where('uuid').equals(oldUuid).first()
    const encoded = await sync.encodeRefs('payments', anchor)
    const competing = { ...encoded, goodsReceipt: { ...encoded.goodsReceipt, correctedByUuid: alternate } }
    await sync.applyRemoteRow('payments', { uuid: oldUuid, deleted: true, data: competing })
    const afterConflict = await state.loadCustomerGoodsReceipt(oldUuid)
    const originalWinner = (await db.payments.where('uuid').equals(oldUuid).first()).goodsReceipt.correctedByUuid === encoded.goodsReceipt.correctedByUuid
    const stripped = { ...encoded }; delete stripped.goodsReceipt
    await sync.applyRemoteRow('payments', { uuid: oldUuid, deleted: true, data: stripped })
    const afterStripped = await db.payments.where('uuid').equals(oldUuid).first()
    const beforeDebt = (await db.customers.where('uuid').equals(afterStripped.goodsReceipt.snapshot.customerUuid).first()).balance
    const delayedActive = { ...encoded, deleted: undefined, goodsReceipt: { ...encoded.goodsReceipt, status: 'active', correctedByUuid: undefined, reason: undefined, cancelledAt: undefined, mutationToken: undefined } }
    await sync.applyRemoteRow('payments', { uuid: oldUuid, deleted: false, data: delayedActive })
    const afterDelayed = await db.payments.where('uuid').equals(oldUuid).first()
    const afterDebt = (await db.customers.where('uuid').equals(afterStripped.goodsReceipt.snapshot.customerUuid).first()).balance
    const markers = await db.syncState.filter(row => row.key.startsWith(`goodsReceiptConflict:${oldUuid}:`)).count()
    return { conflict: afterConflict.status, originalWinner, markerRetained: Boolean(afterStripped.goodsReceipt), markers, predecessorStayedCancelled: afterDelayed.deleted && afterDelayed.goodsReceipt.status === 'cancelled', debtUnchanged: beforeDebt === afterDebt }
  }, { oldUuid: correction.oldUuid, alternate: '00000000-0000-4000-8000-000000000001' })
  assert.equal(conflict.conflict, 'conflict')
  assert.equal(conflict.originalWinner, true, 'existing linked successor remains the selected row while sibling conflict evidence is retained')
  assert.deepEqual({ markerRetained: conflict.markerRetained, hasEvidence: conflict.markers > 0, predecessorStayedCancelled: conflict.predecessorStayedCancelled, debtUnchanged: conflict.debtUnchanged }, { markerRetained: true, hasEvidence: true, predecessorStayedCancelled: true, debtUnchanged: true })
  const successorBlocked = await b.evaluate(async receiptUuid => {
    const { loadCustomerGoodsReceipt } = await import('/src/lib/customerGoodsReceiptState.ts')
    const { previewCustomerGoodsReceiptCancellation } = await import('/src/lib/customerGoodsReceiptOps.ts')
    const state = await loadCustomerGoodsReceipt(receiptUuid)
    const preview = await previewCustomerGoodsReceiptCancellation(receiptUuid)
    return { status: state.status, allowed: preview.allowed, reasons: preview.writeBlockReasons.length }
  }, correction.newUuid)
  assert.deepEqual({ status: successorBlocked.status, allowed: successorBlocked.allowed, blocked: successorBlocked.reasons > 0 }, { status: 'conflict', allowed: false, blocked: true }, 'predecessor conflict blocks the linked active successor')
  const successorMutationBlocked = await b.evaluate(async receiptUuid => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/customerGoodsReceiptOps.ts')
    const before = (await db.payments.where('uuid').equals(receiptUuid).first()).deleted
    const preview = await ops.previewCustomerGoodsReceiptCancellation(receiptUuid)
    let rejected = false
    try { await ops.cancelCustomerGoodsReceipt(receiptUuid, preview.token, 'must not cancel conflicted successor') } catch { rejected = true }
    const after = (await db.payments.where('uuid').equals(receiptUuid).first()).deleted
    return { rejected, unchanged: before === after }
  }, correction.newUuid)
  assert.deepEqual(successorMutationBlocked, { rejected: true, unchanged: true }, 'conflicted successor cannot be cancelled by direct operation')

  const cancelledAudit = await b.evaluate(async ({ receiptUuid, SOURCE_UUID, variantUuid }) => {
    const { db } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const state = await import('/src/lib/customerGoodsReceiptState.ts')
    const anchor = await db.payments.where('uuid').equals(receiptUuid).first()
    const adjustment = await db.adjustments.filter(row => row.goodsReceiptChild?.receiptUuid === receiptUuid).first()
    const encodedAnchor = await sync.encodeRefs('payments', anchor)
    const encodedAdjustment = await sync.encodeRefs('adjustments', adjustment)
    const source = await db.customers.where('uuid').equals(SOURCE_UUID).first()
    const variant = await db.variants.where('uuid').equals(variantUuid).first()
    const product = await db.products.get(variant.productId)
    await db.customers.update(source.id, { deleted: true }); await db.variants.update(variant.id, { deleted: true }); await db.products.update(product.id, { deleted: true })
    let replayed = true, error = ''
    try {
      await sync.applyRemoteRow('payments', { uuid: anchor.uuid, deleted: true, data: encodedAnchor })
      await sync.applyRemoteRow('adjustments', { uuid: adjustment.uuid, deleted: true, data: encodedAdjustment })
    } catch (reason) { replayed = false; error = reason instanceof Error ? reason.message : String(reason) }
    const status = (await state.loadCustomerGoodsReceipt(receiptUuid)).status
    await db.customers.update(source.id, { deleted: false }); await db.variants.update(variant.id, { deleted: false }); await db.products.update(product.id, { deleted: false })
    return { replayed, status, error }
  }, { receiptUuid: warehouse2.input.receiptUuid, SOURCE_UUID, variantUuid: warehouse1.variantUuid })
  assert.deepEqual(cancelledAudit, { replayed: true, status: 'cancelled', error: '' }, 'cancelled audit permits existing deleted masters')

  const backup = await a.evaluate(async () => {
    const ops = await import('/src/lib/ops.ts')
    const { validateCustomerGoodsReceiptBackup } = await import('/src/lib/customerGoodsReceiptBackup.ts')
    const json = await ops.exportBackup()
    const parsed = JSON.parse(json)
    validateCustomerGoodsReceiptBackup(parsed.data)
    return {
      json,
      acknowledgementExported: parsed.data.settings.some(row => row.key === 'goodsReceiptCompatibilityAcknowledged'),
      cancelledAnchors: parsed.data.payments.filter(row => row.goodsReceipt?.status === 'cancelled' && row.deleted).length
    }
  })
  assert.equal(backup.acknowledgementExported, false, 'device receipt acknowledgement is not exported')
  assert.ok(backup.cancelledAnchors >= 2, 'cancelled audit anchors stay in the backup')

  const rejectedImport = await c.evaluate(async json => {
    const { db, SYNC_TABLES } = await import('/src/db.ts')
    const { importBackup } = await import('/src/lib/ops.ts')
    const parsed = JSON.parse(json)
    const anchor = parsed.data.payments.find(row => row.goodsReceipt?.status === 'active' && row.goodsReceipt.snapshot.destination === 'warehouse')
    const childUuid = anchor.goodsReceipt.members.find(member => member.table === 'adjustments').uuid
    parsed.data.adjustments = parsed.data.adjustments.filter(row => row.uuid !== childUuid)
    const snapshot = async () => JSON.stringify(await Promise.all(SYNC_TABLES.map(async table => [table, await db.table(table).orderBy('id').toArray()])))
    const before = await snapshot()
    let rejected = false
    try { await importBackup(JSON.stringify(parsed), 'merge') } catch { rejected = true }
    return { rejected, unchanged: before === await snapshot() }
  }, backup.json)
  assert.deepEqual(rejectedImport, { rejected: true, unchanged: true }, 'partial receipt backup is rejected before clearing data')

  const validation = await a.evaluate(async json => {
    const { validateCustomerGoodsReceiptBackup } = await import('/src/lib/customerGoodsReceiptBackup.ts')
    const invalid = transform => {
      const parsed = JSON.parse(json); transform(parsed.data)
      try { validateCustomerGoodsReceiptBackup(parsed.data); return false } catch { return true }
    }
    return {
      foreignMasterId: invalid(data => { data.payments.find(row => row.goodsReceipt).partyId = 999999 }),
      brokenCorrectionLink: invalid(data => {
        const predecessor = data.payments.find(row => row.goodsReceipt?.correctedByUuid)
        predecessor.goodsReceipt.correctedByUuid = crypto.randomUUID()
      }),
      strippedChildMarker: invalid(data => {
        const anchor = data.payments.find(row => row.goodsReceipt?.status === 'active' && row.goodsReceipt.snapshot.destination === 'warehouse')
        const member = anchor.goodsReceipt.members.find(item => item.table === 'adjustments')
        delete data.adjustments.find(row => row.uuid === member.uuid).goodsReceiptChild
      }),
      changedTotal: invalid(data => { data.payments.find(row => row.goodsReceipt?.status === 'active').amount += 1 }),
      selfBuyer: invalid(data => {
        const anchor = data.payments.find(row => row.goodsReceipt?.snapshot.destination === 'onward')
        anchor.goodsReceipt.snapshot.onward.buyerUuid = anchor.goodsReceipt.snapshot.customerUuid
      })
    }
  }, backup.json)
  assert.deepEqual(validation, { foreignMasterId: true, brokenCorrectionLink: true, strippedChildMarker: true, changedTotal: true, selfBuyer: true })

  const d = await install(await browser.newContext({ serviceWorkers: 'block' }))
  const imported = await d.evaluate(async json => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    await db.open(); await db.settings.put({ key: 'goodsReceiptCompatibilityAcknowledged', value: true })
    await ops.importBackup(json, 'merge')
    const anchors = (await db.payments.toArray()).filter(row => row.goodsReceipt)
    const cancelled = anchors.filter(row => row.deleted && row.goodsReceipt.status === 'cancelled')
    const linked = cancelled.filter(row => row.goodsReceipt.correctedByUuid).every(row => anchors.some(next => next.uuid === row.goodsReceipt.correctedByUuid && next.goodsReceipt?.correctionOfUuid === row.uuid))
    return { cancelled: cancelled.length, linked, acknowledged: (await db.settings.get('goodsReceiptCompatibilityAcknowledged'))?.value === true }
  }, backup.json)
  assert.deepEqual(imported, { cancelled: backup.cancelledAnchors, linked: true, acknowledged: false }, 'valid import preserves audit/links without transferring device acknowledgement')

  const conflictedBackup = await d.evaluate(async receiptUuid => {
    const { db } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const ops = await import('/src/lib/ops.ts')
    const { loadCustomerGoodsReceipt } = await import('/src/lib/customerGoodsReceiptState.ts')
    const anchor = await db.payments.where('uuid').equals(receiptUuid).first()
    const encoded = await sync.encodeRefs('payments', anchor)
    const changed = { ...encoded, goodsReceipt: { ...encoded.goodsReceipt, createdAt: encoded.goodsReceipt.createdAt + 1 } }
    await sync.applyRemoteRow('payments', { uuid: receiptUuid, deleted: false, data: changed })
    const before = await loadCustomerGoodsReceipt(receiptUuid)
    const json = await ops.exportBackup()
    return { json, status: before.status, evidenceCount: JSON.parse(json).customerGoodsReceiptConflicts?.length ?? 0 }
  }, warehouse1.input.receiptUuid)
  assert.deepEqual({ status: conflictedBackup.status, hasEvidence: conflictedBackup.evidenceCount > 0 }, { status: 'conflict', hasEvidence: true }, 'export includes receipt conflict evidence outside synced tables')

  const e = await install(await browser.newContext({ serviceWorkers: 'block' }))
  const restoredConflict = await e.evaluate(async ({ json, receiptUuid }) => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const { loadCustomerGoodsReceipt } = await import('/src/lib/customerGoodsReceiptState.ts')
    await db.open()
    await ops.importBackup(json, 'merge')
    const state = await loadCustomerGoodsReceipt(receiptUuid)
    const keys = await db.syncState.filter(row => row.key.startsWith(`goodsReceiptConflict:${receiptUuid}:`)).count()
    return { status: state.status, keys, blocked: state.writeBlockReasons.length > 0 }
  }, { json: conflictedBackup.json, receiptUuid: warehouse1.input.receiptUuid })
  assert.deepEqual({ status: restoredConflict.status, hasEvidence: restoredConflict.keys > 0, blocked: restoredConflict.blocked }, { status: 'conflict', hasEvidence: true, blocked: true }, 'backup round-trip cannot unblock a structurally valid conflicted receipt')

  const rejectedEvidence = await c.evaluate(async json => {
    const { db, SYNC_TABLES } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const parsed = JSON.parse(json)
    parsed.customerGoodsReceiptConflicts[0].key = 'pull:payments'
    const snapshot = async () => JSON.stringify({
      tables: await Promise.all(SYNC_TABLES.map(async table => [table, await db.table(table).orderBy('id').toArray()])),
      syncState: await db.syncState.orderBy('key').toArray()
    })
    const before = await snapshot()
    let rejected = false
    try { await ops.importBackup(JSON.stringify(parsed), 'merge') } catch { rejected = true }
    return { rejected, unchanged: before === await snapshot() }
  }, conflictedBackup.json)
  assert.deepEqual(rejectedEvidence, { rejected: true, unchanged: true }, 'malformed receipt conflict evidence rejects import before clearing records or sync state')

  const competingSuccessor = await b.evaluate(async ({ oldUuid, successorUuid }) => {
    const { db } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const { loadCustomerGoodsReceipt } = await import('/src/lib/customerGoodsReceiptState.ts')
    const { receiptCanonical, receiptStableUuid } = await import('/src/lib/customerGoodsReceiptTypes.ts')
    const successor = await db.payments.where('uuid').equals(successorUuid).first()
    const data = await sync.encodeRefs('payments', successor)
    const alternateUuid = '70000000-0000-4000-8000-000000000099'
    const snapshot = { ...data.goodsReceipt.snapshot, receiptUuid: alternateUuid }
    data.goodsReceipt = { ...data.goodsReceipt, receiptUuid: alternateUuid, revision: receiptStableUuid(`goods-revision:${alternateUuid}`), snapshot, creationFingerprint: receiptCanonical(snapshot) }
    await sync.applyRemoteRow('payments', { uuid: alternateUuid, deleted: false, data })
    const state = await loadCustomerGoodsReceipt(oldUuid)
    const successors = (await db.payments.toArray()).filter(row => row.goodsReceipt?.correctionOfUuid === oldUuid).length
    return { status: state.status, blocked: state.writeBlockReasons.length > 0, successors }
  }, { oldUuid: correction.oldUuid, successorUuid: correction.newUuid })
  assert.deepEqual(competingSuccessor, { status: 'conflict', blocked: true, successors: 2 }, 'competing correction successors remain visible and block the predecessor')

  const adjustmentUpdate = await b.evaluate(async receiptUuid => {
    const { db } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const { loadCustomerGoodsReceipt } = await import('/src/lib/customerGoodsReceiptState.ts')
    const adjustment = await db.adjustments.filter(row => row.goodsReceiptChild?.receiptUuid === receiptUuid).first()
    const encoded = await sync.encodeRefs('adjustments', adjustment)
    const variant = await db.variants.get(adjustment.variantId)
    await sync.applyRemoteRow('adjustments', { uuid: adjustment.uuid, deleted: false, data: { ...encoded, unitCost: 600 } })
    const changed = await db.variants.get(variant.id)
    const conflict = (await loadCustomerGoodsReceipt(receiptUuid)).status
    await sync.applyRemoteRow('adjustments', { uuid: adjustment.uuid, deleted: false, data: encoded })
    const restored = await db.variants.get(variant.id)
    return { stock: changed.stockQty, cost: changed.purchasePrice, conflict, restoredCost: restored.purchasePrice }
  }, warehouse1.input.receiptUuid)
  assert.deepEqual(adjustmentUpdate, { stock: 2, cost: 600, conflict: 'conflict', restoredCost: 500 }, 'receipt adjustment updates reverse/apply once and rebuild cost')

  const finalAccounting = await accounting(a)
  const correctedSale = finalAccounting.sales.find(sale => sale.uuid !== onward.rows.sale.uuid)
  assert.deepEqual({ source: finalAccounting.source, buyer: finalAccounting.buyer, cash: finalAccounting.cash, sale: correctedSale.total, cost: correctedSale.cost, profit: correctedSale.total - correctedSale.cost }, { source: 46000, buyer: 3400, cash: 500, sale: 3900, cost: 3000, profit: 900 })

  console.log('PASS: receipt UUID refs, replay/effects/conflicts and backup preflight')
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
