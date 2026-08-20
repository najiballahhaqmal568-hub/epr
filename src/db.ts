import Dexie, { type EntityTable } from 'dexie'

interface Synced {
  /** شناسهٔ جهانی برای همگام‌سازی بین دستگاه‌ها */
  uuid?: string
  deleted?: boolean
  /** زمان آخرین تغییر محلی — برای ارسال به سرور */
  localUpdatedAt?: number
}

export interface CartonItem {
  size: string
  color: string
  qty: number
}

/** کارتن‌بندی: ترکیب سایزهای یک کارتن + قیمت عمدهٔ فی کارتن (اختیاری) */
export interface CartonDef {
  price?: number
  items: CartonItem[]
}

export interface Product extends Synced {
  id?: number
  name: string
  brand?: string
  category?: string
  photo?: string
  carton?: CartonDef
  /** ظرفیت کارتن برای هشدار خرید؛ اگر ثبت نشده باشد ۱۲ جفت حساب می‌شود. */
  pairsPerCarton?: number
  /** وقتی چند کارتن یا کمتر ماند هشدار بدهد؛ پیش‌فرض یک کارتن. */
  reorderAtCartons?: number
  createdAt: number
}

export interface Variant extends Synced {
  id?: number
  productId: number
  size: string
  color: string
  sku?: string
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  stockQty: number
  /** @deprecated هشدار خرید اکنون برای کل جنس و براساس کارتن حساب می‌شود. */
  lowStock: number
  /** آخرین باری که این سایز خریداری/رسید شد — برای سن جنس در گدام */
  lastPurchaseAt?: number
}

export interface Customer extends Synced {
  id?: number
  name: string
  phone?: string
  type: 'retail' | 'wholesale'
  /** نام خانواده — اعضای یک خانواده در دفتر قرض پرچون یکجا دیده می‌شوند */
  family?: string
  /** مثبت = مشتری قرضدار است */
  balance: number
  flag?: 'good' | 'bad' | null
  /** وعدهٔ بعدی پرداخت */
  promiseDate?: number
  /** تاریخ ثبت مشتری — برای چیدمان «تازه ثبت‌شده» */
  createdAt?: number
  /**
   * صفحهٔ دفترِ فزیکی — «۱۲» یا «۱۲/الف».
   * کدام دفتر را خودِ `type` می‌گوید: پرچون یا عمده.
   * فقط یادداشت است؛ به هیچ عددی (قرض، صندوق، مفاد) کاری ندارد.
   */
  bookPage?: string
}

export interface Supplier extends Synced {
  id?: number
  name: string
  phone?: string
  /** مثبت = ما به تأمین‌کننده قرضدار هستیم */
  balance: number
  /** 'sarraf' = صراف، 'partner' = شریک، 'expenseCreditor' = طلبکار مصرف */
  kind?: 'supplier' | 'sarraf' | 'partner' | 'lender' | 'expenseCreditor'
  /** یادداشت — مثلاً شرایط پرداخت قرض‌دهنده */
  note?: string
  /** فیصدی سهم شریک از مفاد */
  share?: number
  /** سرمایهٔ این شریک = ارزش جنس گدام (برای مالک) */
  stockCapital?: boolean
  /** سرمایهٔ ثبت‌شدهٔ سال جاری شراکت */
  capital?: number
}

export interface SaleLine {
  variantId: number
  productName: string
  size: string
  color: string
  qty: number
  unitPrice: number
  /** قیمت خرید در لحظهٔ فروش — مفاد از همین حساب می‌شود و با تغییر قیمت بعدی عوض نمی‌شود */
  unitCost?: number
}

/**
 * جزئیات کفشی که پیش از استفاده از اپ داده شده است.
 * ممکن است آن کفش دیگر در گدام فعلی وجود نداشته باشد، پس پیوند به variant اختیاری است.
 */
export type HistoricalGoodsLine = Omit<SaleLine, 'variantId'> & { variantId?: number }

/** نوع رفت‌وآمد میان دکان و قرض‌دهنده؛ نام‌ها عمداً جدا اند تا معنای سند گم نشود. */
export type LenderAction = 'cashRepayment' | 'cashLoan' | 'goodsSettlement' | 'goodsCredit'

export interface Sale extends Synced {
  id?: number
  date: number
  customerId?: number
  customerName?: string
  saleType: 'retail' | 'wholesale'
  lines: SaleLine[]
  total: number
  paid: number
  discount?: number
  promiseDate?: number
  /**
   * صفحهٔ دفترِ فزیکی که این فروش در آن نوشته شد.
   * روی خودِ سند می‌ماند، نه روی مشتری — چون مشتری عمده چند صفحه دارد و
   * صفحهٔ فعلی‌اش عوض می‌شود؛ اگر از مشتری خوانده می‌شد، قرضِ صفحه‌های
   * گذشته هم به صفحهٔ نو می‌پرید.
   */
  bookPage?: string
  /** کفشی که قرض‌دهنده برده؛ حسابش با یک Payment هم‌گروه نگه داشته می‌شود. */
  lenderId?: number
  lenderName?: string
  lenderAction?: Extract<LenderAction, 'goodsSettlement' | 'goodsCredit'>
  /** کفشی که برای تسویهٔ مصرف قرضی داده شده است. */
  expenseCreditorId?: number
  expenseCreditorName?: string
  /** پول واقعیِ همین فروش؛ پرداخت با حساب قرض نقد نیست. */
  cashPaid?: number
  groupUuid?: string
}

/** پول واقعی که از یک فروش وارد صندوق شده است. */
export function saleCashPaid(sale: Sale): number {
  if (typeof sale.cashPaid === 'number') return sale.cashPaid
  if (sale.lenderAction || sale.expenseCreditorId) return 0
  return sale.paid
}

/** قرض مشتریِ واقعی؛ فروش‌های تسویهٔ حساب شخص مشتری عادی نیستند. */
export function saleCreditAmount(sale: Sale): number {
  if (sale.lenderAction || sale.expenseCreditorId) return 0
  return Math.max(0, sale.total - sale.paid)
}

export interface PurchaseLine {
  variantId: number
  productName: string
  size: string
  color: string
  qty: number
  unitCost: number
}

export interface Purchase extends Synced {
  id?: number
  date: number
  supplierId: number
  supplierName: string
  lines: PurchaseLine[]
  total: number
  paid: number
  /** false = جنس هنوز نرسیده (در راه)؛ undefined/true = تحویل گدام شده */
  received?: boolean
  /** تاریخ رسیدن به گدام — قیمت تمام‌شده در همین لحظه در میانگین می‌نشیند */
  receivedAt?: number
  /** پرداخت از طریق صراف (حواله) */
  sarrafId?: number
  sarrafName?: string
  sarrafAmount?: number
  /** مصارف رسیدن جنس (کرایه/حمالی/کمیشن صراف) — در قیمت تمام‌شدهٔ هر جوړه می‌نشیند */
  landingCost?: number
  landingVia?: 'cash' | 'sarraf' | 'later'
  landingSarrafId?: number
  landingSarrafName?: string
  landingPaid?: boolean
  /** بخشی از مصارف رسیدن که هنوز پرداخت نشده (حالت «بعداً») */
  landingUnpaid?: number
  /**
   * بخشی از مصارف رسیدن که از طریق صراف پرداخت شده — جمع می‌شود.
   * `landingCost` مجموع همهٔ دفعات است و `landingVia` فقط آخرین دفعه را نگه می‌دارد،
   * پس اگر یک خرید هم نقد و هم از صراف مصارف بگیرد، از روی آن دو نمی‌توان
   * فهمید چقدرش قرضِ صراف است. این عدد همان را جدا نگه می‌دارد.
   */
  landingSarrafAmount?: number
}

/**
 * قرض ما به صراف بابت مصارف رسیدنِ یک خرید.
 * هر سه جا (ops، sync، integrity) باید از همین یک تابع بخوانند تا فرق نکنند.
 * خریدهای قدیمی این عدد را ندارند؛ برای آن‌ها همان قاعدهٔ قبلی به کار می‌رود.
 */
export function landingSarrafOwed(p: Purchase): number {
  return p.landingSarrafAmount ?? (p.landingVia === 'sarraf' ? (p.landingCost ?? 0) : 0)
}

/**
 * مصارف رسیدنِ هنوز پرداخت‌نشدهٔ یک خرید — قرضِ ما بابت کرایه و حمالی.
 * چون این مبلغ در قیمت تمام‌شدهٔ جنس نشسته (ارزش گدام آن را دارد)،
 * هر جا «دارایی خالص» حساب می‌شود باید کم شود، وگرنه دو بار شمرده می‌شود.
 */
export function landingUnpaidOf(p: Purchase): number {
  return p.landingUnpaid ?? (p.landingPaid === false ? (p.landingCost ?? 0) : 0)
}

export interface Payment extends Synced {
  id?: number
  date: number
  partyType: 'customer' | 'supplier'
  partyId: number
  partyName: string
  amount: number
  note?: string
  /** سرچشمهٔ پول: صندوق، صراف، قرض‌دهنده، یا قرض قبلیِ بدون حرکت صندوق */
  via?: 'cash' | 'sarraf' | 'lender' | 'opening' | 'goods'
  sarrafId?: number
  sarrafName?: string
  /** سهم همین پرداخت که صراف داده است؛ باقی مبلغ از صندوق پرداخت شده. اسناد قدیمیِ صراف بدون این فیلد کاملاً صرافی‌اند. */
  sarrafAmount?: number
  /** وقتی قرض‌دهنده مستقیماً فروشنده را پرداخت کرده است */
  lenderId?: number
  lenderName?: string
  /** معنای دقیق پول/کفشی که به خود قرض‌دهنده داده شده است. */
  lenderAction?: LenderAction
  /** این رفت‌وآمد پیش از استفاده از اپ رخ داده و فقط حساب افتتاحیه را می‌سازد. */
  lenderOpening?: boolean
  /** پرداخت بعدیِ قرض یک مصرف، با پول یا کفش. */
  expenseCreditorSettlement?: 'cash' | 'goods'
  settlementExcessMode?: 'cash' | 'credit'
  /** جزئیات کفشِ سند قبلی؛ چون نباید فروش یا حرکت گدام امروز ساخته شود. */
  goodsLines?: HistoricalGoodsLine[]
  /** پیوند پایدار میان سند کفش (Sale) و سند حساب (Payment)، حتی میان دو موبایل. */
  groupUuid?: string
  /** اثر دقیق همین سند بر صندوق هنگام ثبت؛ برای حذف امن و بدون حدس */
  cashDelta?: number
  /** جای پولِ پرداخت یا دریافت نقدی. */
  box?: string
  /** صفحهٔ دفترِ فزیکی که این سند در آن نوشته شد — مثل Sale.bookPage */
  bookPage?: string
}

export interface ExpenseCategory extends Synced {
  id?: number
  name: string
  isDefault?: boolean
  /** این کتگوری در هر روز باز دکان باید بررسی شود. */
  dailyEnabled?: boolean
  /** عقب‌مانده‌ها فقط از روز فعال‌شدن این کتگوری ساخته می‌شوند. */
  dailyFrom?: number
  /** پیشنهاد قابل تغییر برای فورم هر روز. */
  dailyDefaultAmount?: number
  dailyDefaultPaymentMode?: 'cash' | 'credit' | 'mixed'
}

export type ExpenseType = 'business' | 'home' | 'personal' | 'withdrawal'

export interface Expense extends Synced {
  id?: number
  date: number
  categoryId?: number
  categoryName: string
  amount: number
  /** بخشی که همان لحظه از صندوق پرداخت شده؛ سندهای قدیمی یعنی تمام مبلغ. */
  cashPaid?: number
  /** بخشی که به قرض طلبکار مصرف ثبت شده است. */
  creditAmount?: number
  creditorId?: number
  creditorName?: string
  /** جای پول بخش نقدی. */
  box?: string
  note?: string
  type: ExpenseType
  /** سند وضعیت روز بسته؛ مصرف و حرکت صندوق نیست. */
  shopClosed?: boolean
}

export type CashMovementType =
  | 'sale'
  | 'purchase'
  | 'expense'
  | 'homeExpense'
  | 'personalExpense'
  | 'withdrawal'
  | 'customerPayment'
  | 'supplierPayment'
  | 'refund'
  | 'openingSet'
  | 'capitalIn'
  | 'landing'
  | 'loanIn'
  | 'loanRepay'
  | 'lenderCashLoan'
  | 'expenseCreditorReceipt'
  | 'transfer'

export interface CashMovement extends Synced {
  id?: number
  date: number
  type: CashMovementType
  refId?: number
  /** مثبت = ورود به صندوق، منفی = خروج */
  amount: number
  /** جای پول: دکان، خانه، صراف… — خالی یعنی «دکان» */
  box?: string
  note?: string
  /** برای سرمایه‌گذاری و برداشت شریک */
  partnerName?: string
}

export interface Reconciliation extends Synced {
  id?: number
  date: number
  expected: number
  counted: number
  difference: number
  note?: string
}

export type AdjustReason = 'damaged' | 'lost' | 'correction' | 'returnDamaged' | 'purchaseReceived'

export interface Adjustment extends Synced {
  id?: number
  /** سند خرید مربوط، برای رسیدنِ خرید در راه و اصلاح/ابطال امن آن */
  refId?: number
  date: number
  variantId: number
  productName: string
  size: string
  color: string
  qtyChange: number
  reason: AdjustReason
  note?: string
  /**
   * قیمت تمام‌شدهٔ جنسی که با این سند وارد گدام می‌شود.
   * فقط وقتی لازم است که موجودی از جای دیگری بیاید (مثلاً یکجا کردن دو جنس)،
   * تا بازسازیِ قیمت از روی اسناد همان میانگین را بسازد که خودِ عملیات ساخت.
   */
  unitCost?: number
}

export interface ReturnLine {
  variantId: number
  productName: string
  size: string
  color: string
  qty: number
  unitPrice: number
  restock: boolean
  /** قیمت خرید همان وقت — برای کم‌کردن مفاد مرجوعی */
  unitCost?: number
}

export interface ReturnDoc extends Synced {
  id?: number
  date: number
  kind: 'customer' | 'supplier'
  partyId?: number
  partyName: string
  refId?: number
  lines: ReturnLine[]
  reason: string
  settlement: 'cashRefund' | 'reduceDebt' | 'none'
  amount: number
  /** نوع فروشِ اصلی — تا مرجوعی از مفاد عمده یا پرچون کم شود */
  saleType?: 'retail' | 'wholesale'
}

/** جنس کاندید برای خرید آینده — با منبع (تلگرام/واتساپ) و مشخصات فروشگاه */
export interface Candidate {
  id?: number
  name: string
  source?: 'telegram' | 'whatsapp' | 'market' | 'other'
  shopName?: string
  /** آدرس یا لینک کانال/چت */
  address?: string
  phone?: string
  price?: number
  note?: string
  photo?: string
  createdAt: number
}

export interface Setting {
  key: string
  value: unknown
}

/** جدول‌هایی که بین دستگاه‌ها همگام می‌شوند */
export const SYNC_TABLES = [
  'products',
  'variants',
  'customers',
  'suppliers',
  'sales',
  'purchases',
  'payments',
  'expenseCategories',
  'expenses',
  'cashMovements',
  'reconciliations',
  'adjustments',
  'returns'
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

export interface OutboxRow {
  id?: number
  table: SyncTable
  uuid: string
  createdAt: number
}

export interface SyncStateRow {
  key: string
  value: unknown
}

export function newUuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID()
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export const db = new Dexie('shoeErp') as Dexie & {
  products: EntityTable<Product, 'id'>
  variants: EntityTable<Variant, 'id'>
  customers: EntityTable<Customer, 'id'>
  suppliers: EntityTable<Supplier, 'id'>
  sales: EntityTable<Sale, 'id'>
  purchases: EntityTable<Purchase, 'id'>
  payments: EntityTable<Payment, 'id'>
  expenseCategories: EntityTable<ExpenseCategory, 'id'>
  expenses: EntityTable<Expense, 'id'>
  cashMovements: EntityTable<CashMovement, 'id'>
  reconciliations: EntityTable<Reconciliation, 'id'>
  adjustments: EntityTable<Adjustment, 'id'>
  returns: EntityTable<ReturnDoc, 'id'>
  candidates: EntityTable<Candidate, 'id'>
  settings: Dexie.Table<Setting, string>
  outbox: EntityTable<OutboxRow, 'id'>
  syncState: Dexie.Table<SyncStateRow, string>
}

db.version(1).stores({
  products: '++id, name, createdAt',
  variants: '++id, productId, size',
  customers: '++id, name',
  suppliers: '++id, name',
  sales: '++id, date, customerId',
  purchases: '++id, date, supplierId',
  payments: '++id, date, [partyType+partyId]'
})

export const DEFAULT_EXPENSE_CATEGORIES = [
  'کرایه',
  'برق',
  'انترنت',
  'ترانسپورت',
  'چای و خوراکه',
  'خریطه و بسته‌بندی',
  'ترمیم',
  'متفرقه'
]

db.version(2)
  .stores({
    products: '++id, name, createdAt',
    variants: '++id, productId, size',
    customers: '++id, name',
    suppliers: '++id, name',
    sales: '++id, date, customerId',
    purchases: '++id, date, supplierId',
    payments: '++id, date, [partyType+partyId]',
    expenseCategories: '++id, name',
    expenses: '++id, date, categoryId, type',
    cashMovements: '++id, date, type',
    reconciliations: '++id, date',
    adjustments: '++id, date, variantId',
    returns: '++id, date, kind',
    settings: 'key'
  })
  .upgrade(async (tx) => {
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await tx.table('expenseCategories').add({ name, isDefault: true })
    }
    const variants = await tx.table('variants').toArray()
    for (const v of variants) {
      if (!v.sku) await tx.table('variants').update(v.id, { sku: makeSku(v.id, v.size) })
    }
  })

db.version(3)
  .stores({
    products: '++id, name, createdAt, uuid, localUpdatedAt',
    variants: '++id, productId, size, uuid, localUpdatedAt',
    customers: '++id, name, uuid, localUpdatedAt',
    suppliers: '++id, name, uuid, localUpdatedAt',
    sales: '++id, date, customerId, uuid, localUpdatedAt',
    purchases: '++id, date, supplierId, uuid, localUpdatedAt',
    payments: '++id, date, [partyType+partyId], uuid, localUpdatedAt',
    expenseCategories: '++id, name, uuid, localUpdatedAt',
    expenses: '++id, date, categoryId, type, uuid, localUpdatedAt',
    cashMovements: '++id, date, type, uuid, localUpdatedAt',
    reconciliations: '++id, date, uuid, localUpdatedAt',
    adjustments: '++id, date, variantId, uuid, localUpdatedAt',
    returns: '++id, date, kind, uuid, localUpdatedAt',
    settings: 'key',
    outbox: '++id, table, createdAt',
    syncState: 'key'
  })
  .upgrade(async (tx) => {
    for (const t of SYNC_TABLES) {
      const rows = await tx.table(t).toArray()
      for (const r of rows) {
        if (!r.uuid) await tx.table(t).update(r.id, { uuid: newUuid(), localUpdatedAt: Date.now() })
      }
    }
  })

/**
 * نسخهٔ ۴: سند «موجودی/بیلانس اولیه» برای دادهٔ موجود.
 * در همگام‌سازی، موجودی گدام و قرض‌ها فقط از روی اسناد بازسازی می‌شوند؛
 * پس باید تفاوت وضعیت فعلی با مجموع اثر اسناد به شکل سند پایه ثبت شود.
 */
db.version(4).upgrade(async (tx) => {
  const sales = (await tx.table('sales').toArray()).filter((s) => !s.deleted)
  const purchases = await tx.table('purchases').toArray()
  const adjustments = await tx.table('adjustments').toArray()
  const returns = await tx.table('returns').toArray()
  const payments = await tx.table('payments').toArray()

  const stockEffect = new Map<number, number>()
  const addFx = (id: number | undefined, d: number) => {
    if (typeof id === 'number') stockEffect.set(id, (stockEffect.get(id) ?? 0) + d)
  }
  sales.forEach((s) => s.lines.forEach((l: { variantId: number; qty: number }) => addFx(l.variantId, -l.qty)))
  purchases.forEach((p) => p.lines.forEach((l: { variantId: number; qty: number }) => addFx(l.variantId, l.qty)))
  adjustments.forEach((a) => addFx(a.variantId, a.qtyChange))
  returns.forEach((r) =>
    r.lines.forEach((l: { variantId: number; qty: number; restock: boolean }) =>
      addFx(l.variantId, r.kind === 'customer' ? (l.restock ? l.qty : 0) : -l.qty)
    )
  )

  const variants = await tx.table('variants').toArray()
  for (const v of variants) {
    const baseline = (v.stockQty ?? 0) - (stockEffect.get(v.id) ?? 0)
    if (baseline !== 0) {
      await tx.table('adjustments').add({
        date: 1,
        variantId: v.id,
        productName: '',
        size: v.size,
        color: v.color,
        qtyChange: baseline,
        reason: 'correction',
        note: 'موجودی اولیه'
      })
    }
  }

  const balEffect = new Map<string, number>()
  const addBal = (t: string, id: number | undefined, d: number) => {
    if (typeof id === 'number') balEffect.set(`${t}:${id}`, (balEffect.get(`${t}:${id}`) ?? 0) + d)
  }
  sales.forEach((s) => {
    const rem = saleCreditAmount(s)
    if (rem > 0) addBal('customer', s.customerId, rem)
  })
  purchases.forEach((p) => {
    const rem = p.total - p.paid
    if (rem > 0) addBal('supplier', p.supplierId, rem)
  })
  payments.forEach((p) => addBal(p.partyType, p.partyId, -p.amount))
  returns.forEach((r) => {
    if (r.settlement === 'reduceDebt') addBal(r.kind === 'customer' ? 'customer' : 'supplier', r.partyId, -r.amount)
  })

  for (const t of ['customers', 'suppliers'] as const) {
    const rows = await tx.table(t).toArray()
    const kind = t === 'customers' ? 'customer' : 'supplier'
    for (const r of rows) {
      const baseline = (r.balance ?? 0) - (balEffect.get(`${kind}:${r.id}`) ?? 0)
      if (baseline !== 0) {
        await tx.table('payments').add({
          date: 1,
          partyType: kind,
          partyId: r.id,
          partyName: r.name,
          amount: -baseline,
          note: 'بیلانس اولیه'
        })
      }
    }
  }
})

// نسخهٔ ۵: جدول کاندیدهای خرید (محلی — همگام نمی‌شود)
db.version(5).stores({
  candidates: '++id, name, createdAt'
})

/** نسخهٔ ۶: تاریخ آخرین خرید هر سایز از روی خریدهای گذشته پر می‌شود */
db.version(6).upgrade(async (tx) => {
  const purchases = await tx.table('purchases').toArray()
  const last = new Map<number, number>()
  for (const p of purchases) {
    if (p.deleted || p.received === false) continue
    for (const l of p.lines ?? []) {
      if (!last.has(l.variantId) || p.date > last.get(l.variantId)!) last.set(l.variantId, p.date)
    }
  }
  for (const [variantId, date] of last) {
    await tx.table('variants').update(variantId, { lastPurchaseAt: date })
  }
})

db.on('populate', async (tx) => {
  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    await tx.table('expenseCategories').add({ name, isDefault: true })
  }
})

export function makeSku(id: number, size: string): string {
  return `B${String(id).padStart(4, '0')}-${size.replace(/\s/g, '')}`
}

/** هنگام اعمال تغییرات دریافتی از سرور true می‌شود تا دوباره به صف ارسال نروند */
export const syncFlags = { applyingRemote: false }

/** حالت «فقط مشاهده» (شریک): هیچ تغییری در ارقام ثبت نمی‌شود */
export const accessFlags = { readOnly: false }

function guardReadOnly() {
  // تغییرات دریافتی از سرور (همگام‌سازی) باید ثبت شوند؛ فقط تغییرات محلی کاربر بسته می‌شوند
  if (accessFlags.readOnly && !syncFlags.applyingRemote) {
    throw new Error('حالت فقط مشاهده: شما اجازهٔ تغییر ندارید.')
  }
}

for (const t of SYNC_TABLES) {
  db.table(t).hook('creating', (_pk, obj: Record<string, unknown>) => {
    guardReadOnly()
    if (!obj.uuid) obj.uuid = newUuid()
    obj.localUpdatedAt = syncFlags.applyingRemote ? 0 : Date.now()
  })
  db.table(t).hook('updating', (mods) => {
    guardReadOnly()
    if (syncFlags.applyingRemote) return { ...(mods as object), localUpdatedAt: 0 }
    return { ...(mods as object), localUpdatedAt: Date.now() }
  })
}
