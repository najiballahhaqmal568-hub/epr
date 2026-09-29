/**
 * مفاد و مصرف یک دوره — یک جا، برای راپورها و کارت خانه.
 * پیش از این فقط داخل صفحهٔ راپورها حساب می‌شد؛ حالا هر دو از همین تابع می‌خوانند
 * تا عدد خانه و راپور هرگز از هم فرق نکند.
 *
 *  مفاد فروش  = (قیمت فروش − قیمت خرید ثبت‌شده در فاکتور) × تعداد − تخفیف
 *  مفاد ناخالص = مفاد فروش − مفاد جنس برگشتی مشتری
 *  مفاد خالص   = مفاد ناخالص − مصارف تجارت (نه مصرف خانه/شخصی، نه روز بسته)
 * فروش مستقیم و فروش جنس دریافت‌شده فقط وقتی حساب می‌شوند که کامل و بدون تعارض باشند.
 */
import type { Expense, ReturnDoc, Sale, Variant } from '../db'
import { commercialSaleLines } from './commercialLines'
import { returnProfit } from './returns'
import { addCalendarDays, fmtNum, startOfDay, startOfMonth } from './format'

export interface ProfitInput {
  sales: Sale[]
  returns: ReturnDoc[]
  expenses: Expense[]
  variants: Variant[]
  readyTradeUuids: ReadonlySet<string>
  readyReceiptUuids: ReadonlySet<string>
}

export interface ProfitSummary {
  salesTotal: number
  goodsValue: number
  goodsCost: number
  discounts: number
  salesProfit: number
  returnedProfit: number
  grossProfit: number
  businessExpenses: number
  netProfit: number
  /** مصارف تجارت به تفکیک کتگوری، از بزرگ به کوچک */
  expenseCategories: { name: string; amount: number }[]
}

export function confirmedSales(sales: Sale[], readyTradeUuids: ReadonlySet<string>, readyReceiptUuids: ReadonlySet<string>): Sale[] {
  return sales.filter(s => !s.deleted &&
    (!s.directTrade || readyTradeUuids.has(s.directTrade.uuid)) &&
    (!s.goodsReceiptChild || readyReceiptUuids.has(s.goodsReceiptChild.receiptUuid)))
}

export function profitSummary(input: ProfitInput): ProfitSummary {
  const variantCost = new Map(input.variants.map(v => [v.id!, v.purchasePrice]))
  // قیمت خرید ثبت‌شده در خود فاکتور — مفاد گذشته با تغییر قیمت عوض نمی‌شود
  const costOf = (l: { variantId?: number; unitCost?: number }) => l.unitCost ?? (l.variantId === undefined ? 0 : variantCost.get(l.variantId)) ?? 0
  const sales = confirmedSales(input.sales, input.readyTradeUuids, input.readyReceiptUuids)
  let goodsValue = 0, goodsCost = 0, discounts = 0, salesTotal = 0
  for (const sale of sales) {
    salesTotal += sale.total
    discounts += sale.discount ?? 0
    for (const line of commercialSaleLines(sale)) {
      goodsValue += line.unitPrice * line.qty
      goodsCost += costOf(line) * line.qty
    }
  }
  const salesProfit = goodsValue - goodsCost - discounts
  const returnedProfit = input.returns.filter(r => !r.deleted && r.kind === 'customer')
    .reduce((s, r) => s + returnProfit(r), 0)
  const grossProfit = salesProfit - returnedProfit
  const business = input.expenses.filter(e => !e.deleted && !e.shopClosed && e.type === 'business')
  const businessExpenses = business.reduce((s, e) => s + e.amount, 0)
  const categories = new Map<string, number>()
  for (const e of business) categories.set(e.categoryName, (categories.get(e.categoryName) ?? 0) + e.amount)
  return {
    salesTotal, goodsValue, goodsCost, discounts, salesProfit, returnedProfit, grossProfit, businessExpenses,
    netProfit: grossProfit - businessExpenses,
    expenseCategories: [...categories.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount)
  }
}

export interface ExpenseAlert { level: 'danger' | 'warning'; text: string }

/** Smallest increase worth interrupting the owner for, so a few afghani do not raise alarms. */
export const EXPENSE_ALERT_MIN_INCREASE = 1000

/**
 * هشدار مصرف برای «کارهای امروز»:
 *  • مصرف از مفاد فروش بیشتر شده (مفاد خالص منفی) — سرخ
 *  • مصرف تا همین روز ماه بیش از ۳۰٪ (و دست‌کم ۱٬۰۰۰ ؋) از همین وقت ماه گذشته بیشتر — زرد
 */
export function expenseAlert(current: ProfitSummary, previous: ProfitSummary, fmt: (n: number) => string): ExpenseAlert | null {
  const top = current.expenseCategories[0]
  const topText = top ? ` — بیشترین: ${top.name} (${fmt(top.amount)})` : ''
  if (current.businessExpenses > 0 && current.netProfit < 0) {
    return { level: 'danger', text: `مصرف این ماه (${fmt(current.businessExpenses)}) از مفاد فروش (${fmt(current.grossProfit)}) بیشتر شده است${topText}` }
  }
  const increase = current.businessExpenses - previous.businessExpenses
  if (previous.businessExpenses > 0 && increase >= EXPENSE_ALERT_MIN_INCREASE && current.businessExpenses > previous.businessExpenses * 1.3) {
    const pct = Math.round((increase / previous.businessExpenses) * 100)
    return { level: 'warning', text: `مصرف این ماه ${fmtNum(pct)}٪ بیشتر از همین وقت ماه گذشته است${topText}` }
  }
  return null
}

/** زیان هر جوړه وقتی قیمت فروش از قیمت خرید کمتر است؛ ۰ یعنی زیان ندارد. */
export function lossPerPair(unitPrice: number, unitCost: number): number {
  return Math.max(0, unitCost - unitPrice)
}

export interface ProductProfit { name: string; qty: number; revenue: number; profit: number; /** درصد مفاد از قیمت فروش */ margin: number }

/**
 * مفاد هر جنس در دوره — از همان فروش‌های تأییدشده و همان قیمت خریدِ فاکتور که
 * profitSummary می‌خواند. تخفیف فاکتور به نسبت قیمت میان خطوط تقسیم می‌شود تا
 * جمع مفاد اجناس دقیقاً برابر «مفاد فروش» شود.
 */
export function productProfits(input: Omit<ProfitInput, 'returns' | 'expenses'>): ProductProfit[] {
  const variantCost = new Map(input.variants.map(v => [v.id!, v.purchasePrice]))
  const costOf = (l: { variantId?: number; unitCost?: number }) => l.unitCost ?? (l.variantId === undefined ? 0 : variantCost.get(l.variantId)) ?? 0
  const rows = new Map<string, { qty: number; revenue: number; profit: number }>()
  for (const sale of confirmedSales(input.sales, input.readyTradeUuids, input.readyReceiptUuids)) {
    const lines = commercialSaleLines(sale)
    const gross = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0)
    const discount = sale.discount ?? 0
    let discountLeft = discount
    lines.forEach((line, index) => {
      const value = line.unitPrice * line.qty
      // سهم تخفیف این خط؛ خط آخر باقی‌مانده را می‌گیرد تا جمع دقیق بماند
      const share = index === lines.length - 1 ? discountLeft : gross > 0 ? Math.round((discount * value) / gross) : 0
      discountLeft -= share
      const row = rows.get(line.productName) ?? { qty: 0, revenue: 0, profit: 0 }
      row.qty += line.qty
      row.revenue += value - share
      row.profit += value - costOf(line) * line.qty - share
      rows.set(line.productName, row)
    })
  }
  return [...rows.entries()].map(([name, r]) => ({ name, ...r, margin: r.revenue > 0 ? Math.round((r.profit / r.revenue) * 100) : 0 }))
    .sort((a, b) => b.profit - a.profit || a.name.localeCompare(b.name, 'fa'))
}

/** چند روز تقویمی (با امروز) تا پایان این ماه هجری شمسی. */
export function daysLeftInMonth(now = Date.now()): number {
  // ماه شمسی حداکثر ۳۱ روز است؛ ۳۲ روز بعد از اول ماه همیشه در ماه بعدی است
  const next = startOfMonth(addCalendarDays(startOfMonth(now), 32))
  return Math.round((next - startOfDay(now)) / 86_400_000)
}
