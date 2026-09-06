import type { Sale } from '../db'
import { addCalendarDays, fromDateInput, startOfDay, toLatinDigits } from './format'

export function groupSaleHistory(sales: Sale[], search = '', from = '', to = '') {
  const lower = from ? startOfDay(fromDateInput(from)) : -Infinity
  const upper = to ? addCalendarDays(fromDateInput(to), 1) : Infinity
  const words = toLatinDigits(search).trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = new Map<number, { day: number; sales: Sale[]; total: number }>()
  for (const sale of sales) {
    if (sale.deleted || sale.lenderAction || sale.date < lower || sale.date >= upper) continue
    const hay = toLatinDigits(`${sale.customerName || 'مشتری نقدی'} ${sale.lines.map(line => `${line.productName} ${line.size} ${line.color}`).join(' ')}`).toLowerCase()
    if (!words.every(word => hay.includes(word))) continue
    const day = startOfDay(sale.date)
    const group = groups.get(day) ?? { day, sales: [], total: 0 }
    group.sales.push(sale)
    group.total += sale.total
    groups.set(day, group)
  }
  return [...groups.values()].sort((a, b) => b.day - a.day).map(group => ({
    ...group, sales: group.sales.sort((a, b) => b.date - a.date || (b.id ?? 0) - (a.id ?? 0))
  }))
}
