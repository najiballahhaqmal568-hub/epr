/**
 * کنترل حساب‌ها: عددهای ذخیره‌شده (موجودی گدام، قرض مشتری، بیلانس تأمین‌کننده)
 * را از روی خودِ اسناد دوباره می‌سازد و با عدد ذخیره‌شده مقایسه می‌کند.
 *
 * قاعده‌های بازسازی دقیقاً همان قاعده‌هایی است که همگام‌سازی
 * (applyDocEffects در lib/sync.ts) هنگام پخش اسناد بین موبایل‌ها به کار می‌برد.
 */
import { computeCosts } from './costing'
import { foldEffects } from './effects'
import { db, type Adjustment, type Purchase, type Payment, type ReturnDoc, type Sale, type Variant } from '../db'

export interface Mismatch {
  kind: 'variant' | 'customer' | 'supplier' | 'cost'
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

/**
 * موجودی و بیلانس‌های مورد انتظار — همه از یک تعریف در lib/effects.ts.
 * این سه تابع فقط پوستهٔ نازکی روی همان‌اند تا امضایشان عوض نشود.
 */
export function computeStock(
  sales: Sale[],
  purchases: Purchase[],
  adjustments: Adjustment[],
  returns: ReturnDoc[]
): Map<number, number> {
  return foldEffects([
    { table: 'sales', rows: sales },
    { table: 'purchases', rows: purchases },
    { table: 'adjustments', rows: adjustments },
    { table: 'returns', rows: returns }
  ]).stockQty
}

/** قرض مورد انتظار هر مشتری، از روی اسناد */
export function computeCustomerBalances(sales: Sale[], payments: Payment[], returns: ReturnDoc[]): Map<number, number> {
  return foldEffects([
    { table: 'sales', rows: sales },
    { table: 'payments', rows: payments.filter((p) => p.partyType === 'customer') },
    { table: 'returns', rows: returns }
  ]).customerBalance
}

/** بیلانس مورد انتظار هر تأمین‌کننده/صراف، از روی اسناد */
export function computeSupplierBalances(purchases: Purchase[], payments: Payment[], returns: ReturnDoc[]): Map<number, number> {
  return foldEffects([
    { table: 'purchases', rows: purchases },
    { table: 'payments', rows: payments.filter((p) => p.partyType === 'supplier') },
    { table: 'returns', rows: returns }
  ]).supplierBalance
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
  // قیمت تمام‌شده هم از اسناد بازسازی می‌شود — پیش از این هیچ کنترلی نداشت
  const bought = new Set<number>()
  for (const p of purchases) if (p.received !== false) for (const l of p.lines) bought.add(l.variantId)
  const costs = computeCosts(
    sales,
    purchases,
    adjustments,
    returns,
    new Map(variants.filter((v) => !bought.has(v.id!)).map((v) => [v.id!, v.purchasePrice]))
  )
  const custBal = computeCustomerBalances(sales, payments, returns)
  const suppBal = computeSupplierBalances(purchases, payments, returns)

  const mismatches: Mismatch[] = []
  for (const v of variants) {
    const computed = stock.get(v.id!) ?? 0
    if (!near(v.stockQty, computed))
      mismatches.push({ kind: 'variant', id: v.id!, name: label(v), stored: v.stockQty, computed, diff: v.stockQty - computed })
  }
  for (const v of variants) {
    const computed = costs.get(v.id!)
    // قیمت میانگین است، نه پول واقعی — پس مقایسه با رواداری کوچک
    if (computed !== undefined && Math.abs(v.purchasePrice - computed) > 0.01)
      mismatches.push({
        kind: 'cost',
        id: v.id!,
        name: label(v),
        stored: v.purchasePrice,
        computed,
        diff: v.purchasePrice - computed
      })
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
  if (m.kind === 'cost') await db.variants.update(m.id, { purchasePrice: m.computed })
  else if (m.kind === 'variant') await db.variants.update(m.id, { stockQty: m.computed })
  else if (m.kind === 'customer') await db.customers.update(m.id, { balance: m.computed })
  else await db.suppliers.update(m.id, { balance: m.computed })
}
