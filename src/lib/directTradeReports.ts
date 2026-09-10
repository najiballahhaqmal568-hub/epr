import type { Payment } from '../db'
import type { DirectTradeState } from './directTradeState'

export interface DirectReceiptModel {
  date: number
  customerName: string
  lines: ReadonlyArray<{ productName: string; size: string; color: string; qty: number; unitPrice: number }>
  total: number
  settled: number
  remaining: number
}

export function directReceiptModel(state: DirectTradeState): DirectReceiptModel {
  if (state.status !== 'ready' || !state.sale?.directLines) throw new Error('رسید فقط برای معاملهٔ مستقیم کامل و بدون تعارض ساخته می‌شود.')
  return {
    date: state.sale.date,
    customerName: state.sale.customerName ?? '',
    lines: state.sale.directLines.map(({ productName, size, color, qty, unitPrice }) => ({ productName, size, color, qty, unitPrice })),
    total: state.totals.sale,
    settled: state.totals.sale - state.balances.customerRemaining,
    remaining: state.balances.customerRemaining
  }
}

export interface DirectPeriodSummary {
  sales: number; purchases: number; profit: number; pairs: number
  customerCash: number; customerDirect: number; supplierCash: number; incomplete: number
}

/** Ordinary debt receipts only; direct routes are reported separately and D never enters cash. */
export function ordinaryCustomerCollections(payments: Payment[]): number {
  return payments.filter(payment => payment.partyType === 'customer' && !payment.directPayment).reduce((sum, payment) => sum + payment.amount, 0)
}

export function directPeriodSummary(states: DirectTradeState[], from: number, to: number): DirectPeriodSummary {
  const out: DirectPeriodSummary = { sales: 0, purchases: 0, profit: 0, pairs: 0, customerCash: 0, customerDirect: 0, supplierCash: 0, incomplete: 0 }
  const within = (date: number) => date >= from && date <= to
  for (const state of states) {
    const baseDate = state.sale?.date ?? state.purchase?.date
    if ((state.status === 'incomplete' || state.status === 'conflict') && baseDate !== undefined && within(baseDate)) out.incomplete++
    if (state.status === 'ready' && state.sale && within(state.sale.date)) {
      out.sales += state.totals.sale; out.purchases += state.totals.cost; out.profit += state.totals.profit; out.pairs += state.totals.pairs
    }
    for (const payment of state.payments) {
      if (!within(payment.date)) continue
      if (payment.directPayment?.route === 'customerCash') out.customerCash += payment.amount
      else if (payment.directPayment?.route === 'customerToSupplier') out.customerDirect += payment.amount
      else if (payment.directPayment?.route === 'supplierPayment') out.supplierCash += payment.cashDelta === undefined ? 0 : Math.max(0, -payment.cashDelta)
    }
  }
  return out
}
