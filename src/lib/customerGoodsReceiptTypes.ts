import type { Adjustment, CashMovement, Payment, Sale } from '../db'

export interface CustomerGoodsReceiptLine {
  lineUuid: string
  productName: string
  size: string
  color: string
  qty: number
  unitCost: number
  photo?: string
  variantId?: number
  unitPrice?: number
}
export interface CreateCustomerGoodsReceiptInput {
  receiptUuid: string
  date: number
  customerId: number
  destination: 'warehouse' | 'onward'
  note?: string
  lines: CustomerGoodsReceiptLine[]
  onward?: { buyerId: number; paid: number; box?: string }
}
/** Portable request snapshot. Local IDs never participate in identity or fingerprints. */
export interface CustomerGoodsReceiptSnapshot {
  receiptUuid: string
  date: number
  customerUuid: string
  destination: 'warehouse' | 'onward'
  note?: string
  lines: Array<Omit<CustomerGoodsReceiptLine, 'variantId'> & { selectedVariantUuid?: string }>
  onward?: { buyerUuid: string; paid: number; box: string }
}
export interface CustomerGoodsReceiptMember {
  table: 'adjustments' | 'sales' | 'cashMovements'
  uuid: string
  lineUuid?: string
  variantUuid?: string
  priorUnitCost?: number
}
export interface CustomerGoodsReceiptMeta {
  schema: 1
  receiptUuid: string
  revision: string
  status: 'active' | 'cancelled'
  createdAt: number
  creationFingerprint: string
  snapshot: CustomerGoodsReceiptSnapshot
  members: CustomerGoodsReceiptMember[]
  correctionOfUuid?: string
  correctedByUuid?: string
  reason?: string
  cancelledAt?: number
  /** Token used for the original mutation; makes exact retries auditable. */
  mutationToken?: string
}
export interface CustomerGoodsReceiptChild {
  receiptUuid: string
  revision: string
  status: 'active' | 'cancelled'
}
export type CustomerGoodsReceiptSaleLine = Omit<CustomerGoodsReceiptLine, 'variantId' | 'unitPrice'> & { unitPrice: number }
export interface CustomerGoodsReceiptTotals {
  value: number
  pairs: number
  sale: number
  cost: number
  profit: number
  cash: number
  buyerDebt: number
}
export interface CustomerGoodsReceiptState {
  receiptUuid: string
  payment?: Payment
  adjustments: Adjustment[]
  sale?: Sale
  cashMovements: CashMovement[]
  status: 'ready' | 'incomplete' | 'conflict' | 'cancelled'
  token: string
  issues: string[]
  totals: CustomerGoodsReceiptTotals
  featureEnabled: boolean
  writeBlockReasons: string[]
}
export interface CustomerGoodsReceiptPreview {
  state: CustomerGoodsReceiptState
  token: string
  allowed: boolean
  writeBlockReasons: string[]
  net: { sourceDebt: number; stock: number; cash: number; buyerDebt: number; profit: number }
}

export const GOODS_RECEIPT_ERROR = 'این سند مربوط به دریافت جنس بابت طلب است؛ از عملیات مخصوص دریافت جنس استفاده کنید.'
export const RECEIPT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function receiptCanonical(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize) : v && typeof v === 'object'
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, normalize(x)])) : v
  return JSON.stringify(normalize(value))
}
export function receiptStableUuid(seed: string): string {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (let i = 0; i < seed.length; i++) for (let j = 0; j < hashes.length; j++) {
    hashes[j] = Math.imul(hashes[j] ^ (seed.charCodeAt(i) + j * 97), 0x01000193 + j * 2)
    hashes[j] ^= hashes[j] >>> 13
  }
  const h = hashes.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20)}`
}
export function receiptInteger(value: unknown, positive = false): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < (positive ? 1 : 0)) throw new Error('تعداد و مبلغ باید عدد صحیح معتبر باشد.')
}
export function receiptTotals(snapshot: Pick<CustomerGoodsReceiptSnapshot, 'lines' | 'destination' | 'onward'>): CustomerGoodsReceiptTotals {
  if (!Array.isArray(snapshot.lines) || !snapshot.lines.length) throw new Error('جنس دریافت‌شده را وارد کنید.')
  if (!['warehouse', 'onward'].includes(snapshot.destination)) throw new Error('مقصد دریافت معتبر نیست.')
  let value = 0, pairs = 0, sale = 0
  const seen = new Set<string>()
  for (const line of snapshot.lines) {
    if (!RECEIPT_UUID.test(line.lineUuid) || seen.has(line.lineUuid.toLowerCase())) throw new Error('شناسهٔ سطر معتبر و یکتا باشد.')
    seen.add(line.lineUuid.toLowerCase())
    for (const label of [line.productName, line.size, line.color]) if (typeof label !== 'string' || !label.trim()) throw new Error('نام جنس، سایز و رنگ ضروری است.')
    if (line.photo !== undefined && typeof line.photo !== 'string') throw new Error('عکس معتبر نیست.')
    receiptInteger(line.qty, true); receiptInteger(line.unitCost, true)
    pairs += line.qty; value += line.qty * line.unitCost
    receiptInteger(pairs, true); receiptInteger(value, true)
    if (snapshot.destination === 'onward') {
      receiptInteger(line.unitPrice, true)
      sale += line.qty * line.unitPrice
      receiptInteger(sale, true)
    } else if (line.unitPrice !== undefined) throw new Error('قیمت فروش برای دریافت گدام مجاز نیست.')
  }
  if (snapshot.destination === 'onward') {
    if (!snapshot.onward) throw new Error('خریدار فروش بعدی ضروری است.')
    receiptInteger(snapshot.onward.paid)
    if (snapshot.onward.paid > sale) throw new Error('نقد از مبلغ فروش بیشتر است.')
  } else if (snapshot.onward) throw new Error('دریافت گدام نباید فروش بعدی داشته باشد.')
  const cash = snapshot.onward?.paid ?? 0
  return { value, pairs, sale, cost: snapshot.destination === 'onward' ? value : 0, profit: snapshot.destination === 'onward' ? sale - value : 0, cash, buyerDebt: sale - cash }
}
