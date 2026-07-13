import {
  db,
  makeSku,
  type Sale,
  type Purchase,
  type Payment,
  type Expense,
  type Adjustment,
  type ReturnDoc,
  type CashMovement
} from '../db'

function movement(m: Omit<CashMovement, 'id'>) {
  if (m.amount === 0) return Promise.resolve(0)
  return db.cashMovements.add(m)
}

/** ثبت فروش: کاهش گدام + قرض مشتری + ورود نقد به صندوق در یک تراکنش */
export async function addSale(sale: Sale): Promise<number> {
  return db.transaction('rw', db.sales, db.variants, db.customers, db.cashMovements, async () => {
    for (const line of sale.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      if (v.stockQty < line.qty) throw new Error(`موجودی کافی نیست: ${line.productName} ${line.size}`)
      await db.variants.update(line.variantId, { stockQty: v.stockQty - line.qty })
    }
    const remainder = sale.total - sale.paid
    if (remainder > 0 && sale.customerId) {
      const c = await db.customers.get(sale.customerId)
      if (c) {
        await db.customers.update(sale.customerId, {
          balance: c.balance + remainder,
          ...(sale.promiseDate ? { promiseDate: sale.promiseDate } : {})
        })
      }
    }
    const id = (await db.sales.add(sale)) as number
    await movement({ date: sale.date, type: 'sale', refId: id, amount: sale.paid, note: sale.customerName })
    return id
  })
}

/** حذف فروش: برگشت گدام + برگشت قرض + خروج نقد */
export async function deleteSale(saleId: number): Promise<void> {
  return db.transaction('rw', db.sales, db.variants, db.customers, db.cashMovements, async () => {
    const sale = await db.sales.get(saleId)
    if (!sale || sale.deleted) return
    for (const line of sale.lines) {
      const v = await db.variants.get(line.variantId)
      if (v) await db.variants.update(line.variantId, { stockQty: v.stockQty + line.qty })
    }
    const remainder = sale.total - sale.paid
    if (remainder > 0 && sale.customerId) {
      const c = await db.customers.get(sale.customerId)
      if (c) await db.customers.update(sale.customerId, { balance: c.balance - remainder })
    }
    await movement({ date: Date.now(), type: 'sale', refId: saleId, amount: -sale.paid, note: 'حذف فروش' })
    await db.sales.update(saleId, { deleted: true })
  })
}

/** ثبت خرید: افزایش گدام + قرض ما + خروج نقد */
export async function addPurchase(purchase: Purchase): Promise<number> {
  return db.transaction('rw', db.purchases, db.variants, db.suppliers, db.cashMovements, async () => {
    for (const line of purchase.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      // جنس «در راه» تا وقت رسیدن به گدام اضافه نمی‌شود
      if (purchase.received !== false) {
        await db.variants.update(line.variantId, {
          stockQty: v.stockQty + line.qty,
          purchasePrice: line.unitCost
        })
      }
    }
    const hawala = purchase.sarrafAmount ?? 0
    const remainder = purchase.total - purchase.paid - hawala
    if (remainder > 0) {
      const s = await db.suppliers.get(purchase.supplierId)
      if (s) await db.suppliers.update(purchase.supplierId, { balance: s.balance + remainder })
    }
    if (hawala > 0 && purchase.sarrafId) {
      const sf = await db.suppliers.get(purchase.sarrafId)
      if (sf) await db.suppliers.update(purchase.sarrafId, { balance: sf.balance + hawala })
    }
    const id = (await db.purchases.add(purchase)) as number
    await movement({ date: purchase.date, type: 'purchase', refId: id, amount: -purchase.paid, note: purchase.supplierName })
    return id
  })
}

/** رسید جنسِ خرید «در راه»: ورود به گدام به شکل سند تعدیل (تا به دستگاه‌های دیگر هم برسد) */
export async function receivePurchase(purchaseId: number): Promise<void> {
  return db.transaction('rw', db.purchases, db.variants, db.adjustments, async () => {
    const p = await db.purchases.get(purchaseId)
    if (!p || p.deleted || p.received !== false) return
    for (const line of p.lines) {
      const v = await db.variants.get(line.variantId)
      if (v) {
        await db.variants.update(line.variantId, { stockQty: v.stockQty + line.qty, purchasePrice: line.unitCost })
      }
      await db.adjustments.add({
        date: Date.now(),
        variantId: line.variantId,
        productName: line.productName,
        size: line.size,
        color: line.color,
        qtyChange: line.qty,
        reason: 'correction',
        note: `رسید خرید — ${p.supplierName}`
      })
    }
    await db.purchases.update(purchaseId, { received: true })
  })
}

/** ثبت پرداخت/دریافت: کاهش قرض طرف حساب + حرکت صندوق */
export async function addPayment(payment: Payment): Promise<number> {
  return db.transaction('rw', db.payments, db.customers, db.suppliers, db.cashMovements, async () => {
    if (payment.partyType === 'customer') {
      const c = await db.customers.get(payment.partyId)
      if (c) await db.customers.update(payment.partyId, { balance: c.balance - payment.amount })
      await movement({ date: payment.date, type: 'customerPayment', amount: payment.amount, note: payment.partyName })
    } else {
      const s = await db.suppliers.get(payment.partyId)
      if (s) await db.suppliers.update(payment.partyId, { balance: s.balance - payment.amount })
      if (payment.via === 'sarraf' && payment.sarrafId) {
        // حواله: پول از صندوق نمی‌رود؛ قرض ما به صراف زیاد می‌شود
        const sf = await db.suppliers.get(payment.sarrafId)
        if (sf) await db.suppliers.update(payment.sarrafId, { balance: sf.balance + payment.amount })
      } else {
        await movement({ date: payment.date, type: 'supplierPayment', amount: -payment.amount, note: payment.partyName })
      }
    }
    return (await db.payments.add(payment)) as number
  })
}

const EXPENSE_MOVE: Record<Expense['type'], 'expense' | 'homeExpense' | 'personalExpense' | 'withdrawal'> = {
  business: 'expense',
  home: 'homeExpense',
  personal: 'personalExpense',
  withdrawal: 'withdrawal'
}

/** ثبت مصرف (تجارت/خانه/شخصی) یا برداشت مالک: خروج نقد از صندوق */
export async function addExpense(expense: Expense): Promise<number> {
  return db.transaction('rw', db.expenses, db.cashMovements, async () => {
    const id = (await db.expenses.add(expense)) as number
    await movement({
      date: expense.date,
      type: EXPENSE_MOVE[expense.type],
      refId: id,
      amount: -expense.amount,
      note: expense.categoryName
    })
    return id
  })
}

export async function deleteExpense(expenseId: number): Promise<void> {
  return db.transaction('rw', db.expenses, db.cashMovements, async () => {
    const e = await db.expenses.get(expenseId)
    if (!e || e.deleted) return
    await movement({
      date: Date.now(),
      type: EXPENSE_MOVE[e.type],
      refId: expenseId,
      amount: e.amount,
      note: `حذف: ${e.categoryName}`
    })
    await db.expenses.update(expenseId, { deleted: true })
  })
}

/** تغییر نام کتگوری در لیست و در سوابق مصارف */
export async function renameCategory(categoryId: number, newName: string): Promise<void> {
  return db.transaction('rw', db.expenseCategories, db.expenses, async () => {
    await db.expenseCategories.update(categoryId, { name: newName })
    await db.expenses.where('categoryId').equals(categoryId).modify({ categoryName: newName })
  })
}

/** تعدیل گدام با دلیل (داغمه/مفقود/تصحیح) */
export async function addAdjustment(adj: Adjustment): Promise<number> {
  return db.transaction('rw', db.adjustments, db.variants, async () => {
    const v = await db.variants.get(adj.variantId)
    if (!v) throw new Error('جنس یافت نشد')
    const newQty = v.stockQty + adj.qtyChange
    if (newQty < 0) throw new Error('موجودی کافی نیست')
    await db.variants.update(adj.variantId, { stockQty: newQty })
    return (await db.adjustments.add(adj)) as number
  })
}

/** مرجوعی مشتری: برگشت به گدام یا داغمه + تصفیه (نقد/کاهش قرض) */
export async function addCustomerReturn(ret: ReturnDoc): Promise<number> {
  return db.transaction('rw', db.returns, db.variants, db.customers, db.adjustments, db.cashMovements, async () => {
    for (const line of ret.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      if (line.restock) {
        await db.variants.update(line.variantId, { stockQty: v.stockQty + line.qty })
      } else {
        await db.adjustments.add({
          date: ret.date,
          variantId: line.variantId,
          productName: line.productName,
          size: line.size,
          color: line.color,
          qtyChange: 0,
          reason: 'returnDamaged',
          note: `مرجوعی داغمه (${ret.reason})`
        })
      }
    }
    if (ret.settlement === 'cashRefund' && ret.amount > 0) {
      await movement({ date: ret.date, type: 'refund', amount: -ret.amount, note: `مرجوعی: ${ret.partyName}` })
    } else if (ret.settlement === 'reduceDebt' && ret.amount > 0 && ret.partyId) {
      const c = await db.customers.get(ret.partyId)
      if (c) await db.customers.update(ret.partyId, { balance: c.balance - ret.amount })
    }
    return (await db.returns.add(ret)) as number
  })
}

/**
 * تبادلهٔ جنس: مرجوعی + فروش جدید در یک تراکنش.
 * مرجوعی به شکل «بازپرداخت نقدی» و فروش با paid شامل ارزش جنس برگشتی ثبت می‌شود،
 * پس اثر خالص صندوق فقط تفاوت قیمت است و هر دو سند جداگانه همگام می‌شوند.
 */
export async function addExchange(ret: ReturnDoc, sale: Sale): Promise<void> {
  return db.transaction('rw', [db.returns, db.sales, db.variants, db.customers, db.adjustments, db.cashMovements], async () => {
    await addCustomerReturn(ret)
    await addSale(sale)
  })
}

/** مرجوعی به تأمین‌کننده: خروج از گدام + کاهش قرض ما */
export async function addSupplierReturn(ret: ReturnDoc): Promise<number> {
  return db.transaction('rw', db.returns, db.variants, db.suppliers, db.cashMovements, async () => {
    for (const line of ret.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      if (v.stockQty < line.qty) throw new Error(`موجودی کافی نیست: ${line.productName} ${line.size}`)
      await db.variants.update(line.variantId, { stockQty: v.stockQty - line.qty })
    }
    if (ret.amount > 0 && ret.partyId) {
      const s = await db.suppliers.get(ret.partyId)
      if (s) {
        if (ret.settlement === 'reduceDebt') {
          await db.suppliers.update(ret.partyId, { balance: s.balance - ret.amount })
        } else if (ret.settlement === 'cashRefund') {
          await movement({ date: ret.date, type: 'refund', amount: ret.amount, note: `مرجوعی به: ${ret.partyName}` })
        }
      }
    }
    return (await db.returns.add(ret)) as number
  })
}

export interface StocktakeResult {
  matched: number
  fixed: number
  valueDiff: number
}

/** شمارش فزیکی گدام: اختلاف هر جنس به شکل سند تصحیح ثبت می‌شود */
export async function applyStocktake(entries: { variantId: number; counted: number }[]): Promise<StocktakeResult> {
  const stamp = `شمارش گدام ${new Intl.DateTimeFormat('fa-AF', { dateStyle: 'short' }).format(Date.now())}`
  return db.transaction('rw', db.variants, db.adjustments, db.products, async () => {
    let matched = 0
    let fixed = 0
    let valueDiff = 0
    for (const e of entries) {
      const v = await db.variants.get(e.variantId)
      if (!v || v.deleted) continue
      const diff = e.counted - v.stockQty
      if (diff === 0) {
        matched++
        continue
      }
      const p = await db.products.get(v.productId)
      await db.variants.update(v.id!, { stockQty: e.counted })
      await db.adjustments.add({
        date: Date.now(),
        variantId: v.id!,
        productName: p?.name ?? '',
        size: v.size,
        color: v.color,
        qtyChange: diff,
        reason: 'correction',
        note: stamp
      })
      fixed++
      valueDiff += diff * v.purchasePrice
    }
    return { matched, fixed, valueDiff }
  })
}

export async function cashBalance(): Promise<number> {
  const all = await db.cashMovements.filter((m) => !m.deleted).toArray()
  return all.reduce((s, m) => s + m.amount, 0)
}

/** تصفیه صندوق: مقایسهٔ شمارش با موجودی مورد انتظار */
export async function reconcile(counted: number, note?: string): Promise<number> {
  return db.transaction('rw', db.cashMovements, db.reconciliations, async () => {
    const all = await db.cashMovements.filter((m) => !m.deleted).toArray()
    const expected = all.reduce((s, m) => s + m.amount, 0)
    const difference = counted - expected
    if (difference !== 0) {
      await movement({ date: Date.now(), type: 'openingSet', amount: difference, note: 'تصفیه صندوق' })
    }
    return (await db.reconciliations.add({ date: Date.now(), expected, counted, difference, note })) as number
  })
}

const TABLES = [
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
  'returns',
  'settings'
] as const

export async function exportBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) data[t] = await db.table(t).toArray()
  return JSON.stringify({ app: 'shoeErp', version: 2, exportedAt: Date.now(), data })
}

export async function importBackup(json: string): Promise<void> {
  const parsed = JSON.parse(json)
  if (parsed?.app !== 'shoeErp' || !parsed.data) throw new Error('فایل بکاپ معتبر نیست')
  await db.transaction('rw', TABLES.map((t) => db.table(t)), async () => {
    for (const t of TABLES) {
      await db.table(t).clear()
      if (Array.isArray(parsed.data[t])) await db.table(t).bulkAdd(parsed.data[t])
    }
    // بکاپ نسخهٔ ۱: کتگوری‌های پیش‌فرض و SKU را بساز
    if (!parsed.data.expenseCategories?.length) {
      const { DEFAULT_EXPENSE_CATEGORIES } = await import('../db')
      for (const name of DEFAULT_EXPENSE_CATEGORIES) {
        await db.expenseCategories.add({ name, isDefault: true })
      }
    }
    const variants = await db.variants.toArray()
    for (const v of variants) {
      if (!v.sku) await db.variants.update(v.id!, { sku: makeSku(v.id!, v.size) })
    }
  })
}

/** ریست کامل: همهٔ اسناد و اجناس در همه‌جا حذف (نرم) می‌شوند و به دستگاه‌های دیگر هم می‌رسد */
export async function resetAllData(): Promise<void> {
  const { SYNC_TABLES, DEFAULT_EXPENSE_CATEGORIES } = await import('../db')
  await db.transaction('rw', [...SYNC_TABLES.map((t) => db.table(t))], async () => {
    for (const t of SYNC_TABLES) {
      await db.table(t).filter((r) => !r.deleted).modify({ deleted: true })
    }
    for (const name of DEFAULT_EXPENSE_CATEGORIES) {
      await db.expenseCategories.add({ name, isDefault: true })
    }
  })
  await db.syncState.delete('expenseReminderDismissed')
}

const KEEP_SETTINGS = ['supaUrl', 'supaKey', 'pinHash', 'cachedProfile', 'expenseReminderOn', 'expenseReminderHour']

/** ریست این دستگاه: دیتابیس محلی پاک می‌شود؛ اطلاعات با همگام‌سازی از سرور برمی‌گردد */
export async function resetLocalDevice(): Promise<void> {
  const kept: { key: string; value: unknown }[] = []
  for (const k of KEEP_SETTINGS) {
    const s = await db.settings.get(k)
    if (s) kept.push(s)
  }
  localStorage.setItem('restoreSettings', JSON.stringify(kept))
  await db.delete()
  window.location.reload()
}
