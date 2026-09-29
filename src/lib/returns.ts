/**
 * مرجوعی مشتری از یک فروش — یک قاعده برای صفحهٔ مرجوعی، صفحهٔ تبادله و ops.
 *
 *  • از هر خط فروش بیشتر از آنچه فروخته شده (منهای برگشت‌های قبلی) برنمی‌گردد.
 *    پیش از این، هر بار صفحهٔ مرجوعی تمام تعداد فروش را اجازه می‌داد؛ دو بار مرجوعی
 *    همان جوړه‌ها را دو بار به گدام و دو بار به حساب مشتری برمی‌گرداند.
 *  • پولی که پس داده می‌شود همان است که مشتری داده: قیمت جوړه‌ها منهای سهمِ همین
 *    جوړه‌ها از تخفیف فاکتور. سهم تجمعی حساب می‌شود، پس وقتی همه چیز برگشت،
 *    مجموع سهم‌ها دقیقاً برابر تخفیف است — نه یک افغانی کم یا زیاد.
 *
 * این فایل هیچ دیتابیسی نمی‌خواند؛ هر کس صدا می‌زند، فروش و مرجوعی‌های قبلی را می‌دهد.
 */
import type { Purchase, ReturnDoc, ReturnLine, Sale } from '../db'

const valueOf = (lines: { qty: number; unitPrice: number }[]) => lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)

/** مرجوعی‌های زندهٔ همین فروش */
export function priorReturnsOf(sale: Sale, returns: ReturnDoc[]): ReturnDoc[] {
  if (sale.id === undefined) return []
  return returns.filter((r) => !r.deleted && r.kind === 'customer' && r.refId === sale.id)
}

/**
 * جای دادن یک خط برگشتی در خطوط فروش — اول خطی با همان قیمت، بعد هر خطِ همان جنس.
 * تعدادی که جا نشد برگردانده می‌شود.
 */
type PricedLine = { variantId: number; unitPrice: number }

function take(docLines: PricedLine[], left: number[], line: { variantId: number; unitPrice: number; qty: number }): number {
  let rest = line.qty
  const same = (i: number) => (docLines[i].unitPrice === line.unitPrice ? 0 : 1)
  const order = docLines.map((_, i) => i).sort((a, b) => same(a) - same(b) || a - b)
  for (const i of order) {
    if (rest <= 0) break
    if (docLines[i].variantId !== line.variantId) continue
    const n = Math.min(rest, left[i])
    left[i] -= n
    rest -= n
  }
  return rest
}

/** برای هر خط فروش (به همان ترتیب)، چند جوړه هنوز قابل برگشت است */
export function returnableQtys(sale: Sale, prior: ReturnDoc[]): number[] {
  const left = sale.lines.map((l) => l.qty)
  for (const r of prior) for (const l of r.lines) take(sale.lines, left, l)
  return left
}

export interface ReturnRefund {
  /** قیمت جوړه‌های برگشتی به قیمت فاکتور */
  gross: number
  /** سهم همین جوړه‌ها از تخفیف فاکتور — پس داده نمی‌شود، چون مشتری آن را نداده بود */
  discount: number
  /** پولی که واقعاً پس داده می‌شود یا از قرض مشتری کم می‌شود */
  amount: number
}

/** پول برگشتی برای qtys (تعداد برگشتی از هر خط فروش، به همان ترتیب) */
export function returnRefund(sale: Sale, prior: ReturnDoc[], qtys: number[]): ReturnRefund {
  const gross = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)
  const saleGross = valueOf(sale.lines)
  const before = prior.reduce((s, r) => s + valueOf(r.lines), 0)
  const saleDiscount = sale.discount ?? 0
  const shareUpTo = (v: number) => (saleGross > 0 ? Math.round((saleDiscount * Math.min(v, saleGross)) / saleGross) : 0)
  const discount = shareUpTo(before + gross) - shareUpTo(before)
  return { gross, discount, amount: gross - discount }
}

/**
 * بررسی یک مرجوعی پیش از ثبت. یا متن خطا برمی‌گرداند، یا تعداد هر خط و پول درست را.
 * ops همین را صدا می‌زند تا هیچ راهی (صفحه، تبادله، ورود دیگر) از آن نگذرد.
 */
export function checkReturn(sale: Sale, prior: ReturnDoc[], lines: ReturnLine[]): { qtys: number[]; refund: ReturnRefund } | string {
  const left = returnableQtys(sale, prior)
  const start = [...left]
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) return 'تعداد برگشتی باید عدد صحیح و بیشتر از صفر باشد'
    if (take(sale.lines, left, l) > 0) return `${l.productName} ${l.size}: بیشتر از آنچه فروخته شده (یا قبلاً برگشت خورده) پس گرفته نمی‌شود`
  }
  const qtys = start.map((n, i) => n - left[i])
  const refund = returnRefund(sale, prior, qtys)
  if (valueOf(lines) !== refund.gross) return 'قیمت جنس برگشتی با قیمت همان فروش یکی نیست'
  return { qtys, refund }
}

/** مفادی که با مرجوعی مشتری پس گرفته می‌شود — سهم تخفیف قبلاً در مفاد فروش کم شده بود */
export function returnProfit(r: ReturnDoc): number {
  return r.lines.reduce((a, l) => a + (l.unitPrice - (l.unitCost ?? 0)) * l.qty, 0) - (r.discount ?? 0)
}

export interface OverReturnedSale {
  id?: number
  date: number
  customerName?: string
  /** جوړه‌هایی که بیشتر از فروش برگشت خورده */
  extraPairs: number
  /** پولی که بیشتر از آنچه مشتری داده بود پس داده شد یا از قرضش کم شد */
  extraMoney: number
}

/**
 * فروش‌های قدیمی که پیش از این قاعده، بیشتر از فروخته یا بیشتر از پولِ داده‌شده برگشت خورده‌اند.
 * فقط نشان داده می‌شود و هیچ عددی خودکار عوض نمی‌شود — شاید مالک آن را عمداً یا بعداً جبران کرده باشد.
 */
export function overReturnedSales(sales: Sale[], returns: ReturnDoc[]): OverReturnedSale[] {
  const out: OverReturnedSale[] = []
  for (const sale of sales) {
    if (sale.deleted || sale.directTrade || sale.goodsReceiptChild) continue
    const prior = priorReturnsOf(sale, returns)
    if (!prior.length) continue
    const left = sale.lines.map((l) => l.qty)
    let extraPairs = 0
    for (const r of prior) for (const l of r.lines) extraPairs += take(sale.lines, left, l)
    const fair = returnRefund(sale, [], sale.lines.map((l, i) => l.qty - left[i])).amount
    const extraMoney = Math.max(0, prior.reduce((s, r) => s + r.amount, 0) - fair)
    if (extraPairs > 0 || extraMoney > 0) out.push({ id: sale.id, date: sale.date, customerName: sale.customerName, extraPairs, extraMoney })
  }
  return out.sort((a, b) => b.date - a.date)
}

// ── مرجوعی به تأمین‌کننده از روی یک خرید ─────────────────────────────

const purchaseLines = (purchase: Purchase): PricedLine[] => purchase.lines.map((l) => ({ variantId: l.variantId, unitPrice: l.unitCost }))

/** مرجوعی‌های زندهٔ همین خرید */
export function priorSupplierReturnsOf(purchase: Purchase, returns: ReturnDoc[]): ReturnDoc[] {
  if (purchase.id === undefined) return []
  return returns.filter((r) => !r.deleted && r.kind === 'supplier' && r.refId === purchase.id)
}

/** برای هر خط خرید (به همان ترتیب)، چند جوړه هنوز به تأمین‌کننده برگشتنی است */
export function purchaseReturnableQtys(purchase: Purchase, prior: ReturnDoc[]): number[] {
  const docLines = purchaseLines(purchase)
  const left = purchase.lines.map((l) => l.qty)
  for (const r of prior) for (const l of r.lines) take(docLines, left, l)
  return left
}

/**
 * بررسی مرجوعی به تأمین‌کننده از روی یک خرید: بیشتر از خریده (منهای برگشت‌های قبلی) برنمی‌گردد
 * و ارزشش به قیمت همان فاکتور است. خرید در راه هنوز در گدام نیست، پس از آن چیزی برنمی‌گردد.
 */
export function checkPurchaseReturn(purchase: Purchase, prior: ReturnDoc[], lines: ReturnLine[]): { value: number } | string {
  if (purchase.received === false) return 'این خرید هنوز نرسیده است؛ اول «رسید» را ثبت کنید، بعد مرجوعی'
  const docLines = purchaseLines(purchase)
  const left = purchaseReturnableQtys(purchase, prior)
  let value = 0
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) return 'تعداد برگشتی باید عدد صحیح و بیشتر از صفر باشد'
    const before = [...left]
    if (take(docLines, left, l) > 0) return `${l.productName} ${l.size}: بیشتر از آنچه از این خرید آمده (یا قبلاً برگشت خورده) پس داده نمی‌شود`
    value += docLines.reduce((s, d, i) => s + (before[i] - left[i]) * d.unitPrice, 0)
  }
  return { value }
}
