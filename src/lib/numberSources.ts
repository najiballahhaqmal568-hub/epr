/**
 * «این عدد از کجا آمد؟» — هر عدد خانه به همان سطرهایی باز می‌شود که از آن‌ها ساخته شده.
 * قاعده‌ها عیناً همان lib/networth.ts است (سندهای حذف‌شده بیرون، شریک قرض نیست،
 * قرض‌دهنده جدا)، تا جمع سطرها همیشه با عدد کارت برابر باشد.
 */
import type { CashMovement, Customer, Product, Supplier, Variant } from '../db'
import { boxOf } from './financialPosting'

export interface SourceRow { key: string; label: string; amount: number; note?: string; /** For stock rows: purchase value of these pairs. */ value?: number }
export interface Explanation { total: number; rows: SourceRow[] }

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((row) => !row.deleted)
const byAmount = (a: SourceRow, b: SourceRow) => b.amount - a.amount || a.label.localeCompare(b.label, 'fa')
const round = (n: number) => Math.round(n)

/** طلب از مشتریان: هر مشتری که به ما قرضدار است. */
export function explainReceivables(customers: Customer[]): Explanation {
  const rows = live(customers).filter((c) => c.balance > 0)
    .map((c) => ({ key: `c${c.id}`, label: c.name, amount: c.balance, note: c.bookPage?.trim() ? `صفحهٔ ${c.bookPage.trim()}` : undefined }))
    .sort(byAmount)
  return { total: round(rows.reduce((s, r) => s + r.amount, 0)), rows }
}

/** صندوق: پول هر جا (دکان، خانه، صراف…) از جمع حرکت‌های همان جا. */
export function explainCash(movements: CashMovement[]): Explanation {
  const boxes = new Map<string, number>()
  for (const m of live(movements)) boxes.set(boxOf(m), (boxes.get(boxOf(m)) ?? 0) + m.amount)
  const rows = [...boxes.entries()].map(([box, amount]) => ({ key: `b${box}`, label: box, amount: round(amount) })).sort(byAmount)
  return { total: round(live(movements).reduce((s, m) => s + m.amount, 0)), rows }
}

/** موجودی گدام: جوړه‌ها و ارزش خرید هر جنس (همهٔ سایز و رنگ‌هایش). */
export function explainStock(products: Product[], variants: Variant[]): Explanation & { value: number } {
  const names = new Map(products.map((p) => [p.id!, p.name]))
  const byProduct = new Map<number, { pairs: number; value: number }>()
  for (const v of live(variants)) {
    if (!v.stockQty) continue
    const row = byProduct.get(v.productId) ?? { pairs: 0, value: 0 }
    row.pairs += v.stockQty
    row.value += v.stockQty * v.purchasePrice
    byProduct.set(v.productId, row)
  }
  const rows = [...byProduct.entries()]
    .map(([id, row]) => ({ key: `p${id}`, label: names.get(id) ?? 'جنس بی‌نام', amount: row.pairs, value: round(row.value) }))
    .sort(byAmount)
  const total = live(variants).reduce((s, v) => s + v.stockQty, 0)
  const value = round(live(variants).reduce((s, v) => s + v.stockQty * v.purchasePrice, 0))
  return { total, rows, value }
}

/** قرض ما: تأمین‌کنندگان و صراف‌ها. قرض از اشخاص (قرض‌دهنده) جدا برگردانده می‌شود. */
export function explainPayables(suppliers: Supplier[]): Explanation & { loans: Explanation } {
  const owed = live(suppliers).filter((s) => s.kind !== 'partner' && s.balance > 0)
  const row = (s: Supplier) => ({ key: `s${s.id}`, label: s.name, amount: s.balance, note: s.kind === 'sarraf' ? 'صراف' : undefined })
  const rows = owed.filter((s) => s.kind !== 'lender').map(row).sort(byAmount)
  const loanRows = owed.filter((s) => s.kind === 'lender').map(row).sort(byAmount)
  return {
    total: round(rows.reduce((s, r) => s + r.amount, 0)), rows,
    loans: { total: round(loanRows.reduce((s, r) => s + r.amount, 0)), rows: loanRows }
  }
}
