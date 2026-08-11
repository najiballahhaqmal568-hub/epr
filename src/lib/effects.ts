/**
 * اثر هر سند بر عددهای ذخیره‌شده — یک تعریف، سه مصرف‌کننده.
 *
 * پیش از این، اثر هر سند سه بار نوشته شده بود: یک بار در ops.ts (نوشتنِ همین
 * موبایل)، یک بار در sync.ts (پخش در موبایل دوم) و یک بار در integrity.ts
 * (بازسازی برای کنترل). ۱۴ قاعده که فقط حواسِ آدم آن‌ها را کنار هم نگه می‌داشت.
 * دو باری که پول غلط شد، هر دو از همین‌جا آمد:
 *   • خرید «در راه» هم از سند خرید و هم از سند رسید موجودی می‌گرفت
 *   • مصارف رسیدن از طریق صراف، در بازپخش دو برابر می‌شد
 *
 * حالا قاعده یک بار همین‌جا نوشته می‌شود و هر سه از همین می‌خوانند:
 *   • sync.ts  → اثرها را با علامت مثبت/منفی اعمال می‌کند
 *   • integrity.ts → اثرها را جمع می‌زند تا عدد مورد انتظار را بسازد
 *   • آزمایش تصادفی → می‌سنجد که ops.ts هم به همان عدد رسیده باشد
 */
import { landingSarrafOwed, type Adjustment, type Payment, type Purchase, type ReturnDoc, type Sale } from '../db'

export type EffectTable = 'variants' | 'customers' | 'suppliers'
export type EffectField = 'stockQty' | 'balance'

export interface Effect {
  table: EffectTable
  id: number | undefined
  field: EffectField
  delta: number
}

/** جدول‌هایی که سندشان اثر دارد */
export type DocTable = 'sales' | 'purchases' | 'payments' | 'adjustments' | 'returns'

const stock = (id: number | undefined, delta: number): Effect => ({ table: 'variants', id, field: 'stockQty', delta })
const debt = (id: number | undefined, delta: number): Effect => ({ table: 'customers', id, field: 'balance', delta })
const owed = (id: number | undefined, delta: number): Effect => ({ table: 'suppliers', id, field: 'balance', delta })

/**
 * همهٔ اثرهای یک سند. هر تغییری در این قاعده‌ها خودبه‌خود به هر سه جا می‌رسد.
 */
export function effectsOf(table: DocTable, doc: unknown): Effect[] {
  const out: Effect[] = []

  if (table === 'sales') {
    const s = doc as Sale
    // فروش: جنس از گدام کم می‌شود، باقی‌ماندهٔ پول قرضِ مشتری می‌شود
    for (const l of s.lines) out.push(stock(l.variantId, -l.qty))
    const remainder = s.total - s.paid
    if (remainder > 0) out.push(debt(s.customerId, remainder))
  } else if (table === 'purchases') {
    const p = doc as Purchase
    // خرید عادی (received تعریف‌نشده) موجودی می‌دهد. خرید «در راه» — چه رسیده و
    // چه نرسیده — موجودی‌اش از سند تعدیلِ رسید می‌آید، وگرنه دو بار شمرده می‌شود.
    if (p.received === undefined) for (const l of p.lines) out.push(stock(l.variantId, l.qty))
    const hawala = p.sarrafAmount ?? 0
    const remainder = p.total - p.paid - hawala
    if (remainder > 0) out.push(owed(p.supplierId, remainder))
    if (hawala > 0) out.push(owed(p.sarrafId, hawala))
    // مصارف رسیدن از طریق صراف — فقط بخشِ صراف، نه مجموع مصارف
    const landing = landingSarrafOwed(p)
    if (landing > 0) out.push(owed(p.landingSarrafId, landing))
  } else if (table === 'payments') {
    const p = doc as Payment
    // مبلغ منفی = «قرض قبلی»، پس همین یک قاعده هر دو حالت را می‌گیرد
    out.push(p.partyType === 'customer' ? debt(p.partyId, -p.amount) : owed(p.partyId, -p.amount))
    // پرداخت از راه صراف: قرض ما به تأمین‌کننده کم و به صراف زیاد می‌شود
    if (p.via === 'sarraf') out.push(owed(p.sarrafId, p.amount))
    // قرض‌دهنده مستقیماً فروشنده را پرداخته: قرض فروشنده کم و قرض قرض‌دهنده زیاد می‌شود
    if (p.via === 'lender') out.push(owed(p.lenderId, p.amount))
  } else if (table === 'adjustments') {
    const a = doc as Adjustment
    out.push(stock(a.variantId, a.qtyChange))
  } else if (table === 'returns') {
    const r = doc as ReturnDoc
    if (r.kind === 'customer') {
      // فقط جنس سالم به گدام برمی‌گردد
      for (const l of r.lines) if (l.restock) out.push(stock(l.variantId, l.qty))
      if (r.settlement === 'reduceDebt') out.push(debt(r.partyId, -r.amount))
    } else {
      for (const l of r.lines) out.push(stock(l.variantId, -l.qty))
      if (r.settlement === 'reduceDebt') out.push(owed(r.partyId, -r.amount))
    }
  }

  return out.filter((e) => typeof e.id === 'number' && e.delta !== 0)
}

/** جمعِ اثرِ همهٔ سندها — عددِ مورد انتظار هر جدول */
export function foldEffects(docs: { table: DocTable; rows: unknown[] }[]): {
  stockQty: Map<number, number>
  customerBalance: Map<number, number>
  supplierBalance: Map<number, number>
} {
  const stockQty = new Map<number, number>()
  const customerBalance = new Map<number, number>()
  const supplierBalance = new Map<number, number>()
  const bucket = (t: EffectTable) => (t === 'variants' ? stockQty : t === 'customers' ? customerBalance : supplierBalance)

  for (const { table, rows } of docs)
    for (const row of rows)
      for (const e of effectsOf(table, row)) {
        const m = bucket(e.table)
        m.set(e.id!, (m.get(e.id!) ?? 0) + e.delta)
      }

  return { stockQty, customerBalance, supplierBalance }
}
