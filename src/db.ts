import Dexie, { type EntityTable } from 'dexie'

export interface Product {
  id?: number
  name: string
  brand?: string
  category?: string
  photo?: string
  createdAt: number
}

export interface Variant {
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

export interface Customer {
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

export interface Supplier {
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

export interface Sale {
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

export interface Purchase {
  id?: number
  date: number
  supplierId: number
  supplierName: string
  lines: PurchaseLine[]
  total: number
  paid: number
}

export interface Payment {
  id?: number
  date: number
  partyType: 'customer' | 'supplier'
  partyId: number
  partyName: string
  amount: number
  note?: string
}

export interface ExpenseCategory {
  id?: number
  name: string
  isDefault?: boolean
}

export type ExpenseType = 'business' | 'home' | 'personal' | 'withdrawal'

export interface Expense {
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

export interface CashMovement {
  id?: number
  date: number
  type: CashMovementType
  refId?: number
  /** مثبت = ورود به صندوق، منفی = خروج */
  amount: number
  note?: string
}

export interface Reconciliation {
  id?: number
  date: number
  expected: number
  counted: number
  difference: number
  note?: string
}

export type AdjustReason = 'damaged' | 'lost' | 'correction' | 'returnDamaged'

export interface Adjustment {
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

export interface ReturnDoc {
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

db.on('populate', async (tx) => {
  for (const name of DEFAULT_EXPENSE_CATEGORIES) {
    await tx.table('expenseCategories').add({ name, isDefault: true })
  }
})

export function makeSku(id: number, size: string): string {
  return `B${String(id).padStart(4, '0')}-${size.replace(/\s/g, '')}`
}
