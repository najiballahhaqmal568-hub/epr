/**
 * منطق آمار و نمودارها — بدون وابستگی به دیتابیس یا صفحه،
 * تا بشود دقیقاً همان عددی را آزمایش کرد که در نمودار دیده می‌شود.
 */
import type { ReturnDoc, Sale, SaleLine } from '../db'

export interface Totals {
  sales: number
  profit: number
  pairs: number
  count: number
  /** فیصدی مفاد: از هر ۱۰۰ افغانی فروش، چند افغانی مفاد */
  margin: number
}

const emptyTotals = (): Totals => ({ sales: 0, profit: 0, pairs: 0, count: 0, margin: 0 })

const withMargin = (t: Totals): Totals => ({ ...t, margin: t.sales > 0 ? (t.profit / t.sales) * 100 : 0 })

/** مفاد یک خط فروش — با قیمت خریدِ ثبت‌شده در همان فاکتور */
const lineProfit = (l: SaleLine) => (l.unitPrice - (l.unitCost ?? 0)) * l.qty

/** مفاد یک فاکتور: مجموع خطوط منهای تخفیف */
export function saleProfit(s: Sale): number {
  return s.lines.reduce((a, l) => a + lineProfit(l), 0) - (s.discount ?? 0)
}

/** مفادی که با مرجوعی مشتری پس گرفته می‌شود */
export function returnProfit(r: ReturnDoc): number {
  return r.lines.reduce((a, l) => a + (l.unitPrice - (l.unitCost ?? 0)) * l.qty, 0)
}

/**
 * مقایسهٔ عمده و پرچون — سؤال «فایدهٔ عمده چقدر بود و پرچون چقدر».
 * مرجوعی‌ها از همان نوع فروشِ اصلی کم می‌شوند.
 */
export function retailVsWholesale(sales: Sale[], returns: ReturnDoc[] = []): { retail: Totals; wholesale: Totals } {
  const out = { retail: emptyTotals(), wholesale: emptyTotals() }
  for (const s of sales) {
    const t = out[s.saleType === 'wholesale' ? 'wholesale' : 'retail']
    t.sales += s.total
    t.profit += saleProfit(s)
    t.pairs += s.lines.reduce((a, l) => a + l.qty, 0)
    t.count += 1
  }
  // مرجوعی از همان نوع فروشِ اصلی کم می‌شود (سندهای کهنه بدون نوع = پرچون)
  for (const r of returns) {
    if (r.kind !== 'customer') continue
    const t = out[r.saleType === 'wholesale' ? 'wholesale' : 'retail']
    t.sales -= r.amount
    t.profit -= returnProfit(r)
    t.pairs -= r.lines.reduce((a, l) => a + l.qty, 0)
  }
  return { retail: withMargin(out.retail), wholesale: withMargin(out.wholesale) }
}

export interface ModelRow extends Totals {
  name: string
}

/** آمار هر مدل: جوړه، فروش، مفاد و فیصدی مفاد. تخفیف فاکتور به نسبت خط پخش می‌شود. */
export function byModel(sales: Sale[]): ModelRow[] {
  const map = new Map<string, Totals>()
  for (const s of sales) {
    const disc = s.discount ?? 0
    const sub = s.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)
    for (const l of s.lines) {
      const t = map.get(l.productName) ?? emptyTotals()
      const lineTotal = l.qty * l.unitPrice
      const lineDisc = sub > 0 ? (lineTotal / sub) * disc : 0
      t.sales += lineTotal - lineDisc
      t.profit += lineProfit(l) - lineDisc
      t.pairs += l.qty
      t.count += 1
      map.set(l.productName, t)
    }
  }
  return [...map.entries()].map(([name, t]) => ({ name, ...withMargin(t) }))
}

export interface CustomerRow extends Totals {
  name: string
  kind: 'retail' | 'wholesale'
}

/** آمار هر مشتری: چقدر خرید کرد و چقدر مفاد داد */
export function byCustomer(sales: Sale[]): CustomerRow[] {
  const map = new Map<string, CustomerRow>()
  for (const s of sales) {
    if (!s.customerName) continue
    const cur =
      map.get(s.customerName) ?? { name: s.customerName, kind: s.saleType === 'wholesale' ? 'wholesale' : 'retail', ...emptyTotals() }
    cur.sales += s.total
    cur.profit += saleProfit(s)
    cur.pairs += s.lines.reduce((a, l) => a + l.qty, 0)
    cur.count += 1
    if (s.saleType === 'wholesale') cur.kind = 'wholesale'
    map.set(s.customerName, cur)
  }
  return [...map.values()].map((c) => ({ ...c, ...withMargin(c) }))
}

export interface MonthRow extends Totals {
  key: string
  label: string
}

/** فروش و مفاد ماه‌به‌ماه */
export function byMonth(sales: Sale[], monthOf: (ts: number) => { key: string; label: string }): MonthRow[] {
  const map = new Map<string, MonthRow>()
  for (const s of sales) {
    const { key, label } = monthOf(s.date)
    const cur = map.get(key) ?? { key, label, ...emptyTotals() }
    cur.sales += s.total
    cur.profit += saleProfit(s)
    cur.pairs += s.lines.reduce((a, l) => a + l.qty, 0)
    cur.count += 1
    map.set(key, cur)
  }
  return [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).map((m) => ({ ...m, ...withMargin(m) }))
}

/** تغییر نسبت به دورهٔ گذشته — فیصدی */
export function changePct(now: number, before: number): number | null {
  if (before === 0) return now === 0 ? 0 : null
  return ((now - before) / Math.abs(before)) * 100
}
