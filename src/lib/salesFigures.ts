import { saleCashPaid, saleCreditAmount, type Sale } from '../db'
import { commercialSaleLines } from './commercialLines'

/**
 * The three numbers every sales screen shows next to a sale — cash, credit, pairs — defined once.
 * Home, «بستن روز», today's list, the sales stats and the reports all read these, so two screens can
 * never show two answers for the same sale.
 *
 * Direct trades are a separate account (their money is in the trade document), so they add no cash
 * and no customer credit here. A shoe settlement to a lender or expense creditor is a sale with
 * profit, but nobody owes the shop for it, so its credit is 0 too.
 */
export function saleCashReceived(sale: Sale): number {
  return sale.directTrade ? 0 : saleCashPaid(sale)
}

export function saleCustomerCredit(sale: Sale): number {
  return sale.directTrade ? 0 : saleCreditAmount(sale)
}

export function salePairs(sale: Sale): number {
  return commercialSaleLines(sale).reduce((sum, line) => sum + line.qty, 0)
}

export interface SalesFigures { count: number; total: number; cash: number; credit: number; pairs: number; directTotal: number }

export function summarizeSales(sales: readonly Sale[]): SalesFigures {
  const figures: SalesFigures = { count: sales.length, total: 0, cash: 0, credit: 0, pairs: 0, directTotal: 0 }
  for (const sale of sales) {
    figures.total += sale.total
    figures.cash += saleCashReceived(sale)
    figures.credit += saleCustomerCredit(sale)
    figures.pairs += salePairs(sale)
    if (sale.directTrade) figures.directTotal += sale.total
  }
  return figures
}
