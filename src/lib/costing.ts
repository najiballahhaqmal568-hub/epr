/**
 * قیمت تمام‌شدهٔ هر سایز — از روی اسناد ساخته می‌شود، نه با دست‌کاری تدریجی.
 *
 * پیش از این، مصارف رسیدن قیمت را در دو جا با دو فورمولِ متفاوت عوض می‌کرد
 * (ops میانگین وزنی، sync جمع ساده) و «کنترل حساب‌ها» اصلاً قیمت را نمی‌سنجید.
 * پس اگر قیمت تمام‌شده بین دو موبایل فرق می‌کرد، هیچ‌کس خبردار نمی‌شد — و
 * مفادِ هر فروش از همین قیمت حساب می‌شود.
 *
 * قاعده‌ها (یک بار، همین‌جا):
 *  • قیمت فقط وقتی عوض می‌شود که جنس وارد گدام شود — خرید یا رسیدنِ خرید در راه.
 *    فروش، مرجوعی، تعدیل و شمارش، قیمت میانگین را دست نمی‌زنند.
 *  • قیمت واردشده = قیمت خرید + سهم مصارف رسیدن (مجموع نهایی، تقسیم بر جوړه‌ها).
 *    چون مجموعِ نهایی به کار می‌رود، هر موبایل به همان عدد می‌رسد.
 *  • میانگین وزنی با موجودی همان لحظه — پس ترتیب رویدادها مهم است و
 *    همه‌چیز به ترتیب تاریخ پخش می‌شود.
 */
import { db, type Adjustment, type Purchase, type ReturnDoc, type Sale } from '../db'

/** قیمت تمام‌شدهٔ هر جوړه = قیمت خرید + سهم مصارف رسیدن (تقسیم مساوی) */
export function landedUnitCost(purchase: Purchase, unitCost: number): number {
  const landing = purchase.landingCost ?? 0
  const totalPairs = purchase.lines.reduce((s, l) => s + l.qty, 0)
  if (landing <= 0 || totalPairs <= 0) return unitCost
  return unitCost + landing / totalPairs
}

/** میانگین وزنی — تا موجودی قدیم با قیمت نو تبدیل نشود */
export function weightedCost(oldQty: number, oldCost: number, addQty: number, addCost: number): number {
  const total = oldQty + addQty
  if (total <= 0 || oldQty <= 0) return addCost
  return (oldQty * oldCost + addQty * addCost) / total
}

type Event =
  | { date: number; seq: number; variantId: number; qty: number; unitCost: number }
  | { date: number; seq: number; variantId: number; qty: number; unitCost?: undefined }

/**
 * قیمت تمام‌شدهٔ مورد انتظار هر سایز، از روی اسناد.
 * `fallback` قیمت سایزهایی است که هیچ خریدی ندارند (قیمت دستی در فورم گدام).
 */
export function computeCosts(
  sales: Sale[],
  purchases: Purchase[],
  adjustments: Adjustment[],
  returns: ReturnDoc[],
  fallback: Map<number, number> = new Map()
): Map<number, number> {
  const ev: Event[] = []
  let seq = 0

  for (const p of purchases) {
    // خرید «در راه»ی که هنوز نرسیده، نه موجودی می‌دهد نه قیمت
    if (p.received === false) continue
    // خرید عادی در تاریخ خودش؛ خرید در راه در تاریخ رسیدنش
    const date = p.received === true ? (p.receivedAt ?? p.date) : p.date
    for (const l of p.lines) ev.push({ date, seq: seq++, variantId: l.variantId, qty: l.qty, unitCost: landedUnitCost(p, l.unitCost) })
  }
  for (const s of sales) for (const l of s.lines) ev.push({ date: s.date, seq: seq++, variantId: l.variantId, qty: -l.qty })
  for (const a of adjustments) {
    // موجودیِ رسیدِ خرید از خودِ سند خرید آمد — اینجا دوباره شمرده نمی‌شود
    if (a.reason === 'purchaseReceived') continue
    // سندی که قیمت با خود دارد (یکجا کردن دو جنس) مثل خرید در میانگین می‌نشیند
    if (a.unitCost !== undefined && a.qtyChange > 0)
      ev.push({ date: a.date, seq: seq++, variantId: a.variantId, qty: a.qtyChange, unitCost: a.unitCost })
    else ev.push({ date: a.date, seq: seq++, variantId: a.variantId, qty: a.qtyChange })
  }
  for (const r of returns) {
    if (r.kind === 'customer') {
      for (const l of r.lines) if (l.restock) ev.push({ date: r.date, seq: seq++, variantId: l.variantId, qty: l.qty })
    } else {
      for (const l of r.lines) ev.push({ date: r.date, seq: seq++, variantId: l.variantId, qty: -l.qty })
    }
  }

  ev.sort((a, b) => a.date - b.date || a.seq - b.seq)

  const qty = new Map<number, number>()
  const cost = new Map<number, number>()
  for (const e of ev) {
    const q = qty.get(e.variantId) ?? 0
    if (e.unitCost !== undefined) {
      cost.set(e.variantId, weightedCost(q, cost.get(e.variantId) ?? fallback.get(e.variantId) ?? 0, e.qty, e.unitCost))
    }
    qty.set(e.variantId, q + e.qty)
  }
  // سایزهایی که هیچ خرید نداشته‌اند، قیمتشان همان است که دستی گذاشته شده
  for (const [id, c] of fallback) if (!cost.has(id)) cost.set(id, c)
  return cost
}

/** همان حساب، مستقیم از دیتابیس */
export async function rebuildCosts(): Promise<Map<number, number>> {
  const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)
  const [sales, purchases, adjustments, returns, variants] = await Promise.all([
    db.sales.toArray().then(live),
    db.purchases.toArray().then(live),
    db.adjustments.toArray().then(live),
    db.returns.toArray().then(live),
    db.variants.toArray().then(live)
  ])
  // سایز بدون خرید، قیمتش دست‌نخورده می‌ماند
  const bought = new Set<number>()
  for (const p of purchases) if (p.received !== false) for (const l of p.lines) bought.add(l.variantId)
  const fallback = new Map(variants.filter((v) => !bought.has(v.id!)).map((v) => [v.id!, v.purchasePrice]))
  return computeCosts(sales, purchases, adjustments, returns, fallback)
}

/**
 * قیمت‌های ذخیره‌شده را برابر قیمتِ ساخته‌شده از اسناد می‌کند.
 * هر جا سندی قیمت را عوض می‌کند (خرید، رسید، مصارف رسیدن) این صدا زده می‌شود،
 * تا این موبایل و موبایل دوم هر دو به یک عدد برسند.
 */
export async function applyRebuiltCosts(): Promise<void> {
  const want = await rebuildCosts()
  const variants = await db.variants.filter((v) => !v.deleted).toArray()
  for (const v of variants) {
    const c = want.get(v.id!)
    if (c !== undefined && Math.abs(v.purchasePrice - c) > 0.005) await db.variants.update(v.id!, { purchasePrice: c })
  }
}
