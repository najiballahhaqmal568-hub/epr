import type { Payment, Purchase, Sale } from '../src/db'
import { commercialPurchaseLines, commercialSaleLines } from '../src/lib/commercialLines'
import { computeCosts, historicalCostRevision } from '../src/lib/costing'
import { directBalances, directTotals, validateDirectPayments } from '../src/lib/directTradeMath'
import { effectsOf } from '../src/lib/effects'
import { createDirectTrade, addDirectPayment } from '../src/lib/directTradeOps'
import { loadDirectTrade } from '../src/lib/directTradeState'
import { accessFlags, db, newUuid } from '../src/db'
import {
  addCustomerReturn, addExchange, addLandingCost, addPayment, addPurchase, addSale,
  addSupplierReturn, cancelPurchase, cancelPurchaseImpact, correctCustomerPayment,
  correctLandingTotal, correctOpeningDebt, correctPurchase, correctPurchasePrices,
  correctSupplierPayment, correctLenderPayment, deletePayment, deletePaymentImpact, deleteSale, deleteSaleImpact,
  payLanding, previewCustomerPaymentCorrection, previewOpeningDebtCorrection,
  previewSupplierPaymentCorrection, previewLenderPaymentCorrection, receivePurchase, cashBalance, transferCash
} from '../src/lib/ops'
import { cancelLedgerSale, ledgerSaleCancellationPreview } from '../src/lib/ledgerSaleCancellation'
import { computeStock, computeSupplierBalances } from '../src/lib/integrity'
import { equal, line, payment, rejects, seed, snapshot, totals, warehouseSnapshot } from './direct-trade-fixtures'

export const cases: Array<{ name: string; run: () => Promise<void> }> = []

const DIRECT_SALE_ERROR = 'این سند فروش مستقیم است؛ اصلاح آن در این نسخه موجود نیست.'
const DIRECT_PURCHASE_ERROR = 'این سند خرید مستقیم است؛ اصلاح آن در این نسخه موجود نیست.'
const DIRECT_PAYMENT_ERROR = 'این پرداخت مربوط به فروش مستقیم است؛ اصلاح آن در این نسخه موجود نیست.'

async function rejectsDirectWithoutMutation(action: () => Promise<unknown>, message: string): Promise<void> {
  const before = await snapshot()
  let actual = ''
  try { await action() } catch (error) { actual = error instanceof Error ? error.message : String(error) }
  equal(actual, message)
  equal(await snapshot(), before)
}

async function unrelatedCustomerSnapshot(customerId: number): Promise<unknown> {
  return {
    customer: await db.customers.get(customerId),
    payments: await db.payments.filter(row => row.partyType === 'customer' && row.partyId === customerId).toArray(),
    sales: await db.sales.filter(row => row.customerId === customerId).toArray()
  }
}

cases.push({ name: 'atomic direct trade posts golden balances without touching warehouse', run: async () => {
  const f = await seed()
  const before = await warehouseSnapshot()
  const unrelatedBefore = await unrelatedCustomerSnapshot(f.cashCustomerId)
  const tradeUuid = newUuid()
  const initialCashUuid = newUuid(), initialDirectUuid = newUuid()
  const trade = await createDirectTrade({
    tradeUuid, date: Date.UTC(2026, 8, 8, 8), customerId: f.customerId, supplierId: f.supplierId,
    lines: [line], payments: [
      { eventUuid: initialCashUuid, route: 'customerCash', date: Date.UTC(2026, 8, 8, 8), amount: 3000 },
      { eventUuid: initialDirectUuid, route: 'customerToSupplier', date: Date.UTC(2026, 8, 8, 8), amount: 7000 }
    ]
  })
  const state = await loadDirectTrade(trade.tradeUuid)
  equal([state.balances.customerRemaining, state.balances.supplierRemaining], [2000, 3000])
  equal(state.totals.profit, 2000)
  equal([(await db.customers.get(f.customerId))?.balance, (await db.suppliers.get(f.supplierId))?.balance, await cashBalance('دکان')], [3000, 5000, 19000])
  const initialCashPayment = state.payments.find(row => row.uuid === initialCashUuid)!
  const initialCashMovement = (await db.cashMovements.filter(row => row.directPaymentUuid === initialCashUuid).first())!
  if (!initialCashMovement.uuid || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(initialCashMovement.uuid)) {
    throw new Error('Direct cash movement requires a portable UUID')
  }
  equal((await db.cashMovements.filter(row => row.directPaymentUuid === initialCashUuid).toArray()).map(row => ({
    uuid: row.uuid, type: row.type, refId: row.refId, amount: row.amount, box: row.box, directPaymentUuid: row.directPaymentUuid
  })), [{ uuid: initialCashMovement.uuid,
    type: 'customerPayment', refId: initialCashPayment.id, amount: 3000, box: 'دکان', directPaymentUuid: initialCashUuid }])
  equal(await warehouseSnapshot(), before)
  const direct = state.payments.find(row => row.directPayment?.route === 'customerToSupplier')!
  equal(await db.cashMovements.filter(row => row.directPaymentUuid === direct.uuid).count(), 0)
  const laterDirectUuid = newUuid()
  await addDirectPayment(tradeUuid, { eventUuid: laterDirectUuid, route: 'customerToSupplier', date: Date.UTC(2026, 8, 9), amount: 1000 }, state.token)
  equal([(await db.customers.get(f.customerId))?.balance, (await db.suppliers.get(f.supplierId))?.balance, await cashBalance('دکان')], [2000, 4000, 19000])
  equal(await db.cashMovements.filter(row => row.directPaymentUuid === laterDirectUuid).count(), 0)
  const later = await loadDirectTrade(tradeUuid)
  const laterCashUuid = newUuid()
  await addDirectPayment(tradeUuid, { eventUuid: laterCashUuid, route: 'customerCash', date: Date.UTC(2026, 8, 9), amount: 1000 }, later.token)
  equal([(await db.customers.get(f.customerId))?.balance, (await db.suppliers.get(f.supplierId))?.balance, await cashBalance('دکان')], [1000, 4000, 20000])
  const finalBefore = await loadDirectTrade(tradeUuid)
  const laterSupplierUuid = newUuid()
  await addDirectPayment(tradeUuid, { eventUuid: laterSupplierUuid, route: 'supplierPayment', date: Date.UTC(2026, 8, 9), amount: 2000 }, finalBefore.token)
  const final = await loadDirectTrade(tradeUuid)
  equal([final.balances.customerRemaining, final.balances.supplierRemaining, final.totals.profit], [0, 0, 2000])
  equal([(await db.customers.get(f.customerId))?.balance, (await db.suppliers.get(f.supplierId))?.balance, await cashBalance('دکان')], [1000, 2000, 18000])
  equal((await db.cashMovements.filter(row => [laterCashUuid, laterSupplierUuid].includes(row.directPaymentUuid ?? '')).toArray())
    .map(row => [row.directPaymentUuid, row.type, row.amount]), [[laterCashUuid, 'customerPayment', 1000], [laterSupplierUuid, 'supplierPayment', -2000]])
  equal(await unrelatedCustomerSnapshot(f.cashCustomerId), unrelatedBefore)
  equal(await warehouseSnapshot(), before)
}})

cases.push({ name: 'creation and event retries are idempotent and changed payloads reject', run: async () => {
  const f = await seed(), tradeUuid = newUuid().toUpperCase(), eventUuid = newUuid().toUpperCase()
  const input = { tradeUuid, date: 10, customerId: f.customerId, supplierId: f.supplierId, lines: [{ ...line }], payments: [] }
  const first = await createDirectTrade(input)
  equal(await createDirectTrade(structuredClone(input)), first)
  await rejects(() => createDirectTrade({ ...input, date: 11 }))
  const state = await loadDirectTrade(tradeUuid.toLowerCase())
  const paymentId = await addDirectPayment(tradeUuid, { eventUuid, route: 'customerCash', date: 12, amount: 1000 }, state.token)
  equal(await addDirectPayment(tradeUuid.toLowerCase(), { amount: 1000, date: 12, route: 'customerCash', eventUuid: eventUuid.toLowerCase() }, state.token), paymentId)
  await rejects(() => addDirectPayment(tradeUuid, { eventUuid, route: 'customerCash', date: 12, amount: 999 }, state.token))
  equal((await db.payments.where('uuid').equals(eventUuid.toLowerCase()).toArray()).length, 1)
  equal((await db.cashMovements.filter(row => row.directPaymentUuid === eventUuid.toLowerCase()).toArray()).length, 1)
  equal(await createDirectTrade(structuredClone(input)), first)
}})

cases.push({ name: 'creation retry includes freight and never double-posts its bundle', run: async () => {
  const f = await seed()
  const input = { tradeUuid: newUuid(), date: 15, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [],
    shipping: { date: 15, total: 500, customerShare: 300, received: 300, box: 'دکان', note: ' کرایه ' } }
  const first = await createDirectTrade(input)
  const state = await loadDirectTrade(input.tradeUuid)
  await addDirectPayment(input.tradeUuid, { eventUuid: newUuid(), route: 'customerCash', date: 16, amount: 100 }, state.token)
  const before = await snapshot()
  equal(await createDirectTrade(structuredClone(input)), first)
  equal(await snapshot(), before)
  await rejects(() => createDirectTrade({ ...input, shipping: { ...input.shipping, total: 501 } }))
}})

cases.push({ name: 'creation rejects a globally reused event UUID without touching unrelated rows', run: async () => {
  const f = await seed(), eventUuid = newUuid()
  await db.payments.add({ uuid: eventUuid, date: 5, partyType: 'customer', partyId: f.customerId, partyName: 'مشتری مستقیم', amount: 1, cashDelta: 0, via: 'opening' })
  const before = await snapshot()
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 16, customerId: f.customerId, supplierId: f.supplierId, lines: [line],
    payments: [{ eventUuid, route: 'customerCash', date: 16, amount: 1 }] }))
  equal(await snapshot(), before)
}})

cases.push({ name: 'sarraf split consumes credit first and direct events never create phantom cash', run: async () => {
  const f = await seed(), tradeUuid = newUuid()
  await createDirectTrade({ tradeUuid, date: 20, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] })
  let state = await loadDirectTrade(tradeUuid)
  const directUuid = newUuid()
  await addDirectPayment(tradeUuid, { eventUuid: directUuid, route: 'customerToSupplier', date: 21, amount: 3000 }, state.token)
  state = await loadDirectTrade(tradeUuid)
  const splitUuid = newUuid()
  await addDirectPayment(tradeUuid, { eventUuid: splitUuid, route: 'supplierPayment', date: 22, amount: 3000, sarrafId: f.sarrafId, sarrafAmount: 1000 }, state.token)
  equal([(await db.suppliers.get(f.supplierId))?.balance, (await db.suppliers.get(f.sarrafId))?.balance], [6000, -3000])
  equal((await db.cashMovements.filter(row => row.directPaymentUuid === splitUuid).toArray()).map(row => [row.type, row.amount]), [['supplierPayment', -2000]])
  equal(await db.cashMovements.filter(row => row.directPaymentUuid === directUuid).count(), 0)
  await transferCash('دکان', 'خانه', await cashBalance('دکان'))
  state = await loadDirectTrade(tradeUuid)
  const beforeFailedSplit = await snapshot()
  await rejects(() => addDirectPayment(tradeUuid, { eventUuid: newUuid(), route: 'supplierPayment', date: 23,
    amount: 1000, sarrafId: f.sarrafId, sarrafAmount: 500 }, state.token))
  equal(await snapshot(), beforeFailedSplit)
}})

cases.push({ name: 'all-credit, all-cash and maximum-direct routes keep per-trade caps separate', run: async () => {
  for (const scenario of [
    { payments: [], expected: [12000, 10000] },
    { payments: [{ eventUuid: newUuid(), route: 'customerCash' as const, date: 25, amount: 12000 }, { eventUuid: newUuid(), route: 'supplierPayment' as const, date: 25, amount: 10000 }], expected: [0, 0] },
    { payments: [{ eventUuid: newUuid(), route: 'customerToSupplier' as const, date: 25, amount: 10000 }], expected: [2000, 0] }
  ]) {
    const f = await seed(), tradeUuid = newUuid()
    await createDirectTrade({ tradeUuid, date: 25, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: scenario.payments })
    const state = await loadDirectTrade(tradeUuid)
    equal([state.balances.customerRemaining, state.balances.supplierRemaining], scenario.expected)
  }
}})

cases.push({ name: 'invalid, disabled, readonly and insufficient cash writes roll back atomically', run: async () => {
  const f = await seed(), before = await snapshot()
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 0, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  await db.settings.put({ key: 'directTrades.enabled', value: false })
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 30, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  await db.settings.put({ key: 'directTrades.enabled', value: true })
  accessFlags.readOnly = true
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 30, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  accessFlags.readOnly = false
  const expensive = { ...line, lineUuid: newUuid(), qty: 1, unitCost: 30000, unitPrice: 30000 }
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 31, customerId: f.customerId, supplierId: f.supplierId, lines: [expensive], payments: [{ eventUuid: newUuid(), route: 'supplierPayment', date: 31, amount: 30000 }] }))
  equal(await snapshot(), before)
}})

cases.push({ name: 'caps and party roles reject without allocating old debts or receipts', run: async () => {
  const f = await seed()
  for (const payments of [
    [{ eventUuid: newUuid(), route: 'customerCash' as const, date: 40, amount: 12001 }],
    [{ eventUuid: newUuid(), route: 'supplierPayment' as const, date: 40, amount: 10001 }],
    [{ eventUuid: newUuid(), route: 'customerToSupplier' as const, date: 40, amount: 10001 }]
  ]) await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 40, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments }))
  await db.suppliers.update(f.supplierId, { kind: 'sarraf' })
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 41, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  await db.suppliers.update(f.supplierId, { kind: 'supplier', deleted: true })
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 42, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  await db.suppliers.update(f.supplierId, { deleted: false })
  await db.customers.update(f.customerId, { deleted: true })
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 43, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
}})

cases.push({ name: 'new postings require portable party UUID references', run: async () => {
  const f = await seed()
  await db.customers.update(f.customerId, { uuid: undefined })
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 44, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  await db.customers.update(f.customerId, { uuid: newUuid() })
  await db.suppliers.update(f.supplierId, { uuid: undefined })
  await rejects(() => createDirectTrade({ tradeUuid: newUuid(), date: 45, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [] }))
  const fresh = await seed(), tradeUuid = newUuid()
  await createDirectTrade({ tradeUuid, date: 46, customerId: fresh.customerId, supplierId: fresh.supplierId, lines: [line], payments: [] })
  const state = await loadDirectTrade(tradeUuid)
  await db.suppliers.update(fresh.sarrafId, { uuid: undefined })
  await rejects(() => addDirectPayment(tradeUuid, { eventUuid: newUuid(), route: 'supplierPayment', date: 47,
    amount: 1000, sarrafId: fresh.sarrafId, sarrafAmount: 1000 }, state.token))
}})

cases.push({ name: 'commercial totals and invalid quantity', run: async () => {
  equal(directTotals([line]), totals)
  await rejects(async () => directTotals([{ ...line, qty: 1.5 }]))
  await rejects(async () => directTotals([{ ...line, unitCost: Number.NaN }]))
}})

cases.push({ name: 'line validation rejects malformed and unsafe totals', run: async () => {
  const invalid = [
    [],
    [line, { ...line }],
    [{ ...line, lineUuid: '' }],
    [{ ...line, productName: '  ' }],
    [{ ...line, size: '' }],
    [{ ...line, color: '' }],
    [{ ...line, qty: 0 }],
    [{ ...line, qty: -1 }],
    [{ ...line, qty: Number.POSITIVE_INFINITY }],
    [{ ...line, unitCost: -1 }],
    [{ ...line, unitPrice: -1 }],
    [{ ...line, unitPrice: Number.POSITIVE_INFINITY }],
    [{ ...line, qty: Number.MAX_SAFE_INTEGER, unitCost: 2 }],
    [{ ...line, unitPrice: 0 }]
  ]
  for (const lines of invalid) await rejects(async () => directTotals(lines))
}})

cases.push({ name: 'below-cost direct sale preserves explicit loss', run: async () => {
  equal(directTotals([{ ...line, unitPrice: 800 }]), { cost: 10000, sale: 8000, profit: -2000, pairs: 10 })
}})

cases.push({ name: 'generic operations reject direct documents and preserve the exact database snapshot', run: async () => {
  const f = await seed(), tradeUuid = newUuid()
  await createDirectTrade({
    tradeUuid, date: 50, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [
      { eventUuid: newUuid(), route: 'customerCash', date: 50, amount: 1000 },
      { eventUuid: newUuid(), route: 'supplierPayment', date: 50, amount: 1000 }
    ]
  })
  const state = await loadDirectTrade(tradeUuid)
  const sale = state.sale, purchase = state.purchase
  const customerPayment = state.payments.find(row => row.directPayment?.route === 'customerCash')!
  const supplierPayment = state.payments.find(row => row.directPayment?.route === 'supplierPayment')!
  const stockLine = { variantId: f.variantId, productName: 'جنس قبلی', size: '42', color: 'قهوه‌ای', qty: 1, unitPrice: 700, unitCost: 500, restock: true }
  const customerReturn = { date: 51, kind: 'customer' as const, refId: sale.id, partyId: f.customerId, partyName: sale.customerName!, lines: [stockLine], amount: 700, settlement: 'reduceDebt' as const, reason: 'آزمایش' }
  const supplierReturn = { date: 51, kind: 'supplier' as const, refId: purchase.id, partyId: f.supplierId, partyName: purchase.supplierName, lines: [stockLine], amount: 500, settlement: 'reduceDebt' as const, reason: 'آزمایش' }
  const replacementSale = { uuid: newUuid(), date: 51, customerId: f.cashCustomerId, customerName: 'مشتری صندوق آزمایشی', saleType: 'wholesale' as const,
    lines: [{ ...stockLine, qty: 1 }], total: 700, paid: 700 }

  await rejectsDirectWithoutMutation(() => addSale({ ...sale, id: undefined, uuid: newUuid() } as Sale), DIRECT_SALE_ERROR)
  await rejectsDirectWithoutMutation(() => addPurchase({ ...purchase, id: undefined, uuid: newUuid() } as Purchase), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => addPayment({ ...customerPayment, id: undefined, uuid: newUuid() }), DIRECT_PAYMENT_ERROR)

  await rejectsDirectWithoutMutation(() => deleteSaleImpact(sale.id!), DIRECT_SALE_ERROR)
  await rejectsDirectWithoutMutation(() => deleteSale(sale.id!), DIRECT_SALE_ERROR)
  await rejectsDirectWithoutMutation(() => addLandingCost([purchase.id!], 100, 'later'), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => payLanding(purchase.id!), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => correctLandingTotal(purchase.id!, { newTotal: 100, bucket: 'later', reason: 'اصلاح' }), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => receivePurchase(purchase.id!), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => correctPurchase(purchase.id!, [{ variantId: f.variantId, qty: 1, unitCost: 500 }]), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => correctPurchasePrices(purchase.id!, []), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => cancelPurchaseImpact(purchase.id!), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => cancelPurchase(purchase.id!), DIRECT_PURCHASE_ERROR)

  const customerCorrection = { date: 52, amount: 900, reason: 'اصلاح' }
  const supplierCorrection = { date: 52, amount: 900, via: 'cash' as const, reason: 'اصلاح' }
  await rejectsDirectWithoutMutation(() => previewCustomerPaymentCorrection(customerPayment.id!, customerCorrection), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => correctCustomerPayment(customerPayment.id!, customerCorrection), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => previewSupplierPaymentCorrection(supplierPayment.id!, supplierCorrection), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => correctSupplierPayment(supplierPayment.id!, supplierCorrection), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => previewOpeningDebtCorrection(customerPayment.id!, { amount: 900, reason: 'اصلاح' }), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => correctOpeningDebt(customerPayment.id!, { amount: 900, reason: 'اصلاح' }), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => previewLenderPaymentCorrection(supplierPayment.id!, { date: 52, amount: 900, reason: 'اصلاح' }), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => correctLenderPayment(supplierPayment.id!, { date: 52, amount: 900, reason: 'اصلاح' }), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => deletePaymentImpact(customerPayment.id!), DIRECT_PAYMENT_ERROR)
  await rejectsDirectWithoutMutation(() => deletePayment(customerPayment.id!), DIRECT_PAYMENT_ERROR)

  await rejectsDirectWithoutMutation(() => ledgerSaleCancellationPreview(sale.id!, f.customerId), DIRECT_SALE_ERROR)
  await rejectsDirectWithoutMutation(() => cancelLedgerSale(sale.id!, f.customerId, 'ابطال', {} as never), DIRECT_SALE_ERROR)
  await rejectsDirectWithoutMutation(() => addCustomerReturn(customerReturn), DIRECT_SALE_ERROR)
  await rejectsDirectWithoutMutation(() => addSupplierReturn(supplierReturn), DIRECT_PURCHASE_ERROR)
  await rejectsDirectWithoutMutation(() => addExchange(customerReturn, replacementSale), DIRECT_SALE_ERROR)
}})

cases.push({ name: 'ordinary unlinked historical returns remain supported', run: async () => {
  const f = await seed()
  const stockLine = { variantId: f.variantId, productName: 'جنس قبلی', size: '42', color: 'قهوه‌ای', qty: 1, unitPrice: 500, unitCost: 500, restock: true }
  await addCustomerReturn({ date: 53, kind: 'customer', partyId: f.customerId, partyName: 'مشتری مستقیم', lines: [stockLine], amount: 0, settlement: 'reduceDebt', reason: 'سند تاریخی' })
  await addSupplierReturn({ date: 54, kind: 'supplier', partyId: f.supplierId, partyName: 'فروشنده مستقیم', lines: [stockLine], amount: 0, settlement: 'reduceDebt', reason: 'سند تاریخی' })
  equal((await db.returns.toArray()).map(row => [row.kind, row.refId]), [['customer', undefined], ['supplier', undefined]])
  equal((await db.variants.get(f.variantId))?.stockQty, 30)
}})

cases.push({ name: 'balances use live explicit route and cash deltas', run: async () => {
  equal(directBalances(totals, [
    payment('customerCash', 2000, 2000),
    payment('supplierPayment', 3000, -2000, { sarrafId: 9, sarrafAmount: 1000 }),
    payment('customerToSupplier', 4000, 0),
    payment('customerCash', 9999, 9999, { deleted: true })
  ]), {
    customerRemaining: 6000,
    supplierRemaining: 3000,
    customerCash: 2000,
    supplierPaid: 3000,
    customerToSupplier: 4000,
    cashDelta: 0,
    overallocated: false
  })
}})

cases.push({ name: 'balances flag over-allocation and reject invalid stored amounts', run: async () => {
  equal(directBalances(totals, [payment('customerCash', 13000, 13000)]).overallocated, true)
  await rejects(async () => directBalances(totals, [payment('customerCash', 1, undefined as unknown as number)]))
  await rejects(async () => directBalances(totals, [payment('customerCash', 2, 3)]))
  await rejects(async () => directBalances(totals, [payment('supplierPayment', 2, -1, { sarrafAmount: 3 })]))
  await rejects(async () => directBalances(totals, [payment('supplierPayment', 3, -3, { sarrafId: 9, sarrafAmount: 1 })]))
  await rejects(async () => directBalances(totals, [payment('customerToSupplier', 2, 1)]))
  await rejects(async () => directBalances(totals, [
    payment('customerCash', 2, 1, { directPayment: { tradeUuid: 'trade-1', route: 'unknown' as never } })
  ]))
}})

cases.push({ name: 'next payment allocation enforces route, sarraf and balance caps', run: async () => {
  validateDirectPayments(totals, [], [
    { eventUuid: 'event-1', route: 'customerCash', date: 1, amount: 2000 },
    { eventUuid: 'event-2', route: 'supplierPayment', date: 2, amount: 3000, sarrafId: 9, sarrafAmount: 1000 },
    { eventUuid: 'event-3', route: 'customerToSupplier', date: 3, amount: 4000 }
  ])
  const invalid = [
    [{ eventUuid: '', route: 'customerCash' as const, date: 1, amount: 1 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1, amount: 0 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1.5, amount: 1 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1, amount: 1, sarrafAmount: 1 }],
    [{ eventUuid: 'e', route: 'supplierPayment' as const, date: 1, amount: 2, sarrafAmount: 3 }],
    [{ eventUuid: 'e', route: 'customerToSupplier' as const, date: 1, amount: 1, sarrafId: 2 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1, amount: 12001 }]
  ]
  for (const next of invalid) await rejects(async () => validateDirectPayments(totals, [], next))
  await rejects(async () => validateDirectPayments(totals, [], [
    { eventUuid: 'unknown-route', route: 'unknown' as never, date: 1, amount: 1 }
  ]))
  await rejects(async () => validateDirectPayments(totals, [], [
    { eventUuid: 'same', route: 'customerCash', date: 1, amount: 1 },
    { eventUuid: 'same', route: 'customerCash', date: 1, amount: 1 }
  ]))
}})

cases.push({ name: 'ordinary commercial accessors remain unchanged', run: async () => {
  const ordinarySale = { lines: [{ variantId: 7, productName: 'A', size: '40', color: 'B', qty: 2, unitPrice: 8, unitCost: 5 }] } as Sale
  const ordinaryPurchase = { lines: [{ variantId: 8, productName: 'C', size: '41', color: 'D', qty: 3, unitCost: 6 }] } as Purchase
  equal(commercialSaleLines(ordinarySale), ordinarySale.lines)
  equal(commercialPurchaseLines(ordinaryPurchase), ordinaryPurchase.lines)

  const directSale = { lines: [], directLines: [line] } as unknown as Sale
  const directPurchase = { lines: [], directLines: [line] } as unknown as Purchase
  equal(commercialSaleLines(directSale), [{ lineUuid: line.lineUuid, productName: line.productName, size: line.size, color: line.color, qty: line.qty, unitPrice: line.unitPrice, unitCost: line.unitCost }])
  equal(commercialPurchaseLines(directPurchase), [{ lineUuid: line.lineUuid, productName: line.productName, size: line.size, color: line.color, qty: line.qty, unitCost: line.unitCost }])
}})

cases.push({ name: 'customer-to-supplier payment has exactly two debt effects', run: async () => {
  const directPayment: Payment = {
    date: 1, partyType: 'customer', partyId: 11, partyName: 'آزمایشی',
    amount: 7000, cashDelta: 0, via: 'lender', lenderId: 33, sarrafId: 44, sarrafAmount: 7000,
    directPayment: { tradeUuid: 'trade-test', route: 'customerToSupplier', supplierId: 22 }
  }
  equal(effectsOf('payments', directPayment), [
    { table: 'customers', id: 11, field: 'balance', delta: -7000 },
    { table: 'suppliers', id: 22, field: 'balance', delta: -7000 }
  ])
  equal(Array.from(computeSupplierBalances([], [directPayment], []).entries()), [[22, -7000]])
}})

cases.push({ name: 'direct documents never move warehouse stock or historical costs', run: async () => {
  const ordinaryPurchase = {
    id: 1, date: 1, supplierId: 22, supplierName: 'فروشنده',
    lines: [{ variantId: 7, productName: 'بوت', size: '40', color: 'سیاه', qty: 10, unitCost: 500 }],
    total: 5000, paid: 5000
  } as Purchase
  const ordinarySale = {
    id: 2, date: 2, saleType: 'retail',
    lines: [{ variantId: 7, productName: 'بوت', size: '40', color: 'سیاه', qty: 2, unitPrice: 800, unitCost: 500 }],
    total: 1600, paid: 1600
  } as Sale
  const directTrade = { uuid: 'trade-test', revision: 'rev-1', counterpartUuid: 'counterpart', status: 'active' as const }
  const maliciousDirectPurchase = {
    ...ordinaryPurchase, id: 3, date: 3, directTrade,
    lines: [{ ...ordinaryPurchase.lines[0], qty: 100, unitCost: 9000 }]
  } as Purchase
  const maliciousDirectSale = {
    ...ordinarySale, id: 4, date: 4, directTrade,
    lines: [{ ...ordinarySale.lines[0], qty: 100, unitCost: 9000 }]
  } as Sale

  const stockBefore = computeStock([ordinarySale], [ordinaryPurchase], [], [])
  const costBefore = computeCosts([ordinarySale], [ordinaryPurchase], [], [])
  const revisionBefore = historicalCostRevision(1, [600], [ordinarySale], [ordinaryPurchase], [], [])
  const stockAfter = computeStock([ordinarySale, maliciousDirectSale], [ordinaryPurchase, maliciousDirectPurchase], [], [])
  const costAfter = computeCosts([ordinarySale, maliciousDirectSale], [ordinaryPurchase, maliciousDirectPurchase], [], [])
  const revisionAfter = historicalCostRevision(1, [600], [ordinarySale, maliciousDirectSale], [ordinaryPurchase, maliciousDirectPurchase], [], [])
  const directTargetRevision = historicalCostRevision(3, [9500], [ordinarySale], [ordinaryPurchase, maliciousDirectPurchase], [], [])

  equal(stockBefore.get(7), 8)
  equal(stockAfter.get(7), 8)
  equal(costBefore.get(7), 500)
  equal(costAfter.get(7), 500)
  equal(revisionBefore.sales.get(2)?.[0].unitCost, 600)
  equal(revisionAfter.sales.get(2)?.[0].unitCost, 600)
  equal(revisionAfter.sales.has(4), false)
  equal(directTargetRevision, { sales: new Map(), returns: new Map(), affectedSales: 0, affectedPairs: 0, profitChange: 0 })
}})
