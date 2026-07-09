import Dexie, { type EntityTable } from 'dexie'

export interface Product {
  id?: number
  name: string
  brand?: string
  category?: string
  createdAt: number
}

export interface Variant {
  id?: number
  productId: number
  size: string
  color: string
  purchasePrice: number
  retailPrice: number
  wholesalePrice: number
  stockQty: number
  lowStock: number
}

export interface Customer {
  id?: number
  name: string
  phone?: string
  type: 'retail' | 'wholesale'
  /** مثبت = مشتری قرضدار است */
  balance: number
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

export const db = new Dexie('shoeErp') as Dexie & {
  products: EntityTable<Product, 'id'>
  variants: EntityTable<Variant, 'id'>
  customers: EntityTable<Customer, 'id'>
  suppliers: EntityTable<Supplier, 'id'>
  sales: EntityTable<Sale, 'id'>
  purchases: EntityTable<Purchase, 'id'>
  payments: EntityTable<Payment, 'id'>
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
