import { fmtMoney } from '../../../lib/format'

/** «+۱٬۲۰۰ ؋» / «−۱٬۲۰۰ ؋» / «۰ ؋» — a change, not a balance. */
export function signed(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtMoney(Math.abs(value))}`
}
