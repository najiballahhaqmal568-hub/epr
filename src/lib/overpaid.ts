import { saleCashPaid, type Sale } from '../db'

export interface OverpaidSale { id?: number; date: number; customerName?: string; total: number; paid: number; extra: number }

/**
 * Sales saved before the change fix, where the whole note handed over was stored as cash
 * (1,000 for a 900 sale). The extra never stayed in the till, so the till read that much higher.
 * Read-only: a later cash count may already have corrected it, so nothing is changed automatically.
 */
export function overpaidSales(sales: Sale[]): OverpaidSale[] {
  return sales
    .filter((s) => !s.deleted && !s.directTrade && saleCashPaid(s) > s.total)
    .map((s) => ({ id: s.id, date: s.date, customerName: s.customerName, total: s.total, paid: saleCashPaid(s), extra: saleCashPaid(s) - s.total }))
    .sort((a, b) => b.date - a.date)
}
