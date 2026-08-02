/**
 * کنترل حساب‌ها: عددهای ذخیره‌شده (موجودی گدام، قرض مشتری، بیلانس تأمین‌کننده)
 * را از روی خودِ اسناد دوباره می‌سازد و با عدد ذخیره‌شده مقایسه می‌کند.
 *
 * قاعده‌های بازسازی دقیقاً همان قاعده‌هایی است که همگام‌سازی
 * (applyDocEffects در lib/sync.ts) هنگام پخش اسناد بین موبایل‌ها به کار می‌برد.
 */
import { db, landingSarrafOwed, type Adjustment, type Purchase, type Payment, type ReturnDoc, type Sale, type Variant } from '../db'

export interface Mismatch {
  kind: 'variant' | 'customer' | 'supplier'
  id: number
  name: string
  stored: number
  computed: number
  diff: number
}

export interface IntegrityReport {
  checkedAt: number
  variants: number
  parties: number
  mismatches: Mismatch[]
}

/** موجودی مورد انتظار هر سایز، از روی اسناد */
export function computeStock(
  sales: Sale[],
  purchases: Purchase[],
  adjustments: Adjustment[],
  returns: ReturnDoc[]
): Map<number, number> {
  const out = new Map<number, number>()
  const add = (id: number, n: number) => out.set(id, (out.get(id) ?? 0) + n)

  for (const s of sales) for (const l of s.lines) add(l.variantId, -l.qty)
  // خرید عادی موجودی می‌دهد؛ خرید «در راه» (چه رسیده و چه نرسیده) موجودی‌اش
  // از سند تعدیلِ رسید می‌آید — تا دو بار شمرده نشود
  for (const p of purchases) if (p.received === undefined) for (const l of p.lines) add(l.variantId, l.qty)
  for (const a of adjustments) add(a.variantId, a.qtyChange)
  for (const r of returns) {
    if (r.kind === 'customer') {
      for (const l of r.lines) if (l.restock) add(l.variantId, l.qty)
    } else {
      for (const l of r.lines) add(l.variantId, -l.qty)
    }
  }
  return out
}

/** قرض مورد انتظار هر مشتری، از روی اسناد */
export function computeCustomerBalances(sales: Sale[], payments: Payment[], returns: ReturnDoc[]): Map<number, number> {
  const out = new Map<number, number>()
  const add = (id: number | undefined, n: number) => {
    if (typeof id === 'number') out.set(id, (out.get(id) ?? 0) + n)
  }
  for (const s of sales) {
    const remainder = s.total - s.paid
    if (remainder > 0) add(s.customerId, remainder)
  }
  // مبلغ منفی = قرض قبلی، پس همیشه «منهای مبلغ»
  for (const p of payments) if (p.partyType === 'customer') add(p.partyId, -p.amount)
  for (const r of returns) if (r.kind === 'customer' && r.settlement === 'reduceDebt') add(r.partyId, -r.amount)
  return out
}

/** بیلانس مورد انتظار هر تأمین‌کننده/صراف، از روی اسناد */
export function computeSupplierBalances(purchases: Purchase[], payments: Payment[], returns: ReturnDoc[]): Map<number, number> {
  const out = new Map<number, number>()
  const add = (id: number | undefined, n: number) => {
    if (typeof id === 'number' && n !== 0) out.set(id, (out.get(id) ?? 0) + n)
  }
  for (const p of purchases) {
    const hawala = p.sarrafAmount ?? 0
    const remainder = p.total - p.paid - hawala
    if (remainder > 0) add(p.supplierId, remainder)
    if (hawala > 0) add(p.sarrafId, hawala)
    // مصارف رسیدن از طریق صراف — قرض ما به صراف
    add(p.landingSarrafId, landingSarrafOwed(p))
  }
  for (const p of payments) {
    if (p.partyType !== 'supplier') continue
    add(p.partyId, -p.amount)
    if (p.via === 'sarraf') add(p.sarrafId, p.amount)
  }
  for (const r of returns) if (r.kind === 'supplier' && r.settlement === 'reduceDebt') add(r.partyId, -r.amount)
  return out
}

const near = (a: number, b: number) => Math.abs(a - b) < 0.5

/** اجرای کامل کنترل روی دیتابیس */
export async function runIntegrityCheck(): Promise<IntegrityReport> {
  const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)
  const [sales, purchases, payments, adjustments, returns, variants, customers, suppliers, products] = await Promise.all([
    db.sales.toArray().then(live),
    db.purchases.toArray().then(live),
    db.payments.toArray().then(live),
    db.adjustments.toArray().then(live),
    db.returns.toArray().then(live),
    db.variants.toArray().then(live),
    db.customers.toArray().then(live),
    db.suppliers.toArray().then(live),
    db.products.toArray()
  ])

  const productName = new Map(products.map((p) => [p.id!, p.name]))
  const label = (v: Variant) => `${productName.get(v.productId) ?? 'جنس'} ${v.size} ${v.color}`.trim()

  const stock = computeStock(sales, purchases, adjustments, returns)
  const custBal = computeCustomerBalances(sales, payments, returns)
  const suppBal = computeSupplierBalances(purchases, payments, returns)

  const mismatches: Mismatch[] = []
  for (const v of variants) {
    const computed = stock.get(v.id!) ?? 0
    if (!near(v.stockQty, computed))
      mismatches.push({ kind: 'variant', id: v.id!, name: label(v), stored: v.stockQty, computed, diff: v.stockQty - computed })
  }
  for (const c of customers) {
    const computed = custBal.get(c.id!) ?? 0
    if (!near(c.balance, computed))
      mismatches.push({ kind: 'customer', id: c.id!, name: c.name, stored: c.balance, computed, diff: c.balance - computed })
  }
  for (const s of suppliers) {
    // سرمایهٔ شریک سند ندارد و از این کنترل بیرون است
    if (s.kind === 'partner') continue
    const computed = suppBal.get(s.id!) ?? 0
    if (!near(s.balance, computed))
      mismatches.push({ kind: 'supplier', id: s.id!, name: s.name, stored: s.balance, computed, diff: s.balance - computed })
  }

  return { checkedAt: Date.now(), variants: variants.length, parties: customers.length + suppliers.length, mismatches }
}

/** اصلاح: عدد ذخیره‌شده برابر عددِ ساخته‌شده از اسناد می‌شود */
export async function fixMismatch(m: Mismatch): Promise<void> {
  if (m.kind === 'variant') await db.variants.update(m.id, { stockQty: m.computed })
  else if (m.kind === 'customer') await db.customers.update(m.id, { balance: m.computed })
  else await db.suppliers.update(m.id, { balance: m.computed })
}
