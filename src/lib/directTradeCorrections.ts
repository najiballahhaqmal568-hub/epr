import { accessFlags, db, SYNC_TABLES, type Payment } from '../db'
import { directTotals, validateDirectPayments } from './directTradeMath'
import { applyEffects, insertPayment, stableUuid, UUID } from './directTradeOps'
import { directFeatureEnabled, loadDirectTrade, type DirectTradeState } from './directTradeState'
import type { DirectLine, DirectPaymentInput, DirectTotals } from './directTradeTypes'
import { boxOf, postCashMovement } from './financialPosting'
import { fmtMoney } from './format'

/*
 * Audited corrections and cancellation of direct trades.
 * Every write reverses the old document's shared effects and applies the new
 * one once (effects.ts), keeps the original as history, and is guarded by the
 * preview token so a stale screen can never post.
 */

export interface DirectTradeCorrectionInput { date: number; lines: DirectLine[]; reason: string }
export interface DirectNet { customer: number; supplier: number; profit: number }
export interface DirectTradeCorrectionPreview { allowed: boolean; reasons: string[]; token: string; net: DirectNet; next?: DirectTotals }
export interface DirectTradeCancellationPreview {
  allowed: boolean; reasons: string[]; token: string; net: DirectNet
  /** Real money already moved for this trade; it stays in the accounts after cancellation. */
  retained: { customerCash: number; supplierPaid: number; customerToSupplier: number }
}
export type DirectPaymentCorrectionInput =
  | { action: 'replace'; date: number; amount: number; sarrafAmount?: number; note?: string; reason: string }
  | { action: 'cancel'; reason: string }
export interface DirectPaymentCorrectionPreview {
  allowed: boolean; reasons: string[]; token: string
  net: { customer: number; supplier: number; cash: { box: string; delta: number }[] }
}

const MAX_DATE = 8_640_000_000_000_000
const ZERO_NET: DirectNet = { customer: 0, supplier: 0, profit: 0 }
const tables = () => [...SYNC_TABLES.map(table => db.table(table)), db.settings, db.syncState]
const validDate = (value: unknown) => Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= MAX_DATE
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)

async function eligibilityReasons(): Promise<string[]> {
  if (accessFlags.readOnly) return ['حساب شما فقط اجازهٔ مشاهده دارد.']
  const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
  if (profile?.role !== 'owner') return ['فقط مالک می‌تواند فروش مستقیم را اصلاح یا لغو کند.']
  if (!await directFeatureEnabled()) return ['فروش مستقیم هنوز برای ثبت فعال نشده است.']
  return []
}

function readinessReasons(state: DirectTradeState, allowCancelled = false): string[] {
  if (state.status === 'cancelled') return allowCancelled ? [] : ['این معامله لغو شده است؛ فقط لغو پرداخت اشتباه آن ممکن است.']
  if (state.status !== 'ready') return ['معاملهٔ مستقیم کامل و بدون تعارض نیست؛ اول همگام‌سازی کنید.']
  return []
}

function tokenReasons(state: DirectTradeState, expectedToken: string): string[] {
  return expectedToken === state.token ? [] : ['معلومات معامله تغییر کرده است؛ دوباره پیش‌نمایش بگیرید.']
}

function refuse(reasons: string[]): void {
  if (reasons.length) throw new Error(reasons[0])
}

async function parties(state: DirectTradeState) {
  const customer = state.sale?.customerId === undefined ? undefined : await db.customers.get(state.sale.customerId)
  const supplier = state.purchase ? await db.suppliers.get(state.purchase.supplierId) : undefined
  if (!customer?.uuid || !UUID.test(customer.uuid) || !supplier?.uuid || !UUID.test(supplier.uuid)) throw new Error('طرف حساب معامله یافت نشد')
  return { customer, supplier }
}

// ── Trade correction ────────────────────────────────────────────────────────

function planCorrection(state: DirectTradeState, input: DirectTradeCorrectionInput): { reasons: string[]; net: DirectNet; next?: DirectTotals } {
  const reasons: string[] = []
  if (typeof input.reason !== 'string' || !input.reason.trim()) reasons.push('دلیل اصلاح را بنویسید.')
  if (!validDate(input.date)) reasons.push('تاریخ درست را وارد کنید.')
  let next: DirectTotals | undefined
  try { next = directTotals(input.lines) } catch {
    reasons.push('جزئیات جنس درست نیست: نام، سایز، رنگ، تعداد مثبت و قیمت را با عدد صحیح بنویسید.')
  }
  if (!next || !state.sale) return { reasons, net: ZERO_NET }
  if (same(input.lines, state.sale.directLines) && input.date === state.sale.date) reasons.push('هیچ تغییری در معامله نیست.')
  const b = state.balances
  const fromCustomer = b.customerCash + b.customerToSupplier
  const toSupplier = b.supplierPaid + b.customerToSupplier
  if (fromCustomer > next.sale) reasons.push(`پول پرداخت‌شدهٔ مشتری (${fmtMoney(fromCustomer)}) از مجموع فروش تازه بیشتر است؛ اول پرداخت اشتباه را اصلاح کنید.`)
  if (toSupplier > next.cost) reasons.push(`پول پرداخت‌شده به فروشنده (${fmtMoney(toSupplier)}) از مجموع خرید تازه بیشتر است؛ اول پرداخت اشتباه را اصلاح کنید.`)
  return { reasons, next, net: { customer: next.sale - state.totals.sale, supplier: next.cost - state.totals.cost, profit: next.profit - state.totals.profit } }
}

/** Shows what a correction would change. Never writes. */
export async function previewDirectTradeCorrection(tradeUuid: string, input: DirectTradeCorrectionInput): Promise<DirectTradeCorrectionPreview> {
  const state = await loadDirectTrade(tradeUuid.toLowerCase())
  const plan = planCorrection(state, input)
  const reasons = [...await eligibilityReasons(), ...readinessReasons(state), ...plan.reasons]
  return { allowed: reasons.length === 0, reasons, token: state.token, net: plan.net, next: plan.next }
}

/** Corrects goods, prices or date on both halves of the trade as one revision; the old version stays in its history. */
export async function correctDirectTrade(tradeUuid: string, input: DirectTradeCorrectionInput, expectedToken: string): Promise<void> {
  tradeUuid = tradeUuid.toLowerCase()
  return db.transaction('rw', tables(), async () => {
    refuse(await eligibilityReasons())
    const state = await loadDirectTrade(tradeUuid)
    refuse(readinessReasons(state))
    refuse(tokenReasons(state, expectedToken))
    const plan = planCorrection(state, input)
    refuse(plan.reasons)
    const sale = state.sale!, purchase = state.purchase!
    const oldRevision = sale.directTrade!.revision
    const revision = stableUuid(`direct-correction:${tradeUuid}:${oldRevision}`)
    const correctedAt = Date.now()
    const history = [...(sale.directTrade!.corrections ?? []), { revision: oldRevision, date: sale.date, lines: sale.directLines ?? [], reason: input.reason.trim(), correctedAt }]
    const lines = input.lines.map(line => ({ ...line }))
    await applyEffects(sale, 'sales', -1)
    await applyEffects(purchase, 'purchases', -1)
    const nextSale = { ...sale, date: input.date, directLines: lines, total: plan.next!.sale,
      directTrade: { ...sale.directTrade!, revision, previousRevision: oldRevision, corrections: history } }
    const nextPurchase = { ...purchase, date: input.date, directLines: lines, total: plan.next!.cost,
      directTrade: { ...purchase.directTrade!, revision, previousRevision: oldRevision, corrections: history } }
    await db.sales.update(sale.id!, { date: nextSale.date, directLines: nextSale.directLines, total: nextSale.total, directTrade: nextSale.directTrade })
    await db.purchases.update(purchase.id!, { date: nextPurchase.date, directLines: nextPurchase.directLines, total: nextPurchase.total, directTrade: nextPurchase.directTrade })
    await applyEffects(nextSale, 'sales')
    await applyEffects(nextPurchase, 'purchases')
  })
}

// ── Trade cancellation ──────────────────────────────────────────────────────

async function activeFreight(state: DirectTradeState): Promise<boolean> {
  const saleUuid = state.sale?.uuid
  if (!saleUuid) return false
  return (await db.payments.filter(row => !row.deleted && row.shipping?.saleUuid === saleUuid).count()) > 0
}

async function planCancellation(state: DirectTradeState, reason?: string): Promise<string[]> {
  const reasons: string[] = []
  if (reason !== undefined && !reason.trim()) reasons.push('دلیل لغو را بنویسید.')
  if (await activeFreight(state)) reasons.push('این معامله کرایهٔ فعال دارد؛ اول کرایه را از جزئیات معامله لغو کنید. لغو جنس، کرایه را برنمی‌گرداند.')
  // A payment dated after the cancellation would read as "paid after cancelling" and block the trade.
  if (state.payments.some(payment => payment.date > Date.now())) reasons.push('این معامله پرداختی با تاریخ آینده دارد؛ اول تاریخ آن پرداخت را اصلاح کنید.')
  return reasons
}

/** Shows what cancelling would remove and which real payments stay. Never writes. */
export async function previewDirectTradeCancellation(tradeUuid: string): Promise<DirectTradeCancellationPreview> {
  const state = await loadDirectTrade(tradeUuid.toLowerCase())
  const reasons = [...await eligibilityReasons(), ...readinessReasons(state), ...await planCancellation(state)]
  const b = state.balances
  return { allowed: reasons.length === 0, reasons, token: state.token,
    net: { customer: -state.totals.sale, supplier: -state.totals.cost, profit: -state.totals.profit },
    retained: { customerCash: b.customerCash, supplierPaid: b.supplierPaid, customerToSupplier: b.customerToSupplier } }
}

/** Cancels a mistaken trade: its debts and profit leave the books, the documents stay for audit, payments are untouched. */
export async function cancelDirectTrade(tradeUuid: string, reason: string, expectedToken: string): Promise<void> {
  tradeUuid = tradeUuid.toLowerCase()
  return db.transaction('rw', tables(), async () => {
    refuse(await eligibilityReasons())
    const state = await loadDirectTrade(tradeUuid)
    refuse(readinessReasons(state))
    refuse(tokenReasons(state, expectedToken))
    refuse(await planCancellation(state, reason ?? ''))
    const sale = state.sale!, purchase = state.purchase!
    const oldRevision = sale.directTrade!.revision
    const revision = stableUuid(`direct-cancellation:${tradeUuid}:${oldRevision}`)
    const cancelledAt = Date.now()
    const cancelledReason = reason.trim()
    await applyEffects(sale, 'sales', -1)
    await applyEffects(purchase, 'purchases', -1)
    await db.sales.update(sale.id!, { deleted: true, cancelledAt, cancelledReason,
      directTrade: { ...sale.directTrade!, status: 'cancelled', revision, previousRevision: oldRevision } })
    await db.purchases.update(purchase.id!, { deleted: true, cancelledAt, cancelledReason,
      directTrade: { ...purchase.directTrade!, status: 'cancelled', revision, previousRevision: oldRevision } })
  })
}

// ── Payment correction / cancellation ──────────────────────────────────────

function paymentInput(old: Payment, input: Extract<DirectPaymentCorrectionInput, { action: 'replace' }>, eventUuid: string): DirectPaymentInput {
  const route = old.directPayment!.route
  const sarrafAmount = route === 'supplierPayment' ? input.sarrafAmount ?? old.sarrafAmount ?? 0 : undefined
  return {
    eventUuid, route, date: input.date, amount: input.amount,
    box: route === 'customerToSupplier' ? undefined : boxOf(old),
    sarrafId: route === 'supplierPayment' && sarrafAmount ? old.sarrafId : undefined,
    sarrafAmount: route === 'supplierPayment' && sarrafAmount ? sarrafAmount : undefined,
    note: input.note === undefined ? old.note : input.note.trim() || undefined
  }
}

function planPayment(state: DirectTradeState, old: Payment | undefined, input: DirectPaymentCorrectionInput): {
  reasons: string[]; next?: DirectPaymentInput; net: DirectPaymentCorrectionPreview['net']
} {
  const net = { customer: 0, supplier: 0, cash: [] as { box: string; delta: number }[] }
  if (!old) return { reasons: ['پرداخت این معامله یافت نشد.'], net }
  const reasons: string[] = []
  if (typeof input.reason !== 'string' || !input.reason.trim()) reasons.push('دلیل اصلاح یا لغو پرداخت را بنویسید.')
  if (input.action === 'replace' && state.status === 'cancelled') reasons.push('این معامله لغو شده است؛ پرداخت آن فقط لغو می‌شود، نه اصلاح.')
  const route = old.directPayment!.route
  let next: DirectPaymentInput | undefined
  if (input.action === 'replace') {
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) reasons.push('مبلغ درست و بیشتر از صفر بنویسید.')
    if (!validDate(input.date)) reasons.push('تاریخ درست را وارد کنید.')
    const sarraf = input.sarrafAmount ?? old.sarrafAmount ?? 0
    if (route === 'supplierPayment' && sarraf > 0 && old.sarrafId === undefined) reasons.push('برای این پرداخت صراف انتخاب نشده بود؛ آن را لغو و دوباره ثبت کنید.')
    if (route === 'supplierPayment' && (!Number.isSafeInteger(sarraf) || sarraf < 0 || sarraf > input.amount)) reasons.push('سهم صراف نباید از مبلغ پرداخت بیشتر باشد.')
    if (reasons.length) return { reasons, net }
    next = paymentInput(old, input, stableUuid(`direct-payment-correction:${old.uuid}`))
    if (next.amount === old.amount && next.date === old.date && (next.note ?? undefined) === (old.note ?? undefined) && (next.sarrafAmount ?? 0) === (old.sarrafAmount ?? 0)) {
      reasons.push('هیچ تغییری در پرداخت نیست.')
    }
    try { validateDirectPayments(state.totals, state.payments.filter(row => row.uuid !== old.uuid), [next]) } catch {
      reasons.push('مبلغ از باقی‌ماندهٔ این معامله بیشتر است.')
    }
  }
  const newAmount = next?.amount ?? 0
  if (route !== 'supplierPayment') net.customer = old.amount - newAmount
  if (route !== 'customerCash') net.supplier = old.amount - newAmount
  const newCash = next ? (route === 'customerCash' ? next.amount : route === 'supplierPayment' ? -(next.amount - (next.sarrafAmount ?? 0)) : 0) : 0
  const cashDelta = newCash - (old.cashDelta ?? 0)
  if (cashDelta !== 0) net.cash.push({ box: boxOf(old), delta: cashDelta })
  return { reasons, next, net }
}

/** Shows how correcting or cancelling one payment changes both accounts and the till. Never writes. */
export async function previewDirectPaymentCorrection(tradeUuid: string, paymentUuid: string, input: DirectPaymentCorrectionInput): Promise<DirectPaymentCorrectionPreview> {
  const state = await loadDirectTrade(tradeUuid.toLowerCase())
  const old = state.payments.find(row => row.uuid === paymentUuid.toLowerCase())
  const plan = planPayment(state, old, input)
  const reasons = [...await eligibilityReasons(), ...readinessReasons(state, true), ...plan.reasons]
  return { allowed: reasons.length === 0, reasons, token: state.token, net: plan.net }
}

/**
 * Replaces or cancels one direct payment. The original stays as a tombstone
 * linked to its replacement; its cash row stays and an explicit reversal row is
 * appended. Returns the replacement's UUID, or undefined for a cancellation.
 */
export async function correctDirectPayment(tradeUuid: string, paymentUuid: string, input: DirectPaymentCorrectionInput, expectedToken: string): Promise<string | undefined> {
  tradeUuid = tradeUuid.toLowerCase()
  paymentUuid = paymentUuid.toLowerCase()
  return db.transaction('rw', tables(), async () => {
    refuse(await eligibilityReasons())
    const state = await loadDirectTrade(tradeUuid)
    refuse(readinessReasons(state, true))
    refuse(tokenReasons(state, expectedToken))
    const old = state.payments.find(row => row.uuid === paymentUuid)
    const plan = planPayment(state, old, input)
    refuse(plan.reasons)
    const { customer, supplier } = await parties(state)
    const now = Date.now()
    const reason = input.reason.trim()
    await applyEffects(old!, 'payments', -1)
    await db.payments.update(old!.id!, input.action === 'cancel'
      ? { deleted: true, cancelledReason: reason, cancelledAt: now }
      : { deleted: true, correctedByUuid: plan.next!.eventUuid, correctedAt: now })

    const reversal = old!.cashDelta ? {
      uuid: stableUuid(`direct-cash-reversal:${old!.uuid}`), directPaymentReversalOfUuid: old!.uuid, date: now,
      type: old!.partyType === 'customer' ? 'customerPayment' as const : 'supplierPayment' as const, refId: old!.id,
      amount: -old!.cashDelta, box: boxOf(old!), note: `${input.action === 'cancel' ? 'لغو' : 'اصلاح'} پرداخت فروش مستقیم — ${old!.partyName}`
    } : undefined
    // Money coming back into the till is posted first, so only the net result must be covered.
    if (reversal && reversal.amount > 0) await postCashMovement(reversal)
    if (plan.next) {
      await insertPayment(tradeUuid, plan.next, customer, supplier, {
        correctionOfUuid: old!.uuid, correctionReason: reason, correctedAt: now,
        correctionPrevious: { date: old!.date, amount: old!.amount, via: old!.via, cashDelta: old!.cashDelta ?? 0,
          sarrafName: old!.sarrafName, sarrafAmount: old!.sarrafAmount, note: old!.note, box: old!.box }
      })
    }
    if (reversal && reversal.amount < 0) await postCashMovement(reversal)
    return plan.next?.eventUuid
  })
}
