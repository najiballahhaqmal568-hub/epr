/**
 * «کدام جنس در این ماه فروخته شده؟»
 *
 * هنگام حساب ماهانه لازم نیست تمام گدام از سر شمرده شود — فقط اجناسی که
 * حرکت کرده‌اند تغییر کرده‌اند. این فایل همان لیست را می‌سازد.
 */
import type { Sale, ReturnDoc } from '../db'
import { commercialSaleLines } from './commercialLines'

export interface SoldRow {
  key: string
  variantId?: number
  name: string
  size: string
  color: string
  qty: number
  revenue: number
  cost: number
  lastDate: number
}

/**
 * فروش هر سایز در یک دوره. مرجوعی مشتری از تعداد کم می‌شود تا عدد،
 * فروشِ واقعیِ باقی‌مانده باشد.
 */
export function soldInPeriod(sales: Sale[], returns: ReturnDoc[] = []): SoldRow[] {
  const map = new Map<string, SoldRow>()
  const row = (key: string, id: number | undefined, name: string, size: string, color: string) => {
    let r = map.get(key)
    if (!r) {
      r = { key, variantId: id, name, size, color, qty: 0, revenue: 0, cost: 0, lastDate: 0 }
      map.set(key, r)
    }
    return r
  }

  for (const s of sales) {
    if (s.deleted || s.directTrade?.status === 'cancelled') continue
    for (const l of commercialSaleLines(s)) {
      const key = l.variantId === undefined ? `direct:${l.productName}|${l.size}|${l.color}` : `variant:${l.variantId}`
      const r = row(key, l.variantId, l.productName, l.size, l.color)
      r.qty += l.qty
      r.revenue += l.qty * l.unitPrice
      r.cost += l.qty * (l.unitCost ?? 0)
      r.lastDate = Math.max(r.lastDate, s.date)
    }
  }

  for (const d of returns) {
    if (d.deleted || d.kind !== 'customer') continue
    for (const l of d.lines) {
      const r = map.get(`variant:${l.variantId}`)
      if (!r) continue
      r.qty -= l.qty
      r.revenue -= l.qty * l.unitPrice
      // قیمت خرید هم باید پس برود، ورنه «مفاد» کمتر از واقعیت نشان می‌دهد
      r.cost -= l.qty * (l.unitCost ?? 0)
    }
  }

  return [...map.values()].filter((r) => r.qty !== 0).sort((a, b) => b.qty - a.qty)
}

/** فقط شمارهٔ سایزهایی که در دوره حرکت کرده‌اند — برای کوتاه کردن شمارش گدام */
export function soldVariantIds(sales: Sale[], returns: ReturnDoc[] = []): Set<number> {
  const ids = new Set<number>()
  for (const s of sales) if (!s.deleted) for (const l of s.lines) ids.add(l.variantId)
  for (const d of returns) if (!d.deleted) for (const l of d.lines) ids.add(l.variantId)
  return ids
}
