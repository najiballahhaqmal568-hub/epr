/**
 * پول آینده: پولی که قرار است بیاید و پولی که باید داده شود.
 * بدون وابستگی به دیتابیس — تا همان عددی که در صفحه دیده می‌شود آزمایش شود.
 */
import type { Customer, Purchase, Supplier } from '../db'

export interface FlowItem {
  key: string
  name: string
  amount: number
  /** وعده/سررسید — اگر نامعلوم باشد undefined */
  due?: number
  /** وعده گذشته است */
  overdue: boolean
  kind: 'customer' | 'supplier' | 'lender' | 'landing'
}

export interface CashForecast {
  /** پول نقد امروز (همهٔ جاها) */
  cashNow: number
  /** طلب‌هایی که تا پایان دوره وعده دارند */
  incoming: FlowItem[]
  /** قرض‌هایی که باید داده شود */
  outgoing: FlowItem[]
  incomingTotal: number
  outgoingTotal: number
  /** تخمین پول در پایان دوره */
  projected: number
  /** طلب بدون وعده — در تخمین حساب نشده */
  noPromise: number
  /** طلب گذشته از وعده */
  overdueTotal: number
}

/**
 * وعده‌های مشتریان و قرض‌های ما تا `until`.
 * قرض تأمین‌کننده و قرض‌دهنده سررسید ثبت‌شده ندارد، پس همیشه در «باید داده شود» می‌آید —
 * چون واقعیت این است که هر لحظه ممکن است بخواهند.
 */
export function buildForecast(
  cashNow: number,
  customers: Customer[],
  suppliers: Supplier[],
  purchases: Purchase[],
  until: number,
  now = Date.now()
): CashForecast {
  const incoming: FlowItem[] = []
  let noPromise = 0
  let overdueTotal = 0

  for (const c of customers) {
    if (c.balance <= 0) continue
    const overdue = Boolean(c.promiseDate && c.promiseDate < now)
    if (overdue) overdueTotal += c.balance
    if (!c.promiseDate) {
      noPromise += c.balance
      continue
    }
    // وعدهٔ گذشته هم می‌آید — چون هنوز طلب ماست و باید تقاضا شود
    if (c.promiseDate <= until) {
      incoming.push({ key: `c${c.id}`, name: c.name, amount: c.balance, due: c.promiseDate, overdue, kind: 'customer' })
    }
  }

  const outgoing: FlowItem[] = []
  for (const s of suppliers) {
    if (s.kind === 'partner' || s.balance <= 0) continue
    outgoing.push({
      key: `s${s.id}`,
      name: s.name,
      amount: s.balance,
      overdue: false,
      kind: s.kind === 'lender' ? 'lender' : 'supplier'
    })
  }
  for (const p of purchases) {
    const due = p.landingUnpaid ?? (p.landingPaid === false ? (p.landingCost ?? 0) : 0)
    if (due > 0) {
      outgoing.push({ key: `p${p.id}`, name: `مصارف رسیدن — ${p.supplierName}`, amount: due, overdue: false, kind: 'landing' })
    }
  }

  incoming.sort((a, b) => (a.due ?? 0) - (b.due ?? 0))
  outgoing.sort((a, b) => b.amount - a.amount)

  const incomingTotal = incoming.reduce((s, x) => s + x.amount, 0)
  const outgoingTotal = outgoing.reduce((s, x) => s + x.amount, 0)

  return {
    cashNow,
    incoming,
    outgoing,
    incomingTotal,
    outgoingTotal,
    projected: cashNow + incomingTotal - outgoingTotal,
    noPromise,
    overdueTotal
  }
}
