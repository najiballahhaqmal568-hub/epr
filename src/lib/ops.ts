import { db, type Sale, type Purchase, type Payment } from '../db'

/** ثبت فروش: کاهش گدام + قرض مشتری در یک تراکنش */
export async function addSale(sale: Sale): Promise<number> {
  return db.transaction('rw', db.sales, db.variants, db.customers, async () => {
    for (const line of sale.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      if (v.stockQty < line.qty) throw new Error(`موجودی کافی نیست: ${line.productName} ${line.size}`)
      await db.variants.update(line.variantId, { stockQty: v.stockQty - line.qty })
    }
    const remainder = sale.total - sale.paid
    if (remainder > 0 && sale.customerId) {
      const c = await db.customers.get(sale.customerId)
      if (c) await db.customers.update(sale.customerId, { balance: c.balance + remainder })
    }
    return (await db.sales.add(sale)) as number
  })
}

/** حذف فروش: برگشت گدام + برگشت قرض */
export async function deleteSale(saleId: number): Promise<void> {
  return db.transaction('rw', db.sales, db.variants, db.customers, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale) return
    for (const line of sale.lines) {
      const v = await db.variants.get(line.variantId)
      if (v) await db.variants.update(line.variantId, { stockQty: v.stockQty + line.qty })
    }
    const remainder = sale.total - sale.paid
    if (remainder > 0 && sale.customerId) {
      const c = await db.customers.get(sale.customerId)
      if (c) await db.customers.update(sale.customerId, { balance: c.balance - remainder })
    }
    await db.sales.delete(saleId)
  })
}

/** ثبت خرید: افزایش گدام + قرض ما به تأمین‌کننده */
export async function addPurchase(purchase: Purchase): Promise<number> {
  return db.transaction('rw', db.purchases, db.variants, db.suppliers, async () => {
    for (const line of purchase.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      await db.variants.update(line.variantId, {
        stockQty: v.stockQty + line.qty,
        purchasePrice: line.unitCost
      })
    }
    const remainder = purchase.total - purchase.paid
    if (remainder > 0) {
      const s = await db.suppliers.get(purchase.supplierId)
      if (s) await db.suppliers.update(purchase.supplierId, { balance: s.balance + remainder })
    }
    return (await db.purchases.add(purchase)) as number
  })
}

/** ثبت پرداخت/دریافت: کاهش قرض طرف حساب */
export async function addPayment(payment: Payment): Promise<number> {
  return db.transaction('rw', db.payments, db.customers, db.suppliers, async () => {
    if (payment.partyType === 'customer') {
      const c = await db.customers.get(payment.partyId)
      if (c) await db.customers.update(payment.partyId, { balance: c.balance - payment.amount })
    } else {
      const s = await db.suppliers.get(payment.partyId)
      if (s) await db.suppliers.update(payment.partyId, { balance: s.balance - payment.amount })
    }
    return (await db.payments.add(payment)) as number
  })
}

const TABLES = ['products', 'variants', 'customers', 'suppliers', 'sales', 'purchases', 'payments'] as const

export async function exportBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) data[t] = await db.table(t).toArray()
  return JSON.stringify({ app: 'shoeErp', version: 1, exportedAt: Date.now(), data })
}

export async function importBackup(json: string): Promise<void> {
  const parsed = JSON.parse(json)
  if (parsed?.app !== 'shoeErp' || !parsed.data) throw new Error('فایل بکاپ معتبر نیست')
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      if (Array.isArray(parsed.data[t])) await db.table(t).bulkAdd(parsed.data[t])
    }
  })
}
