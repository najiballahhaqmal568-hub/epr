/**
 * راپور به تفکیک پرچون و عمده — بدون هیچ قاعدهٔ تازهٔ مفاد.
 *
 * هر عدد از همان profitSummary می‌آید که کارت خانه و راپور می‌خوانند؛ اینجا فقط فروش‌ها و
 * مرجوعی‌ها پیش از آن جدا می‌شوند. بنابراین «پرچون + عمده = همه» همیشه برقرار است، مگر
 * مرجوعی‌ای که نوعش معلوم نیست — آن حدس زده نمی‌شود؛ فقط در «همه» حساب می‌شود و گفته می‌شود.
 *
 * مصارف دکان مال هر دو است. تقسیمش بین پرچون و عمده حدس است، پس برای یک نوع جدا
 * «مفاد خالص» ساخته نمی‌شود — فقط «مفاد از جنس».
 */
import type { ReturnDoc, Sale } from '../db'
import { commercialSaleLines } from './commercialLines'
import { confirmedSales, profitSummary, type ProfitInput, type ProfitSummary } from './profit'
import { returnProfit } from './returns'

export type SaleKind = 'all' | 'retail' | 'wholesale'
export const KIND_NAME: Record<SaleKind, string> = { all: 'همه', retail: 'پرچون', wholesale: 'عمده' }

/** نوع یک مرجوعی: از خودش، وگرنه از فروش اصلی؛ اگر هیچ‌کدام نیست، نامعلوم (حدس زده نمی‌شود). */
export function returnKind(r: ReturnDoc, salesById: ReadonlyMap<number, Sale>): 'retail' | 'wholesale' | undefined {
  if (r.saleType) return r.saleType
  const sale = r.refId === undefined ? undefined : salesById.get(r.refId)
  return sale?.saleType
}

export interface KindFigures {
  summary: ProfitSummary
  /** جوړه‌های فروخته، بدون کم کردن مرجوعی — همان عددی که کارت فروش نشان می‌دهد */
  pairs: number
  /** مفادی که برای این نوع حساب می‌شود: «همه» = مفاد خالص؛ یک نوع = مفاد از جنس (پیش از مصارف) */
  profit: number
  /** مرجوعی‌های بی‌نوع — فقط در «همه» شمرده شده‌اند */
  unknownReturns: { count: number; profit: number }
}

export interface KindInput extends ProfitInput {
  /** همهٔ فروش‌ها (نه فقط این دوره) تا نوع مرجوعیِ فروش‌های قدیمی هم پیدا شود */
  salesForLookup: Sale[]
}

export function kindFigures(input: KindInput, kind: SaleKind): KindFigures {
  const salesById = new Map<number, Sale>()
  for (const s of input.salesForLookup) if (s.id !== undefined) salesById.set(s.id, s)
  for (const s of input.sales) if (s.id !== undefined) salesById.set(s.id, s)
  const customerReturns = input.returns.filter((r) => !r.deleted && r.kind === 'customer')
  const unknown = customerReturns.filter((r) => returnKind(r, salesById) === undefined)
  const sales = kind === 'all' ? input.sales : input.sales.filter((s) => s.saleType === kind)
  const returns = kind === 'all' ? input.returns : customerReturns.filter((r) => returnKind(r, salesById) === kind)
  const summary = profitSummary({ ...input, sales, returns, expenses: kind === 'all' ? input.expenses : [] })
  const pairs = confirmedSales(sales, input.readyTradeUuids, input.readyReceiptUuids)
    .reduce((n, s) => n + commercialSaleLines(s).reduce((m, l) => m + l.qty, 0), 0)
  return {
    summary,
    pairs,
    profit: kind === 'all' ? summary.netProfit : summary.grossProfit,
    unknownReturns: { count: unknown.length, profit: unknown.reduce((s, r) => s + returnProfit(r), 0) }
  }
}

export type StepKind = 'base' | 'cut' | 'sub' | 'result'
export interface WaterfallStep { key: string; label: string; amount: number; kind: StepKind; from: number; to: number }

/**
 * پله‌های «این مفاد از کجا آمد». هر پله از جایی شروع می‌شود که پلهٔ قبلی تمام شد؛
 * پلهٔ آخر دقیقاً همان مفادی است که بالای صفحه نوشته شده.
 */
export function waterfall(f: KindFigures, kind: SaleKind): WaterfallStep[] {
  const s = f.summary
  const afterDiscount = s.goodsValue - s.discounts
  const steps: WaterfallStep[] = [
    { key: 'goods', label: 'قیمت فروش اجناس', amount: s.goodsValue, kind: 'base', from: 0, to: s.goodsValue },
    { key: 'discount', label: 'تخفیف به مشتری', amount: s.discounts, kind: 'cut', from: s.goodsValue, to: afterDiscount },
    { key: 'sales', label: 'بعد از تخفیف', amount: afterDiscount, kind: 'sub', from: 0, to: afterDiscount },
    { key: 'cost', label: 'قیمت خرید همین اجناس', amount: s.goodsCost, kind: 'cut', from: afterDiscount, to: s.salesProfit },
    { key: 'salesProfit', label: 'مفاد فروش', amount: s.salesProfit, kind: 'sub', from: 0, to: s.salesProfit },
    { key: 'returns', label: 'جنس‌های پس‌آمده', amount: s.returnedProfit, kind: 'cut', from: s.salesProfit, to: s.grossProfit }
  ]
  if (kind === 'all') {
    steps.push({ key: 'expenses', label: 'مصارف دکان', amount: s.businessExpenses, kind: 'cut', from: s.grossProfit, to: s.netProfit })
    steps.push({ key: 'net', label: 'مفاد خالص', amount: s.netProfit, kind: 'result', from: 0, to: s.netProfit })
  } else {
    steps.push({ key: 'gross', label: 'مفاد از جنس · ' + KIND_NAME[kind], amount: s.grossProfit, kind: 'result', from: 0, to: s.grossProfit })
  }
  return steps
}

/** از هر ۱۰۰ افغانی فروش چند افغانی ماند (گرد). بدون فروش: undefined، نه صفر ساختگی. */
export function per100(profit: number, sales: number): number | undefined {
  return sales > 0 ? Math.round((profit / sales) * 100) : undefined
}

export interface ChartBucket { label: string; name: string; retail: number; wholesale: number }

/**
 * فروش در ستون‌ها: امروز = هر ساعت، تا ۴۵ روز = هر روز، بیشتر = هر ماه شمسی.
 * مبلغ هر ستون همان مجموع فروش‌هاست (sale.total)، جدا برای پرچون و عمده.
 */
export function salesBuckets(sales: Sale[], from: number, to: number, fmtDay: (t: number) => string, fmtMonth: (t: number) => string, startOfDay: (t: number) => number): ChartBucket[] {
  const end = Math.max(from + 1, to)
  const span = end - from
  const add = (b: ChartBucket, s: Sale) => { if (s.saleType === 'wholesale') b.wholesale += s.total; else b.retail += s.total }
  if (span <= 26 * 3600000) {
    const hours = new Map<number, ChartBucket>()
    for (const s of sales) {
      const h = new Date(s.date).getHours()
      const b = hours.get(h) ?? { label: String(h), name: 'ساعت ' + h, retail: 0, wholesale: 0 }
      add(b, s)
      hours.set(h, b)
    }
    const keys = [...hours.keys()]
    if (!keys.length) return []
    const out: ChartBucket[] = []
    for (let h = Math.min(...keys); h <= Math.max(...keys); h++) out.push(hours.get(h) ?? { label: String(h), name: 'ساعت ' + h, retail: 0, wholesale: 0 })
    return out
  }
  if (span <= 45 * 86400000) {
    const out: ChartBucket[] = []
    const index = new Map<number, ChartBucket>()
    for (let d = startOfDay(from); d < end; d += 86400000) {
      const day = startOfDay(d)
      if (index.has(day)) continue
      const b = { label: fmtDay(day), name: fmtDay(day), retail: 0, wholesale: 0 }
      index.set(day, b)
      out.push(b)
    }
    for (const s of sales) { const b = index.get(startOfDay(s.date)); if (b) add(b, s) }
    return out
  }
  const out: ChartBucket[] = []
  const byMonth = new Map<string, ChartBucket>()
  for (const s of [...sales].sort((a, b) => a.date - b.date)) {
    const name = fmtMonth(s.date)
    let b = byMonth.get(name)
    if (!b) { b = { label: name, name, retail: 0, wholesale: 0 }; byMonth.set(name, b); out.push(b) }
    add(b, s)
  }
  return out
}
