/**
 * «دارایی خالص» — یک جا، برای همه.
 *
 * این عدد پیش از این در چهار صفحه جدا حساب می‌شد و از هم فرق کرده بود:
 * ویزارد شروع سال مصارف رسیدنِ پرداخت‌نشده را قرض حساب نمی‌کرد ولی صفحهٔ شرکا
 * می‌کرد، پس سرمایهٔ ثبت‌شده بیشتر از واقع می‌نشست و روز اول نقصِ ساختگی
 * نشان می‌داد. حالا هر جا این عدد لازم باشد، از همین‌جا می‌آید.
 *
 * قاعده‌ها (یک بار، همین‌جا):
 *  • ارزش گدام به قیمت تمام‌شده حساب می‌شود — و قیمت تمام‌شده مصارف رسیدن را
 *    در خود دارد. پس مصارف رسیدنِ پرداخت‌نشده حتماً باید قرض شمرده شود،
 *    وگرنه همان پول دو بار به سود ما حساب می‌شود.
 *  • شریک قرض نیست — سرمایهٔ او از دارایی کم نمی‌شود.
 *  • قرضِ اشخاص (lender) جدا نشان داده می‌شود ولی مثل هر قرض دیگر کم می‌شود.
 *  • بیلانس منفی یعنی طرف مقابل به ما مقروض است — آن، دارایی است.
 */
import { db, landingUnpaidOf, type Customer, type Purchase, type Supplier, type Variant, type CashMovement } from '../db'
import { afn } from './ops'

export interface NetWorth {
  /** ارزش جنس گدام به قیمت تمام‌شده */
  stock: number
  /** تعداد جوړه در گدام */
  pairs: number
  /** پول نقد در همهٔ جاها (دکان، خانه، صراف…) */
  cash: number
  /** طلب ما از مشتریان */
  receivables: number
  /** پیشکی ما نزد تأمین‌کننده یا صراف — دارایی است */
  supplierCredits: number
  /** قرض ما به تأمین‌کنندگان و صراف */
  payables: number
  /** قرض ما از اشخاص */
  loans: number
  /** مصارف رسیدنِ هنوز پرداخت‌نشده — قرض ما */
  unpaidLanding: number
  /** پیش‌پرداخت مشتریان — ما به آن‌ها مقروضیم */
  customerCredits: number
  /** دارایی خالص = هرچه داریم منهای هرچه قرضداریم */
  assets: number
}

export interface NetWorthInput {
  variants: Variant[]
  movements: CashMovement[]
  customers: Customer[]
  suppliers: Supplier[]
  purchases: Purchase[]
}

const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)

/** حساب خالص از روی داده‌های داده‌شده — بدون دیتابیس، پس قابل آزمایش است */
export function computeNetWorth(input: NetWorthInput): NetWorth {
  const variants = live(input.variants)
  const movements = live(input.movements)
  const customers = live(input.customers)
  const suppliers = live(input.suppliers)
  const purchases = live(input.purchases)

  // شریک قرض نیست؛ بقیه (تأمین‌کننده، صراف، قرض‌دهنده) قرض‌اند
  const owed = suppliers.filter((x) => x.kind !== 'partner')

  const stock = variants.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0)
  const pairs = variants.reduce((s, v) => s + v.stockQty, 0)
  const cash = movements.reduce((s, m) => s + m.amount, 0)
  const receivables = customers.reduce((s, c) => s + Math.max(0, c.balance), 0)
  const customerCredits = customers.reduce((s, c) => s + Math.max(0, -c.balance), 0)
  const supplierCredits = owed.reduce((s, x) => s + Math.max(0, -x.balance), 0)
  const payables = owed.filter((x) => x.kind !== 'lender').reduce((s, x) => s + Math.max(0, x.balance), 0)
  const loans = owed.filter((x) => x.kind === 'lender').reduce((s, x) => s + Math.max(0, x.balance), 0)
  const unpaidLanding = purchases.reduce((s, p) => s + landingUnpaidOf(p), 0)

  const assets = afn(
    stock + cash + receivables + supplierCredits - payables - loans - unpaidLanding - customerCredits
  )

  return {
    stock: afn(stock),
    pairs,
    cash: afn(cash),
    receivables: afn(receivables),
    supplierCredits: afn(supplierCredits),
    payables: afn(payables),
    loans: afn(loans),
    unpaidLanding: afn(unpaidLanding),
    customerCredits: afn(customerCredits),
    assets
  }
}

/** همان حساب، مستقیم از دیتابیس */
export async function netWorth(): Promise<NetWorth> {
  const [variants, movements, customers, suppliers, purchases] = await Promise.all([
    db.variants.toArray(),
    db.cashMovements.toArray(),
    db.customers.toArray(),
    db.suppliers.toArray(),
    db.purchases.toArray()
  ])
  return computeNetWorth({ variants, movements, customers, suppliers, purchases })
}
