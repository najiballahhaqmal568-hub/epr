import { accessFlags, db, type Adjustment, type CashMovement, type Payment, type Sale } from '../db'
import { boxOf } from './financialPosting'
import { receiptCanonical, receiptStableUuid, receiptTotals, RECEIPT_UUID, type CustomerGoodsReceiptState, type CustomerGoodsReceiptTotals } from './customerGoodsReceiptTypes'
export type { CustomerGoodsReceiptState } from './customerGoodsReceiptTypes'

export async function customerGoodsReceiptFeatureEnabled(): Promise<boolean> {
  return (await db.settings.get('goodsReceiptCompatibilityAcknowledged'))?.value === true
}
export interface CustomerGoodsReceiptRows {
  payments: Payment[]
  adjustments: Adjustment[]
  sales: Sale[]
  cashMovements: CashMovement[]
}
const emptyTotals: CustomerGoodsReceiptTotals = { value: 0, pairs: 0, sale: 0, cost: 0, profit: 0, cash: 0, buyerDebt: 0 }
/** Pure aggregate validation, shared with import/sync boundaries. Includes tombstones. */
export function validateCustomerGoodsReceiptRows(receiptUuid: string, rows: CustomerGoodsReceiptRows): Pick<CustomerGoodsReceiptState, 'payment' | 'adjustments' | 'sale' | 'cashMovements' | 'status' | 'issues' | 'totals'> {
  const anchors = rows.payments.filter(p => p.goodsReceipt?.receiptUuid === receiptUuid)
  const adjustments = rows.adjustments.filter(a => a.goodsReceiptChild?.receiptUuid === receiptUuid)
  const sales = rows.sales.filter(s => s.goodsReceiptChild?.receiptUuid === receiptUuid)
  const cashMovements = rows.cashMovements.filter(c => c.goodsReceiptChild?.receiptUuid === receiptUuid)
  const payment = anchors[0], sale = sales[0]
  const issues: string[] = []
  let incomplete = false, totals = emptyTotals
  const result = () => ({ payment, adjustments, sale, cashMovements, issues, totals,
    status: (issues.length ? incomplete ? 'incomplete' : 'conflict' : payment?.goodsReceipt?.status === 'cancelled' ? 'cancelled' : 'ready') as CustomerGoodsReceiptState['status'] })
  if (!payment) { issues.push('سند اصلی دریافت هنوز نرسیده است.'); incomplete = true; return result() }
  const meta = payment.goodsReceipt!
  try {
    if (anchors.length !== 1 || !RECEIPT_UUID.test(receiptUuid) || payment.uuid !== receiptUuid || meta.schema !== 1 || meta.revision !== receiptStableUuid(`goods-revision:${receiptUuid}`) || !['active', 'cancelled'].includes(meta.status) || !Number.isSafeInteger(meta.createdAt) || meta.createdAt <= 0) throw new Error('شناسه یا نسخهٔ دریافت ناسازگار است.')
    const s = meta.snapshot
    if (!s || s.receiptUuid !== receiptUuid || !RECEIPT_UUID.test(s.customerUuid) || !Number.isSafeInteger(s.date) || s.date <= 0 || s.date > 8_640_000_000_000_000 || (s.note !== undefined && typeof s.note !== 'string')) throw new Error('مشخصات دریافت معتبر نیست.')
    if (s.onward && (!RECEIPT_UUID.test(s.onward.buyerUuid) || s.onward.buyerUuid === s.customerUuid || typeof s.onward.box !== 'string' || !s.onward.box.trim())) throw new Error('خریدار دریافت معتبر نیست.')
    if (s.lines.some(l => l.selectedVariantUuid !== undefined && !RECEIPT_UUID.test(l.selectedVariantUuid))) throw new Error('شناسهٔ جنس معتبر نیست.')
    totals = receiptTotals(s)
    if (meta.creationFingerprint !== receiptCanonical(s)) throw new Error('اثر انگشت دریافت ناسازگار است.')
    const cancelled = meta.status === 'cancelled'
    if (!!payment.deleted !== cancelled || payment.partyType !== 'customer' || payment.via !== 'goods' || payment.cashDelta !== 0 || payment.amount !== totals.value || payment.date !== s.date || payment.directPayment || payment.shipping || payment.groupUuid || payment.lenderAction || payment.sarrafId !== undefined || payment.lenderId !== undefined) throw new Error('سند طلب دریافت ناسازگار است.')
    if (cancelled && (!meta.reason?.trim() || !Number.isSafeInteger(meta.cancelledAt) || meta.cancelledAt! <= 0 || !meta.mutationToken || !RECEIPT_UUID.test(meta.mutationToken))) throw new Error('رد ابطال دریافت کامل نیست.')
    if ((meta.correctionOfUuid && (!RECEIPT_UUID.test(meta.correctionOfUuid) || meta.correctionOfUuid === receiptUuid)) || (meta.correctedByUuid && (!cancelled || !RECEIPT_UUID.test(meta.correctedByUuid) || meta.correctedByUuid === receiptUuid))) throw new Error('پیوند اصلاح معتبر نیست.')
    if (!Array.isArray(meta.members)) throw new Error('فهرست سندهای دریافت معتبر نیست.')
    const expectedCount = s.destination === 'warehouse' ? s.lines.length : 1 + Number(totals.cash > 0)
    if (meta.members.length !== expectedCount || new Set(meta.members.map(m => m.uuid)).size !== expectedCount) throw new Error('فهرست سندهای دریافت ناسازگار است.')
    for (const member of meta.members) {
      if (!['adjustments', 'sales', 'cashMovements'].includes(member.table) || !RECEIPT_UUID.test(member.uuid)) throw new Error('شناسهٔ سند فرزند معتبر نیست.')
      const seed = member.table === 'adjustments' ? `goods-adjustment:${receiptUuid}:${member.lineUuid}` : member.table === 'sales' ? `goods-sale:${receiptUuid}` : `goods-cash:${receiptUuid}`
      if (member.uuid !== receiptStableUuid(seed)) throw new Error('شناسهٔ ثابت سند فرزند ناسازگار است.')
      const matches = rows[member.table].filter(r => r.uuid === member.uuid)
      if (!matches.length) { incomplete = true; issues.push('سندهای دریافت هنوز کامل نرسیده‌اند.'); continue }
      if (matches.length !== 1) throw new Error('سند فرزند دریافت تکراری است.')
      const child = matches[0]
      if (child.goodsReceiptChild?.receiptUuid !== receiptUuid || child.goodsReceiptChild.revision !== meta.revision || child.goodsReceiptChild.status !== meta.status || !!child.deleted !== cancelled || child.date !== s.date) throw new Error('نسخهٔ سندهای دریافت هماهنگ نیست.')
      if (member.table === 'adjustments') {
        const a = child as Adjustment, l = s.lines.find(l => l.lineUuid === member.lineUuid)
        if (l?.selectedVariantUuid && member.variantUuid !== l.selectedVariantUuid) throw new Error('جنس فرزند با جنس انتخاب‌شده هماهنگ نیست.')
        if (s.destination !== 'warehouse' || !l || !member.variantUuid || !RECEIPT_UUID.test(member.variantUuid) || typeof member.priorUnitCost !== 'number' || !Number.isFinite(member.priorUnitCost) || member.priorUnitCost < 0 || a.qtyChange !== l.qty || a.unitCost !== l.unitCost || a.productName !== l.productName || a.size !== l.size || a.color !== l.color || a.reason !== 'correction' || a.refId !== undefined) throw new Error('تعدیل دریافت ناسازگار است.')
      } else if (member.table === 'sales') {
        const a = child as Sale
        const lines = s.lines.map(({ selectedVariantUuid: _variant, ...l }) => l)
        if (s.destination !== 'onward' || a.lines.length || a.directTrade || a.directLines || a.groupUuid || a.lenderAction || a.expenseCreditorId || a.cashPaid !== undefined || a.total !== totals.sale || a.paid !== totals.cash || (a.discount ?? 0) !== 0 || a.saleType !== 'wholesale' || receiptCanonical(a.goodsReceiptLines) !== receiptCanonical(lines)) throw new Error('فروش بعدی دریافت ناسازگار است.')
      } else {
        const a = child as CashMovement
        if (s.destination !== 'onward' || !totals.cash || a.amount !== totals.cash || a.type !== 'sale' || boxOf(a) !== s.onward?.box || a.directPaymentUuid || a.shippingPaymentUuid || a.transferUuid) throw new Error('صندوق دریافت ناسازگار است.')
      }
    }
    if (adjustments.length + sales.length + cashMovements.length !== meta.members.length && !incomplete) throw new Error('سند اضافی برای دریافت موجود است.')
    if (s.destination === 'warehouse' && (sales.length || cashMovements.length || new Set(meta.members.map(m => m.lineUuid)).size !== s.lines.length)) throw new Error('مقصد دریافت ناسازگار است.')
    if (s.destination === 'onward' && (adjustments.length || meta.members.filter(m => m.table === 'sales').length !== 1 || meta.members.filter(m => m.table === 'cashMovements').length !== Number(totals.cash > 0))) throw new Error('فهرست فروش بعدی ناسازگار است.')
  } catch (error) { incomplete = false; issues.push(error instanceof Error ? error.message : 'دریافت ناسازگار است.') }
  return result()
}

export async function loadCustomerGoodsReceipt(receiptUuid: string): Promise<CustomerGoodsReceiptState> {
  receiptUuid = receiptUuid.toLowerCase()
  const [payments, adjustments, sales, cashMovements, customers, variants, products, purchases, returns, featureEnabled] = await Promise.all([
    db.payments.toArray(), db.adjustments.toArray(), db.sales.toArray(), db.cashMovements.toArray(), db.customers.toArray(), db.variants.toArray(), db.products.toArray(), db.purchases.toArray(), db.returns.toArray(), customerGoodsReceiptFeatureEnabled()
  ])
  const base = validateCustomerGoodsReceiptRows(receiptUuid, { payments, adjustments, sales, cashMovements })
  const meta = base.payment?.goodsReceipt
  const issues = [...base.issues]
  if (meta) {
    const source = customers.find(c => c.id === base.payment?.partyId)
    if (!source || source.deleted || source.uuid !== meta.snapshot.customerUuid) issues.push('حساب مشتری دریافت یافت نشد یا هماهنگ نیست.')
    if (base.sale) {
      const buyer = customers.find(c => c.id === base.sale?.customerId)
      if (!buyer || buyer.deleted || buyer.uuid !== meta.snapshot.onward?.buyerUuid) issues.push('حساب خریدار یافت نشد یا هماهنگ نیست.')
    }
    for (const a of base.adjustments) {
      const v = variants.find(v => v.id === a.variantId), member = meta.members.find(m => m.uuid === a.uuid)
      if (!v || v.deleted || v.uuid !== member?.variantUuid || !products.some(p => p.id === v.productId && !p.deleted)) issues.push('جنس دریافت یافت نشد یا هماهنگ نیست.')
    }
    const successors = payments.filter(p => p.goodsReceipt?.correctionOfUuid === receiptUuid)
    if (successors.length > 1 || (successors.length && meta.correctedByUuid !== successors[0].uuid) || (meta.correctedByUuid && !successors.some(p => p.uuid === meta.correctedByUuid))) issues.push('پیوند اصلاح دریافت کامل یا یکتا نیست.')
    if (meta.correctionOfUuid && !payments.some(p => p.uuid === meta.correctionOfUuid && p.goodsReceipt?.correctedByUuid === receiptUuid && p.deleted)) issues.push('سند قبلی اصلاح دریافت هنوز هماهنگ نیست.')
  }
  const status = issues.length > base.issues.length ? 'conflict' : base.status
  const writeBlockReasons = [...issues]
  if (!featureEnabled) writeBlockReasons.push('ابتدا سازگاری نسخهٔ همهٔ دستگاه‌ها را تأیید کنید.')
  if (accessFlags.readOnly) writeBlockReasons.push('حساب شما فقط اجازهٔ مشاهده دارد.')
  if (status === 'cancelled') writeBlockReasons.push('این دریافت قبلاً باطل شده است.')
  // Conservative snapshot: changes to dependencies or party balances invalidate previews.
  const token = receiptStableUuid(receiptCanonical({ receiptUuid, payments, adjustments, sales, cashMovements, customers, variants, products, purchases, returns, featureEnabled, readOnly: accessFlags.readOnly }))
  return { ...base, receiptUuid, status, issues, featureEnabled, writeBlockReasons, token }
}
