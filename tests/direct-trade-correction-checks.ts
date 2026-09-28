// Audited corrections and cancellation of direct trades.
// Golden trade: 10 pairs × cost 1,000 / price 1,200; customer paid 3,000 cash and 7,000 directly to the supplier.
import { accessFlags, db, newUuid } from '../src/db'
import { addDirectPayment, createDirectTrade } from '../src/lib/directTradeOps'
import {
  cancelDirectTrade, correctDirectPayment, correctDirectTrade,
  previewDirectPaymentCorrection, previewDirectTradeCancellation, previewDirectTradeCorrection
} from '../src/lib/directTradeCorrections'
import { validateDirectBackup } from '../src/lib/directTradeBackup'
import { loadDirectTrade } from '../src/lib/directTradeState'
import { runIntegrityCheck } from '../src/lib/integrity'
import { cashBalance } from '../src/lib/ops'
import { equal, line, rejects, seed, snapshot, warehouseSnapshot } from './direct-trade-fixtures'

export const cases: Array<{ name: string; run: () => Promise<void> }> = []

const DAY = Date.UTC(2026, 8, 8, 8)

async function golden() {
  const f = await seed()
  await db.settings.put({ key: 'cachedProfile', value: { role: 'owner', shop_id: 'test-shop' } })
  const tradeUuid = newUuid()
  const cashUuid = newUuid(), directUuid = newUuid()
  await createDirectTrade({
    tradeUuid, date: DAY, customerId: f.customerId, supplierId: f.supplierId, lines: [line],
    payments: [
      { eventUuid: cashUuid, route: 'customerCash', date: DAY, amount: 3000 },
      { eventUuid: directUuid, route: 'customerToSupplier', date: DAY, amount: 7000 }
    ]
  })
  const balances = async () => [(await db.customers.get(f.customerId))!.balance, (await db.suppliers.get(f.supplierId))!.balance, await cashBalance('دکان')]
  // Customer: old 1,000 + 12,000 − 3,000 − 7,000. Supplier: old 2,000 + 10,000 − 7,000.
  const start = await balances()
  equal(start.slice(0, 2), [3000, 5000])
  return { f, tradeUuid, cashUuid, directUuid, balances, cash0: start[2] }
}

async function noMismatches() {
  equal((await runIntegrityCheck()).mismatches, [])
}

async function rejectsWithoutMutation(action: () => Promise<unknown>, contains: string) {
  const before = await snapshot()
  let message = ''
  try { await action() } catch (error) { message = error instanceof Error ? error.message : String(error) }
  if (!message.includes(contains)) throw new Error(`Expected rejection containing «${contains}», received «${message}»`)
  equal(await snapshot(), before)
}

cases.push({ name: 'trade correction previews net change, then posts it once with audit history', run: async () => {
  const g = await golden()
  const warehouse = await warehouseSnapshot()
  const state = await loadDirectTrade(g.tradeUuid)
  const oldRevision = state.sale!.directTrade!.revision
  const input = { date: DAY + 3_600_000, lines: [{ ...line, qty: 9 }], reason: 'یک جوره کم رسید' }
  const before = await snapshot()
  const preview = await previewDirectTradeCorrection(g.tradeUuid, input)
  equal(await snapshot(), before)
  equal([preview.allowed, preview.reasons, preview.net], [true, [], { customer: -1200, supplier: -1000, profit: -200 }])

  await correctDirectTrade(g.tradeUuid, input, preview.token)
  const [customer, supplier, cash] = await g.balances()
  equal([customer, supplier, cash], [1800, 4000, g.cash0])
  const after = await loadDirectTrade(g.tradeUuid)
  equal([after.status, after.totals, after.sale!.date, after.purchase!.date], ['ready', { cost: 9000, sale: 10800, profit: 1800, pairs: 9 }, DAY + 3_600_000, DAY + 3_600_000])
  const meta = after.sale!.directTrade!
  if (meta.revision === oldRevision) throw new Error('revision did not change')
  equal([meta.previousRevision, after.purchase!.directTrade!.revision, after.purchase!.directTrade!.previousRevision], [oldRevision, meta.revision, oldRevision])
  equal(meta.corrections?.map(c => [c.revision, c.date, c.lines[0].qty, c.reason]), [[oldRevision, DAY, 10, 'یک جوره کم رسید']])
  equal(await warehouseSnapshot(), warehouse)
  await noMismatches()
  validateDirectBackup(await snapshot())

  // The same token can never post twice.
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, input, preview.token), 'تغییر کرده')
}})

cases.push({ name: 'trade correction refuses totals below allocated money, empty reasons, stale tokens and non-owners', run: async () => {
  const g = await golden()
  const state = await loadDirectTrade(g.tradeUuid)
  // Customer already settled 10,000; 8 pairs sell for 9,600.
  const tooLow = await previewDirectTradeCorrection(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 8 }], reason: 'اشتباه' })
  equal(tooLow.allowed, false)
  if (!tooLow.reasons.join(' ').includes('پرداخت')) throw new Error('below-allocation reason missing')
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 8 }], reason: 'اشتباه' }, state.token), 'پرداخت')
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 9 }], reason: '  ' }, state.token), 'دلیل')
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [line], reason: 'هیچ' }, state.token), 'تغییری')
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 0 }], reason: 'x' }, state.token), 'جنس')
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 9 }], reason: 'x' }, 'stale'), 'تغییر کرده')
  await db.settings.put({ key: 'cachedProfile', value: { role: 'staff' } })
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 9 }], reason: 'x' }, state.token), 'مالک')
  await db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } })
  accessFlags.readOnly = true
  try {
    await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 9 }], reason: 'x' }, state.token), 'مشاهده')
  } finally { accessFlags.readOnly = false }
}})

cases.push({ name: 'cash payment correction keeps the original cash row and appends an explicit reversal', run: async () => {
  const g = await golden()
  const state = await loadDirectTrade(g.tradeUuid)
  const input = { action: 'replace' as const, date: DAY, amount: 2500, reason: 'پنجصد کمتر گرفته شد' }
  const before = await snapshot()
  const preview = await previewDirectPaymentCorrection(g.tradeUuid, g.cashUuid, input)
  equal(await snapshot(), before)
  equal([preview.allowed, preview.net.customer, preview.net.supplier, preview.net.cash], [true, 500, 0, [{ box: 'دکان', delta: -500 }]])
  const replacementUuid = await correctDirectPayment(g.tradeUuid, g.cashUuid, input, preview.token)
  equal(await g.balances(), [3500, 5000, g.cash0 - 500])
  const old = await db.payments.where('uuid').equals(g.cashUuid).first()
  const replacement = await db.payments.where('uuid').equals(replacementUuid!).first()
  equal([old!.deleted, old!.correctedByUuid, replacement!.correctionOfUuid, replacement!.correctionReason, replacement!.amount, replacement!.cashDelta],
    [true, replacementUuid, g.cashUuid, 'پنجصد کمتر گرفته شد', 2500, 2500])
  equal(replacement!.correctionPrevious?.amount, 3000)
  const cashRows = (await db.cashMovements.toArray()).filter(row => row.directPaymentUuid === g.cashUuid || row.directPaymentReversalOfUuid === g.cashUuid || row.directPaymentUuid === replacementUuid)
  equal(cashRows.map(row => [row.amount, Boolean(row.directPaymentUuid), Boolean(row.directPaymentReversalOfUuid)]).sort(), [[-3000, false, true], [2500, true, false], [3000, true, false]].sort())
  const after = await loadDirectTrade(g.tradeUuid)
  equal([after.status, after.balances.customerRemaining, after.balances.supplierRemaining], ['ready', 2500, 3000])
  await noMismatches()
  validateDirectBackup(await snapshot())
}})

cases.push({ name: 'cancelling a customer-to-supplier payment restores both debts and never touches cash', run: async () => {
  const g = await golden()
  const cashRowsBefore = await db.cashMovements.count()
  const state = await loadDirectTrade(g.tradeUuid)
  const preview = await previewDirectPaymentCorrection(g.tradeUuid, g.directUuid, { action: 'cancel', reason: 'مشتری پرداخت نکرده بود' })
  equal([preview.allowed, preview.net.customer, preview.net.supplier, preview.net.cash], [true, 7000, 7000, []])
  const result = await correctDirectPayment(g.tradeUuid, g.directUuid, { action: 'cancel', reason: 'مشتری پرداخت نکرده بود' }, state.token)
  equal(result, undefined)
  equal(await g.balances(), [10000, 12000, g.cash0])
  equal(await db.cashMovements.count(), cashRowsBefore)
  const old = await db.payments.where('uuid').equals(g.directUuid).first()
  equal([old!.deleted, old!.cancelledReason], [true, 'مشتری پرداخت نکرده بود'])
  await noMismatches()
}})

cases.push({ name: 'payment corrections enforce caps, route shape, till cash and a real change', run: async () => {
  const g = await golden()
  const state = await loadDirectTrade(g.tradeUuid)
  // 6,000 cash + 7,000 direct would exceed the 12,000 sale.
  const over = await previewDirectPaymentCorrection(g.tradeUuid, g.cashUuid, { action: 'replace', date: DAY, amount: 6000, reason: 'x' })
  equal(over.allowed, false)
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, g.cashUuid, { action: 'replace', date: DAY, amount: 6000, reason: 'x' }, state.token), 'باقی')
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, g.cashUuid, { action: 'replace', date: DAY, amount: 3000, reason: 'x' }, state.token), 'تغییری')
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, g.cashUuid, { action: 'replace', date: DAY, amount: 0, reason: 'x' }, state.token), 'مبلغ')
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, g.cashUuid, { action: 'cancel', reason: '' }, state.token), 'دلیل')
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, newUuid(), { action: 'cancel', reason: 'x' }, state.token), 'یافت نشد')
  // Removing received cash must not drive the till negative.
  const drained = await cashBalance('دکان')
  await db.cashMovements.add({ uuid: newUuid(), date: DAY, type: 'transfer', amount: -(drained - 100), box: 'دکان', note: 'خالی کردن آزمایشی' })
  const fresh = await loadDirectTrade(g.tradeUuid)
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, g.cashUuid, { action: 'cancel', reason: 'x' }, fresh.token), 'کافی نیست')
}})

cases.push({ name: 'trade cancellation removes debt and profit, keeps real payments, then only allows payment cancellation', run: async () => {
  const g = await golden()
  const warehouse = await warehouseSnapshot()
  const before = await snapshot()
  const preview = await previewDirectTradeCancellation(g.tradeUuid)
  equal(await snapshot(), before)
  equal([preview.allowed, preview.net, preview.retained], [true, { customer: -12000, supplier: -10000, profit: -2000 }, { customerCash: 3000, supplierPaid: 0, customerToSupplier: 7000 }])
  await cancelDirectTrade(g.tradeUuid, 'اشتباه ثبت شده بود', preview.token)
  // Customer: 1,000 old debt − 10,000 paid = shop owes 9,000. Supplier: 2,000 − 7,000 = supplier owes 5,000.
  equal(await g.balances(), [-9000, -5000, g.cash0])
  const state = await loadDirectTrade(g.tradeUuid)
  equal([state.status, state.sale!.deleted, state.purchase!.deleted, state.sale!.cancelledReason, state.purchase!.cancelledReason], ['cancelled', true, true, 'اشتباه ثبت شده بود', 'اشتباه ثبت شده بود'])
  equal(state.payments.length, 2)
  equal(await warehouseSnapshot(), warehouse)
  await noMismatches()
  validateDirectBackup(await snapshot())

  await rejects(() => addDirectPayment(g.tradeUuid, { eventUuid: newUuid(), route: 'customerCash', date: DAY, amount: 100 }, state.token))
  await rejectsWithoutMutation(() => correctDirectTrade(g.tradeUuid, { date: DAY, lines: [{ ...line, qty: 9 }], reason: 'x' }, state.token), 'لغو')
  await rejectsWithoutMutation(() => cancelDirectTrade(g.tradeUuid, 'دوباره', state.token), 'لغو')
  await rejectsWithoutMutation(() => correctDirectPayment(g.tradeUuid, g.cashUuid, { action: 'replace', date: DAY, amount: 2000, reason: 'x' }, state.token), 'لغو')
  // An erroneous retained payment can still be cancelled on its audit record.
  await correctDirectPayment(g.tradeUuid, g.directUuid, { action: 'cancel', reason: 'پرداخت مستقیم نبود' }, state.token)
  equal(await g.balances(), [-2000, 2000, g.cash0])
  equal((await loadDirectTrade(g.tradeUuid)).status, 'cancelled')
  await noMismatches()
}})

cases.push({ name: 'trade cancellation waits for active freight to be handled first', run: async () => {
  const f = await seed()
  await db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } })
  const tradeUuid = newUuid()
  await createDirectTrade({ tradeUuid, date: DAY, customerId: f.customerId, supplierId: f.supplierId, lines: [line], payments: [],
    shipping: { date: DAY, total: 500, customerShare: 300, received: 0, box: 'دکان' } })
  const preview = await previewDirectTradeCancellation(tradeUuid)
  equal(preview.allowed, false)
  if (!preview.reasons.join(' ').includes('کرایه')) throw new Error('freight reason missing')
  await rejectsWithoutMutation(() => cancelDirectTrade(tradeUuid, 'اشتباه', preview.token), 'کرایه')
}})

cases.push({ name: 'trade cancellation refuses while a payment is dated after today', run: async () => {
  const f = await seed()
  await db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } })
  const tradeUuid = newUuid()
  const later = Date.now() + 3 * 86_400_000
  await createDirectTrade({ tradeUuid, date: DAY, customerId: f.customerId, supplierId: f.supplierId, lines: [line],
    payments: [{ eventUuid: newUuid(), route: 'customerToSupplier', date: later, amount: 1000 }] })
  const preview = await previewDirectTradeCancellation(tradeUuid)
  equal(preview.allowed, false)
  await rejectsWithoutMutation(() => cancelDirectTrade(tradeUuid, 'اشتباه', preview.token), 'آینده')
}})
