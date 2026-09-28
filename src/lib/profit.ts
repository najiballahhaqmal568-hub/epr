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
import { fmtNum } from './format'

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
    .reduce((s, r) => s + r.lines.reduce((a, l) => a + (l.unitPrice - (l.unitCost ?? 0)) * l.qty, 0), 0)
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
