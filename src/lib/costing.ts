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
import { db, type Adjustment, type Purchase, type ReturnDoc, type Sale, type SaleLine } from '../db'

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
  | { date: number; seq: number; variantId: number; qty: number; unitCost: number; setCost?: boolean }
  | { date: number; seq: number; variantId: number; qty: number; unitCost?: undefined; setCost?: undefined }

type RevisionEvent =
  | { date: number; seq: number; kind: 'in'; variantId: number; qty: number; unitCostDelta: number }
  | { date: number; seq: number; kind: 'sale'; variantId: number; qty: number; sale: Sale; lineIndex: number }
  | { date: number; seq: number; kind: 'qty'; variantId: number; qty: number }
  | { date: number; seq: number; kind: 'reset'; variantId: number }

export interface HistoricalCostRevision {
  sales: Map<number, SaleLine[]>
  returns: Map<number, ReturnDoc['lines']>
  affectedSales: number
  affectedPairs: number
  profitChange: number
}

/**
 * اثرِ تفاوت قیمت یک خرید را روی قیمت‌های ثبت‌شده در فروش‌های بعدی پخش می‌کند.
 *
 * این تابع قیمت مطلق تاریخچه را از نو حدس نمی‌زند؛ فقط «تفاوت» قیمت را از لحظهٔ
 * ورود خرید در میانگین وزنی دنبال می‌کند. به همین دلیل موجودی اولیهٔ بکاپ‌های
 * قدیمی—even اگر سند قیمت نداشته باشد—دست‌نخورده می‌ماند. فروش تعداد را کم
 * می‌کند، خرید بعدی تفاوت را رقیق می‌کند و اصلاح دستی قیمت، زنجیرهٔ تفاوت را
 * از همان لحظه صفر می‌سازد.
 */
export function historicalCostRevision(
  purchaseId: number,
  nextUnitCosts: number[],
  sales: Sale[],
  purchases: Purchase[],
  adjustments: Adjustment[],
  returns: ReturnDoc[]
): HistoricalCostRevision {
  const target = purchases.find((purchase) => purchase.id === purchaseId)
  const changedSales = new Map<number, SaleLine[]>()
  const changedReturns = new Map<number, ReturnDoc['lines']>()
  if (!target || target.received === false || target.lines.length !== nextUnitCosts.length) {
    return { sales: changedSales, returns: changedReturns, affectedSales: 0, affectedPairs: 0, profitChange: 0 }
  }

  const changedVariants = new Set<number>()
  target.lines.forEach((line, index) => {
    if (Math.abs(nextUnitCosts[index] - line.unitCost) > 0.005) changedVariants.add(line.variantId)
  })
  if (!changedVariants.size) {
    return { sales: changedSales, returns: changedReturns, affectedSales: 0, affectedPairs: 0, profitChange: 0 }
  }

  const events: RevisionEvent[] = []
  let seq = 0
  for (const purchase of purchases) {
    if (purchase.received === false) continue
    const date = purchase.received === true ? (purchase.receivedAt ?? purchase.date) : purchase.date
    purchase.lines.forEach((line, lineIndex) => {
      if (!changedVariants.has(line.variantId)) return
      const unitCostDelta = purchase.id === purchaseId ? nextUnitCosts[lineIndex] - line.unitCost : 0
      events.push({ date, seq: seq++, kind: 'in', variantId: line.variantId, qty: line.qty, unitCostDelta })
    })
  }
  for (const sale of sales) {
    sale.lines.forEach((line, lineIndex) => {
      if (!changedVariants.has(line.variantId)) return
      events.push({ date: sale.date, seq: seq++, kind: 'sale', variantId: line.variantId, qty: line.qty, sale, lineIndex })
    })
  }
  for (const adjustment of adjustments) {
    if (adjustment.reason === 'purchaseReceived' || !changedVariants.has(adjustment.variantId)) continue
    if (adjustment.unitCost !== undefined && adjustment.qtyChange > 0) {
      events.push({ date: adjustment.date, seq: seq++, kind: 'in', variantId: adjustment.variantId, qty: adjustment.qtyChange, unitCostDelta: 0 })
    } else if (adjustment.unitCost !== undefined && adjustment.qtyChange === 0) {
      events.push({ date: adjustment.date, seq: seq++, kind: 'reset', variantId: adjustment.variantId })
    } else {
      events.push({ date: adjustment.date, seq: seq++, kind: 'qty', variantId: adjustment.variantId, qty: adjustment.qtyChange })
    }
  }
  for (const ret of returns) {
    for (const line of ret.lines) {
      if (!changedVariants.has(line.variantId)) continue
      const qty = ret.kind === 'customer' ? (line.restock ? line.qty : 0) : -line.qty
      if (qty !== 0) events.push({ date: ret.date, seq: seq++, kind: 'qty', variantId: line.variantId, qty })
    }
  }
  events.sort((a, b) => a.date - b.date || a.seq - b.seq)

  const qty = new Map<number, number>()
  const delta = new Map<number, number>()
  let affectedPairs = 0
  let profitChange = 0
  for (const event of events) {
    const oldQty = qty.get(event.variantId) ?? 0
    if (event.kind === 'in') {
      const totalQty = oldQty + event.qty
      const oldDelta = delta.get(event.variantId) ?? 0
      delta.set(
        event.variantId,
        totalQty <= 0 || oldQty <= 0 ? event.unitCostDelta : (oldQty * oldDelta + event.qty * event.unitCostDelta) / totalQty
      )
      qty.set(event.variantId, totalQty)
    } else if (event.kind === 'reset') {
      delta.set(event.variantId, 0)
    } else if (event.kind === 'qty') {
      qty.set(event.variantId, oldQty + event.qty)
    } else {
      const costDelta = delta.get(event.variantId) ?? 0
      if (Math.abs(costDelta) > 0.005 && event.sale.id !== undefined) {
        const lines = changedSales.get(event.sale.id) ?? event.sale.lines.map((line) => ({ ...line }))
        const line = lines[event.lineIndex]
        const oldCost = line.unitCost ?? 0
        line.unitCost = oldCost + costDelta
        changedSales.set(event.sale.id, lines)
        affectedPairs += event.qty
        profitChange -= costDelta * event.qty
      }
      qty.set(event.variantId, oldQty - event.qty)
    }
  }

  // مرجوعی مشتری قیمت خرید همان فروش اصلی را برمی‌گرداند. اگر آن فروش اصلاح
  // شد، سند مرجوعی وابسته نیز باید همان قیمت را بگیرد تا مفاد دوبار تغییر نکند.
  const saleById = new Map(sales.filter((sale) => sale.id !== undefined).map((sale) => [sale.id!, sale]))
  for (const ret of returns) {
    if (ret.kind !== 'customer' || ret.id === undefined || ret.refId === undefined) continue
    const revisedSale = changedSales.get(ret.refId)
    const originalSale = saleById.get(ret.refId)
    if (!revisedSale || !originalSale) continue
    const lines = ret.lines.map((line) => ({ ...line }))
    let changed = false
    for (const line of lines) {
      const saleLineIndex = originalSale.lines.findIndex((candidate) => candidate.variantId === line.variantId)
      const revisedCost = saleLineIndex >= 0 ? revisedSale[saleLineIndex]?.unitCost : undefined
      if (revisedCost !== undefined && Math.abs((line.unitCost ?? 0) - revisedCost) > 0.005) {
        const oldCost = line.unitCost ?? 0
        line.unitCost = revisedCost
        profitChange += (revisedCost - oldCost) * line.qty
        changed = true
      }
    }
    if (changed) changedReturns.set(ret.id, lines)
  }

  return { sales: changedSales, returns: changedReturns, affectedSales: changedSales.size, affectedPairs, profitChange }
}

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
    // سندِ «اصلاح قیمت خرید» — تعداد را عوض نمی‌کند، فقط قیمت را از همان لحظه می‌گذارد
    else if (a.unitCost !== undefined && a.qtyChange === 0)
      ev.push({ date: a.date, seq: seq++, variantId: a.variantId, qty: 0, unitCost: a.unitCost, setCost: true })
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
      // اصلاح دستی، قیمت را مستقیم می‌گذارد؛ ورود جنس، میانگین وزنی می‌سازد
      cost.set(
        e.variantId,
        e.setCost ? e.unitCost : weightedCost(q, cost.get(e.variantId) ?? fallback.get(e.variantId) ?? 0, e.qty, e.unitCost)
      )
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
