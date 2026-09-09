import { accessFlags, db, type CashMovement, type Expense, type Payment, type Purchase, type Sale } from '../db'
import { directBalances, directTotals } from './directTradeMath'
import type { DirectBalances, DirectTotals } from './directTradeTypes'

export interface DirectTradeState {
  sale?: Sale
  purchase?: Purchase
  payments: Payment[]
  totals: DirectTotals
  balances: DirectBalances
  status: 'ready' | 'incomplete' | 'conflict' | 'cancelled'
  token: string
  issues: string[]
  /** Snapshot of local creation eligibility; operations must reload it in their transaction. */
  featureEnabled: boolean
}

const ZERO_TOTALS: DirectTotals = { cost: 0, sale: 0, profit: 0, pairs: 0 }
const ZERO_BALANCES: DirectBalances = { customerRemaining: 0, supplierRemaining: 0, customerCash: 0, supplierPaid: 0, customerToSupplier: 0, cashDelta: 0, overallocated: false }
const MAX_DATE = 8_640_000_000_000_000

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([key, child]) => key !== 'id' && key !== 'localUpdatedAt' && !(key === 'deleted' && child === false))
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, canonical(child)]))
  return value
}

function validDate(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_DATE
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
}

function validatePayment(payment: Payment, sale: Sale, purchase: Purchase): string | undefined {
  const route = payment.directPayment?.route
  if (!validDate(payment.date)) return 'تاریخ پرداخت مستقیم معتبر نیست.'
  if (!Number.isSafeInteger(payment.amount) || payment.amount <= 0 || !Number.isSafeInteger(payment.cashDelta)) return 'مبلغ پرداخت مستقیم معتبر نیست.'
  if (route === 'customerCash') {
    if (payment.partyType !== 'customer' || payment.partyId !== sale.customerId || payment.cashDelta !== payment.amount || payment.via !== 'cash' || payment.sarrafId !== undefined || payment.sarrafAmount !== undefined) return 'مسیر دریافت نقدی مشتری با سند سازگار نیست.'
  } else if (route === 'supplierPayment') {
    const sarraf = payment.sarrafAmount ?? 0
    if (!Number.isSafeInteger(sarraf) || sarraf < 0 || sarraf > payment.amount || payment.partyType !== 'supplier' || payment.partyId !== purchase.supplierId || payment.cashDelta !== -(payment.amount - sarraf)) return 'مسیر پرداخت فروشنده با سند سازگار نیست.'
    if ((sarraf > 0 && (payment.via !== 'sarraf' || payment.sarrafId === undefined)) || (sarraf === 0 && payment.via !== 'cash')) return 'منبع پرداخت فروشنده معتبر نیست.'
  } else if (route === 'customerToSupplier') {
    if (payment.partyType !== 'customer' || payment.partyId !== sale.customerId || payment.directPayment?.supplierId !== purchase.supplierId || payment.cashDelta !== 0 || payment.via !== undefined || payment.sarrafId !== undefined || payment.sarrafAmount !== undefined) return 'مسیر پرداخت مستقیم مشتری به فروشنده سازگار نیست.'
  } else return 'نوع پرداخت مستقیم ناشناخته است.'
}

function validateBase(sale: Sale, purchase: Purchase): { totals?: DirectTotals; issues: string[] } {
  const issues: string[] = []
  if (!validDate(sale.date) || !validDate(purchase.date)) issues.push('تاریخ معاملهٔ مستقیم معتبر نیست.')
  if (!Array.isArray(sale.lines) || !Array.isArray(purchase.lines) || sale.lines.length || purchase.lines.length) issues.push('معاملهٔ مستقیم نباید خط فزیکی گدام داشته باشد.')
  if (!Array.isArray(sale.directLines) || !Array.isArray(purchase.directLines)) issues.push('جزئیات تجارتی معامله یافت نشد.')
  if (sale.paid !== 0 || (sale.discount ?? 0) !== 0 || purchase.paid !== 0 || (purchase.sarrafAmount ?? 0) !== 0 || (purchase.landingCost ?? 0) !== 0 || (purchase.landingUnpaid ?? 0) !== 0 || (purchase.landingSarrafAmount ?? 0) !== 0) issues.push('فیلد پرداخت یا مصرف گدام در معاملهٔ مستقیم صفر نیست.')
  if (sale.cashPaid !== undefined || sale.lenderAction !== undefined || sale.lenderId !== undefined || sale.expenseCreditorId !== undefined || purchase.sarrafId !== undefined || purchase.landingVia !== undefined || purchase.landingSarrafId !== undefined || purchase.landingPaid !== undefined || purchase.receivedAt !== undefined) issues.push('معاملهٔ مستقیم فیلد پرداخت یا تسویهٔ ناسازگار دارد.')
  if (purchase.received !== false) issues.push('خرید مستقیم نباید به‌عنوان جنس رسیده به گدام ثبت شود.')
  const sm = sale.directTrade!, pm = purchase.directTrade!
  if (typeof sm.uuid !== 'string' || !sm.uuid.trim() || typeof sm.revision !== 'string' || !sm.revision.trim() || typeof sm.counterpartUuid !== 'string' || !sm.counterpartUuid.trim() ||
      typeof pm.uuid !== 'string' || !pm.uuid.trim() || typeof pm.revision !== 'string' || !pm.revision.trim() || typeof pm.counterpartUuid !== 'string' || !pm.counterpartUuid.trim() ||
      !['active','cancelled'].includes(sm.status) || !['active','cancelled'].includes(pm.status)) issues.push('شناسه یا نسخهٔ معاملهٔ مستقیم معتبر نیست.')
  if (sm.uuid !== pm.uuid || sm.revision !== pm.revision || sm.status !== pm.status || sm.counterpartUuid !== purchase.uuid || pm.counterpartUuid !== sale.uuid) issues.push('دو نیمهٔ معامله نسخه یا پیوند یکسان ندارند.')
  if (sale.date !== purchase.date || !same(sale.directLines, purchase.directLines)) issues.push('جزئیات تجارتی دو نیمهٔ معامله یکسان نیست.')
  let totals: DirectTotals | undefined
  try {
    totals = directTotals(Array.isArray(sale.directLines) ? sale.directLines : [])
    if (sale.total !== totals.sale || purchase.total !== totals.cost) issues.push('جمع ذخیره‌شده با جزئیات معامله سازگار نیست.')
  } catch { issues.push('جزئیات یا جمع معاملهٔ مستقیم معتبر نیست.') }
  return { totals, issues }
}

export async function loadDirectTrade(tradeUuid: string): Promise<DirectTradeState> {
  const [sales, purchases, allPayments, conflictRows] = await Promise.all([
    db.sales.filter(row => row.directTrade?.uuid === tradeUuid).toArray(),
    db.purchases.filter(row => row.directTrade?.uuid === tradeUuid).toArray(),
    db.payments.filter(row => !row.deleted && row.directPayment?.tradeUuid === tradeUuid).toArray(),
    db.syncState.filter(row => row.key.startsWith(`directConflict:${tradeUuid}:`)).toArray()
  ])
  const sale = sales.length === 1 ? sales[0] : undefined
  const purchase = purchases.length === 1 ? purchases[0] : undefined
  const payments = allPayments.sort((a, b) => (a.uuid ?? '').localeCompare(b.uuid ?? ''))
  const issues: string[] = []
  if (sales.length !== 1 || purchases.length !== 1) issues.push('هر دو نیمهٔ معاملهٔ مستقیم هنوز همگام نشده است.')
  if (sales.length > 1 || purchases.length > 1) issues.push('برای این معامله چند سند پایه یافت شد.')
  if (conflictRows.length) issues.push('نسخه‌های رقیب این سند دریافت شده است.')
  let totals = ZERO_TOTALS
  let balances = ZERO_BALANCES
  if (sale && purchase) {
    const base = validateBase(sale, purchase); issues.push(...base.issues)
    if (base.totals) {
      totals = base.totals
      for (const payment of payments) { const issue = validatePayment(payment, sale, purchase); if (issue) issues.push(issue) }
      try { balances = directBalances(totals, payments) } catch { issues.push('جمع پرداخت‌های مستقیم معتبر نیست.') }
      if (balances.overallocated) issues.push('پرداخت‌ها از بیلانس معامله بیشتر است.')
      const cancelledAt = sale.cancelledAt ?? 0
      if (sale.directTrade?.status === 'cancelled' && payments.some(payment => payment.date > cancelledAt)) issues.push('پس از لغو معامله پرداخت فعال ثبت شده است.')
    }
    const customer = sale.customerId === undefined ? undefined : await db.customers.get(sale.customerId)
    const supplier = await db.suppliers.get(purchase.supplierId)
    if (!customer || customer.deleted || !supplier || supplier.deleted) issues.push('حساب مشتری یا فروشندهٔ معامله فعال نیست.')
    for (const payment of payments) if (payment.sarrafId !== undefined) {
      const sarraf = await db.suppliers.get(payment.sarrafId)
      if (!sarraf || sarraf.deleted) issues.push('حساب صراف پرداخت فعال نیست.')
    }
  }
  const freightPayments = sale?.uuid ? await db.payments.filter(row => row.shipping?.saleUuid === sale.uuid).toArray() : []
  const freightUuids = new Set(freightPayments.map(row => row.uuid).filter((uuid): uuid is string => Boolean(uuid)))
  const [freightExpenses, freightCash] = await Promise.all([
    db.expenses.filter((row: Expense) => Boolean(row.shippingPaymentUuid && freightUuids.has(row.shippingPaymentUuid))).toArray(),
    db.cashMovements.filter((row: CashMovement) => Boolean(row.shippingPaymentUuid && freightUuids.has(row.shippingPaymentUuid))).toArray()
  ])
  const parties = []
  const customer = sale?.customerId !== undefined ? await db.customers.get(sale.customerId) : undefined
  if (customer) parties.push(['customer', customer.uuid ?? null, customer.balance])
  const supplierIds = new Set<number>([purchase?.supplierId, ...payments.map(p => p.sarrafId), ...payments.map(p => p.directPayment?.supplierId)].filter((id): id is number => typeof id === 'number'))
  const supplierRefs = new Map<number, { uuid?: string; balance: number }>()
  for (const id of supplierIds) { const row = await db.suppliers.get(id); if (row) supplierRefs.set(id, row) }
  for (const row of [...supplierRefs.values()].sort((a,b)=>(a.uuid ?? '').localeCompare(b.uuid ?? ''))) parties.push(['supplier', row.uuid ?? null, row.balance])
  const cancelled = sale?.directTrade?.status === 'cancelled' && purchase?.directTrade?.status === 'cancelled'
  const status: DirectTradeState['status'] = !sale || !purchase ? 'incomplete' : issues.length ? 'conflict' : cancelled ? 'cancelled' : 'ready'
  const portableSale = sale ? { ...sale, customerId: undefined, customerUuid: customer?.uuid } : undefined
  const purchaseSupplier = purchase ? supplierRefs.get(purchase.supplierId) : undefined
  const portablePurchase = purchase ? { ...purchase, supplierId: undefined, supplierUuid: purchaseSupplier?.uuid } : undefined
  const portablePayments = payments.map(payment => ({ ...payment, partyId: undefined,
    partyUuid: payment.partyType === 'customer' ? customer?.uuid : supplierRefs.get(payment.partyId)?.uuid,
    sarrafId: undefined, sarrafUuid: payment.sarrafId === undefined ? undefined : supplierRefs.get(payment.sarrafId)?.uuid,
    directPayment: payment.directPayment ? { ...payment.directPayment, supplierId: undefined,
      supplierUuid: payment.directPayment.supplierId === undefined ? payment.directPayment.supplierUuid : supplierRefs.get(payment.directPayment.supplierId)?.uuid } : undefined }))
  const token = JSON.stringify(canonical({ tradeUuid, sale: portableSale, purchase: portablePurchase, payments: portablePayments, freightPayments, freightExpenses, freightCash, parties, conflictRows: conflictRows.map(row => row.value) }))
  const featureEnabled = await directFeatureEnabled()
  return { sale, purchase, payments, totals, balances, status, token, issues, featureEnabled }
}

export async function directFeatureEnabled(): Promise<boolean> {
  return (await db.settings.get('directTrades.enabled'))?.value === true
}

export function assertDirectWriteReady(state: DirectTradeState, expectedToken?: string): void {
  if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
  if (expectedToken !== undefined && expectedToken !== state.token) throw new Error('معلومات معامله تغییر کرده است؛ دوباره بررسی کنید.')
  if (state.status === 'cancelled') throw new Error('معامله لغو شده است و پرداخت تازه نمی‌پذیرد.')
  if (state.status !== 'ready') throw new Error('معاملهٔ مستقیم کامل و بدون تعارض نیست.')
  // Eligibility is loaded explicitly so future operations can recheck it inside
  // their write transaction together with a freshly loaded state.
  if (!state.featureEnabled) throw new Error('فروش مستقیم هنوز برای ثبت فعال نشده است.')
}
