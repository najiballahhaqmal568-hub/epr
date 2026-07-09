import Dexie, { type EntityTable } from 'dexie'

interface Synced {
  /** شناسهٔ جهانی برای همگام‌سازی بین دستگاه‌ها */
  uuid?: string
  deleted?: boolean
  /** زمان آخرین تغییر محلی — برای ارسال به سرور */
  localUpdatedAt?: number
}

export interface Product extends Synced {
  id?: number
  name: string
  brand?: string
  category?: string
  photo?: string
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
  /** حد سفارش مجدد */
  lowStock: number
}

export interface Customer extends Synced {
  id?: number
  name: string
  phone?: string
  type: 'retail' | 'wholesale'
  /** مثبت = مشتری قرضدار است */
  balance: number
  flag?: 'good' | 'bad' | null
  /** وعدهٔ بعدی پرداخت */
  promiseDate?: number
}

export interface Supplier extends Synced {
  id?: number
  name: string
  phone?: string
  /** مثبت = ما به تأمین‌کننده قرضدار هستیم */
  balance: number
}

export interface SaleLine {
  variantId: number
  productName: string
  size: string
  color: string
  qty: number
  unitPrice: number
}

export interface Sale extends Synced {
  id?: number
  date: number
  customerId?: number
  customerName?: string
  saleType: 'retail' | 'wholesale'
  lines: SaleLine[]
  total: number
  paid: number
  promiseDate?: number
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
}

export interface Payment extends Synced {
  id?: number
  date: number
  partyType: 'customer' | 'supplier'
  partyId: number
  partyName: string
  amount: number
  note?: string
}

export interface ExpenseCategory extends Synced {
  id?: number
  name: string
  isDefault?: boolean
}

export type ExpenseType = 'business' | 'home' | 'personal' | 'withdrawal'

export interface Expense extends Synced {
  id?: number
  date: number
  categoryId?: number
  categoryName: string
  amount: number
  note?: string
  type: ExpenseType
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

export interface CashMovement extends Synced {
  id?: number
  date: number
  type: CashMovementType
  refId?: number
  /** مثبت = ورود به صندوق، منفی = خروج */
  amount: number
  note?: string
}

export interface Reconciliation extends Synced {
  id?: number
  date: number
  expected: number
  counted: number
  difference: number
  note?: string
}

export type AdjustReason = 'damaged' | 'lost' | 'correction' | 'returnDamaged'

export interface Adjustment extends Synced {
  id?: number
  date: number
  variantId: number
  productName: string
  size: string
  color: string
  qtyChange: number
  reason: AdjustReason
  note?: string
}

export interface ReturnLine {
  variantId: number
  productName: string
  size: string
  color: string
  qty: number
  unitPrice: number
  restock: boolean
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

for (const t of SYNC_TABLES) {
  db.table(t).hook('creating', (_pk, obj: Record<string, unknown>) => {
    if (!obj.uuid) obj.uuid = newUuid()
    obj.localUpdatedAt = syncFlags.applyingRemote ? 0 : Date.now()
  })
  db.table(t).hook('updating', (mods) => {
    if (syncFlags.applyingRemote) return { ...(mods as object), localUpdatedAt: 0 }
    return { ...(mods as object), localUpdatedAt: Date.now() }
  })
}
