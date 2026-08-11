import { applyRebuiltCosts, landedUnitCost, weightedCost } from './costing'
import { effectsOf } from './effects'
import { db, makeSku, newUuid, SYNC_TABLES, landingUnpaidOf, DEFAULT_EXPENSE_CATEGORIES, type Variant, type Sale, type SaleLine, type Purchase, type Payment, type Expense, type Adjustment, type ReturnDoc, type CashMovement, type Supplier, type LenderAction } from '../db'

// خوانندهٔ مشترک، در db.ts زندگی می‌کند تا sync و integrity هم بتوانند بخوانند
export { landingUnpaidOf }

/**
 * پول همیشه به افغانی صحیح — تا در تقسیم و جمع، کسر و «پول گم‌شده» پیدا نشود.
 * قیمت تمام‌شدهٔ فی‌جوړه از این قاعده مستثنی است، چون میانگین است نه پول واقعی.
 */
export const afn = (n: number): number => Math.round(n)

/**
 * تقسیم یک مبلغ صحیح به سهم‌های صحیح، به نسبت وزن‌ها.
 * باقی‌ماندهٔ افغانی به بزرگ‌ترین کسرها داده می‌شود تا جمع سهم‌ها دقیقاً برابر مبلغ شود.
 */
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)
  const whole = afn(total)
  const raw = weights.map((w) => (whole * w) / sum)
  const out = raw.map((r) => Math.floor(r))
  let rest = whole - out.reduce((a, b) => a + b, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k].i]++
  return out
}

/** جای پول پیش‌فرض — صندوق دکان */
export const SHOP_BOX = 'دکان'

/** نام جای پول یک حرکت (سندهای کهنه بدون نام = دکان) */
export const boxOf = (m: { box?: string }): string => m.box?.trim() || SHOP_BOX

async function movement(m: Omit<CashMovement, 'id'>, opts?: { allowNegative?: boolean }) {
  m = { ...m, amount: afn(m.amount), box: boxOf(m) }
  if (m.amount === 0) return 0
  // پول نباید از جایی که نیست خرج شود — کنترل برای همان جای پول
  if (m.amount < 0 && !opts?.allowNegative) {
    const all = await db.cashMovements.filter((x) => !x.deleted && boxOf(x) === m.box).toArray()
    const bal = all.reduce((s, x) => s + x.amount, 0)
    if (bal + m.amount < 0) {
      const nf = new Intl.NumberFormat('fa-AF')
      throw new Error(`پیسه در «${m.box}» کافی نیست! موجودی: ${nf.format(bal)} ؋`)
    }
  }
  return db.cashMovements.add(m)
}

/**
 * انتقال پول بین جاها (دکان ← خانه ← صراف).
 * دو سند ثبت می‌شود و اثر خالص روی پول کل صفر است — نه مصرف است و نه برداشت،
 * پس در مفاد و در سهم شرکا هیچ تغییری نمی‌دهد.
 */
export async function transferCash(from: string, to: string, amount: number, note?: string): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) throw new Error('مبلغ باید بیشتر از صفر باشد')
  if (from.trim() === to.trim()) throw new Error('مبدأ و مقصد یکی است')
  return db.transaction('rw', db.cashMovements, async () => {
    await movement({ date: Date.now(), type: 'transfer', box: from, amount: -amount, note: note?.trim() || `انتقال به ${to}` })
    await movement({ date: Date.now(), type: 'transfer', box: to, amount, note: note?.trim() || `انتقال از ${from}` })
  })
}

/** موجودی هر جای پول، و مجموع کل */
export async function boxBalances(): Promise<{ boxes: { name: string; balance: number }[]; total: number }> {
  const all = await db.cashMovements.filter((m) => !m.deleted).toArray()
  const map = new Map<string, number>()
  for (const m of all) map.set(boxOf(m), (map.get(boxOf(m)) ?? 0) + m.amount)
  if (!map.has(SHOP_BOX)) map.set(SHOP_BOX, 0)
  const boxes = [...map.entries()]
    .map(([name, balance]) => ({ name, balance }))
    .sort((a, b) => (a.name === SHOP_BOX ? -1 : b.name === SHOP_BOX ? 1 : b.balance - a.balance))
  return { boxes, total: boxes.reduce((s, b) => s + b.balance, 0) }
}

/** ثبت فروش: کاهش گدام + قرض مشتری + ورود نقد به صندوق در یک تراکنش */
export async function addSale(sale: Sale): Promise<number> {
  sale.total = afn(sale.total)
  sale.paid = afn(sale.paid)
  if (sale.discount !== undefined) sale.discount = afn(sale.discount)
  sale.lines.forEach((l) => (l.unitPrice = afn(l.unitPrice)))
  return db.transaction('rw', db.sales, db.variants, db.customers, db.cashMovements, async () => {
    for (const line of sale.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      if (v.stockQty < line.qty) throw new Error(`موجودی کافی نیست: ${line.productName} ${line.size}`)
      // قیمت خرید همین لحظه در فاکتور ثبت می‌شود تا مفاد بعداً تغییر نکند
      line.unitCost = v.purchasePrice
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
  return db.transaction('rw', [db.sales, db.payments, db.variants, db.customers, db.suppliers, db.cashMovements, db.purchases, db.adjustments, db.returns], async () => {
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
    // کفشِ قرض‌دهنده دو نیمه دارد: فروش برای گدام/مفاد و پرداخت برای حساب شخص.
    // حذف هر کدام باید نیمهٔ دیگر را هم برگرداند تا سند نیمه‌تمام نماند.
    const linkedPayment = sale.groupUuid
      ? await db.payments.filter((p) => !p.deleted && p.groupUuid === sale.groupUuid).first()
      : undefined
    if (linkedPayment) {
      for (const e of effectsOf('payments', linkedPayment)) {
        const row = (await db.table(e.table).get(e.id!)) as Record<string, number> | undefined
        if (row) await db.table(e.table).update(e.id!, { [e.field]: (row[e.field] ?? 0) - e.delta })
      }
      await db.payments.update(linkedPayment.id!, { deleted: true })
    }
    // پول در همان جایی برمی‌گردد که آمده بود
    const orig = await db.cashMovements.filter((m) => !m.deleted && m.type === 'sale' && m.refId === saleId).first()
    // کفش قرض‌دهنده نقد نیست؛ paid آن «پرداخت با حساب» است و صندوق نباید لمس شود.
    if (!sale.lenderAction) {
      // حذفِ اصلاحی است — حتی اگر پول کم شود باید ثبت گردد
      await movement(
        { date: Date.now(), type: 'sale', refId: saleId, amount: -sale.paid, box: orig ? boxOf(orig) : SHOP_BOX, note: 'حذف فروش' },
        { allowNegative: true }
      )
    }
    await db.sales.update(saleId, { deleted: true })
    // حذف یک سند، تاریخچه را عوض می‌کند و میانگین قیمت به ترتیب رویدادها بند است.
    // پس قیمت دوباره از روی اسنادِ باقی‌مانده ساخته می‌شود تا موبایل دوم هم به
    // همان عدد برسد.
    await applyRebuiltCosts()
  })
}

/**
 * اثر حذف یک فروش بر پول — پیش از تأیید نشان داده می‌شود.
 * حذف هرگز جلو گرفته نمی‌شود (باید بتوان اشتباه را پس گرفت)، ولی اگر پول منفی شود هشدار داده می‌شود.
 */
export async function deleteSaleImpact(
  saleId: number
): Promise<{ paid: number; box: string; before: number; after: number } | null> {
  const sale = await db.sales.get(saleId)
  if (!sale || sale.deleted) return null
  const orig = await db.cashMovements.filter((m) => !m.deleted && m.type === 'sale' && m.refId === saleId).first()
  const box = orig ? boxOf(orig) : SHOP_BOX
  const before = await cashBalance(box)
  const paid = sale.lenderAction ? 0 : sale.paid
  return { paid, box, before, after: before - paid }
}

// قاعده‌های قیمت تمام‌شده در lib/costing.ts زندگی می‌کنند تا sync و integrity هم همان را ببینند
export { landedUnitCost }

/** ثبت خرید: افزایش گدام (به قیمت تمام‌شده) + قرض ما + خروج نقد + مصارف رسیدن */
export async function addPurchase(purchase: Purchase): Promise<number> {
  purchase.total = afn(purchase.total)
  purchase.paid = afn(purchase.paid)
  if (purchase.sarrafAmount !== undefined) purchase.sarrafAmount = afn(purchase.sarrafAmount)
  return db.transaction('rw', [db.purchases, db.variants, db.suppliers, db.cashMovements, db.sales, db.adjustments, db.returns], async () => {
    // «رسیده» فقط با receivePurchase ساخته می‌شود، نه در لحظهٔ ثبت خرید.
    // اگر اینجا اجازه داده شود، موجودی‌اش نه از سند خرید می‌آید و نه از سند رسید.
    if (purchase.received === true) throw new Error('خرید نو نمی‌تواند «رسیده» ثبت شود')
    for (const line of purchase.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      // جنس «در راه» تا وقت رسیدن به گدام اضافه نمی‌شود — همان قاعدهٔ lib/effects.ts
      if (purchase.received === undefined) {
        await db.variants.update(line.variantId, {
          stockQty: v.stockQty + line.qty,
          // میانگین وزنی با موجودی قبلی — قیمت تمام‌شده شامل مصارف رسیدن
          purchasePrice: weightedCost(v.stockQty, v.purchasePrice, line.qty, landedUnitCost(purchase, line.unitCost)),
          lastPurchaseAt: Math.max(v.lastPurchaseAt ?? 0, purchase.date)
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
    // قیمت تمام‌شده تابعی از اسناد است — بعد از ثبت، از نو ساخته می‌شود تا
    // این موبایل و موبایل دوم دقیقاً به یک عدد برسند
    await applyRebuiltCosts()
    return id
  })
}

/**
 * ثبت مصارف رسیدن بعد از تحویل جنس — برای یک یا چند خرید (یک حمل).
 * مبلغ کل مساوی فی جوړه بین همهٔ جوړه‌های آن خریدها پخش و در قیمت تمام‌شده می‌نشیند.
 * اگر قبلاً مصرفی ثبت شده باشد، مبلغ نو روی آن جمع می‌شود.
 */
export async function addLandingCost(
  purchaseIds: number[],
  amount: number,
  via: 'cash' | 'sarraf' | 'later',
  sarraf?: { id: number; name: string }
): Promise<void> {
  amount = afn(amount)
  if (amount <= 0 || !purchaseIds.length) return
  return db.transaction('rw', [db.purchases, db.variants, db.suppliers, db.cashMovements, db.sales, db.adjustments, db.returns], async () => {
    const list = (await db.purchases.bulkGet(purchaseIds)).filter((p): p is Purchase => Boolean(p) && !p!.deleted)
    if (!list.length) throw new Error('خریدی یافت نشد')
    const pairsOf = (p: Purchase) => p.lines.reduce((a, l) => a + l.qty, 0)
    const totalPairs = list.reduce((s, p) => s + pairsOf(p), 0)
    if (totalPairs <= 0) throw new Error('تعداد جوړه صفر است')
    // سهم هر خرید به افغانی صحیح — جمع سهم‌ها دقیقاً برابر مبلغ کل می‌شود
    const shares = allocate(amount, list.map(pairsOf))

    // قیمت تمام‌شده بعد از ثبت مصارف، یک‌جا از روی اسناد بازسازی می‌شود (پایین‌تر)
    for (const [idx, p] of list.entries()) {
      const share = shares[idx]
      const unpaidBefore = landingUnpaidOf(p)
      const unpaidAfter = via === 'later' ? unpaidBefore + share : unpaidBefore
      await db.purchases.update(p.id!, {
        landingCost: (p.landingCost ?? 0) + share,
        landingUnpaid: unpaidAfter,
        landingVia: via,
        landingPaid: unpaidAfter <= 0,
        ...(via === 'sarraf' && sarraf
          ? {
              landingSarrafId: sarraf.id,
              landingSarrafName: sarraf.name,
              // فقط بخشِ صراف جمع می‌شود — نه مجموع مصارف رسیدن
              landingSarrafAmount: (p.landingSarrafAmount ?? 0) + share
            }
          : { landingSarrafAmount: p.landingSarrafAmount ?? 0 })
      })
    }

    // قیمت تمام‌شده = تابعی از اسناد. بعد از تغییرِ مصارف رسیدن، دوباره ساخته می‌شود
    // تا این موبایل و موبایل دوم به یک عدد برسند.
    await applyRebuiltCosts()

    const names = list.map((p) => p.supplierName).join('، ')
    const whole = shares.reduce((a, b) => a + b, 0)
    if (via === 'cash') {
      await movement({ date: Date.now(), type: 'landing', refId: list[0].id, amount: -whole, note: `مصارف رسیدن — ${names}` })
    } else if (via === 'sarraf' && sarraf) {
      const sf = await db.suppliers.get(sarraf.id)
      if (sf) await db.suppliers.update(sarraf.id, { balance: sf.balance + whole })
    }
  })
}



/** پرداخت بخشِ «بعداً»ی مصارف رسیدن — نقد از صندوق */
export async function payLanding(purchaseId: number): Promise<void> {
  return db.transaction('rw', db.purchases, db.cashMovements, async () => {
    const p = await db.purchases.get(purchaseId)
    if (!p || p.deleted) return
    const due = landingUnpaidOf(p)
    if (due <= 0) return
    await movement({ date: Date.now(), type: 'landing', refId: purchaseId, amount: -due, note: `مصارف رسیدن — ${p.supplierName}` })
    await db.purchases.update(purchaseId, { landingUnpaid: 0, landingPaid: true })
  })
}

/** رسید جنسِ خرید «در راه»: ورود به گدام به شکل سند تعدیل (تا به دستگاه‌های دیگر هم برسد) */
export async function receivePurchase(purchaseId: number): Promise<void> {
  return db.transaction('rw', [db.purchases, db.variants, db.adjustments, db.sales, db.returns], async () => {
    const p = await db.purchases.get(purchaseId)
    if (!p || p.deleted || p.received !== false) return
    for (const line of p.lines) {
      const v = await db.variants.get(line.variantId)
      if (v) {
        await db.variants.update(line.variantId, {
          stockQty: v.stockQty + line.qty,
          purchasePrice: weightedCost(v.stockQty, v.purchasePrice, line.qty, landedUnitCost(p, line.unitCost)),
          lastPurchaseAt: Math.max(v.lastPurchaseAt ?? 0, Date.now())
        })
      }
      await db.adjustments.add({
        date: Date.now(),
        variantId: line.variantId,
        productName: line.productName,
        size: line.size,
        color: line.color,
        qtyChange: line.qty,
        // دلیل مشخص تا در «کنترل حساب‌ها» با خودِ خرید دوباره شمرده نشود
        reason: 'purchaseReceived',
        note: `رسید خرید — ${p.supplierName}`
      })
    }
    await db.purchases.update(purchaseId, { received: true, receivedAt: Date.now() })
    await applyRebuiltCosts()
  })
}

/** اثر دقیق سند پرداخت بر صندوق؛ سندهای جدید ذخیره می‌کنند و سندهای قدیمی با قاعدهٔ سازگار خوانده می‌شوند. */
function paymentCashDelta(payment: Payment, partyKind?: Supplier['kind']): number {
  if (typeof payment.cashDelta === 'number') return afn(payment.cashDelta)
  if (payment.via === 'opening' || payment.via === 'sarraf' || payment.via === 'lender' || payment.via === 'goods') return 0
  if (payment.amount < 0) return partyKind === 'lender' ? -payment.amount : 0
  return payment.partyType === 'customer' ? payment.amount : -payment.amount
}

/** ثبت پرداخت/دریافت: کاهش قرض طرف حساب + حرکت صندوق */
export async function addPayment(payment: Payment): Promise<number> {
  payment.amount = afn(payment.amount)
  if (payment.amount <= 0) throw new Error('مبلغ باید بیشتر از صفر باشد')
  return db.transaction('rw', db.payments, db.customers, db.suppliers, db.cashMovements, async () => {
    if (payment.partyType === 'customer') {
      const c = await db.customers.get(payment.partyId)
      if (!c || c.deleted) throw new Error('مشتری یافت نشد')
      payment.via = 'cash'
      payment.cashDelta = payment.amount
      await db.customers.update(payment.partyId, { balance: c.balance - payment.amount })
    } else {
      const s = await db.suppliers.get(payment.partyId)
      if (!s || s.deleted) throw new Error('فروشنده یافت نشد')
      await db.suppliers.update(payment.partyId, { balance: s.balance - payment.amount })
      if (payment.via === 'sarraf') {
        if (!payment.sarrafId) throw new Error('صراف را انتخاب کنید')
        // حواله: پول از صندوق نمی‌رود؛ قرض ما به صراف زیاد می‌شود
        const sf = await db.suppliers.get(payment.sarrafId)
        if (!sf || sf.deleted || sf.kind !== 'sarraf') throw new Error('صراف یافت نشد')
        payment.cashDelta = 0
        await db.suppliers.update(payment.sarrafId, { balance: sf.balance + payment.amount })
      } else if (payment.via === 'lender') {
        if (!payment.lenderId) throw new Error('قرض‌دهنده را انتخاب کنید')
        // قرض‌دهنده پول را مستقیم به فروشنده داده؛ صندوق اصلاً دست نمی‌خورد.
        const lender = await db.suppliers.get(payment.lenderId)
        if (!lender || lender.deleted || lender.kind !== 'lender') throw new Error('قرض‌دهنده یافت نشد')
        if (lender.id === s.id) throw new Error('فروشنده و قرض‌دهنده نمی‌تواند یک نفر باشد')
        payment.cashDelta = 0
        payment.lenderName = lender.name
        await db.suppliers.update(payment.lenderId, { balance: lender.balance + payment.amount })
      } else {
        payment.via = 'cash'
        payment.cashDelta = -payment.amount
      }
    }
    const paymentId = (await db.payments.add(payment)) as number
    if (payment.cashDelta) {
      await movement({
        date: payment.date,
        type: payment.partyType === 'customer' ? 'customerPayment' : 'supplierPayment',
        refId: paymentId,
        amount: payment.cashDelta,
        note: payment.partyName
      })
    }
    return paymentId
  })
}

/**
 * قرض قبلی (پیش از استفاده از اپ): فقط بیلانس طرف بالا می‌رود.
 * سند پرداخت با مبلغ منفی ثبت می‌شود تا بین دستگاه‌ها همگام شود؛
 * نه فروش است، نه در مفاد می‌آید و نه صندوق را تغییر می‌دهد.
 */
/**
 * حذف یک سند پرداخت یا «قرض قبلی» که اشتباه ثبت شده.
 *
 * اثرش از روی همان تعریف مشترک (effectsOf) برعکس می‌شود، پس با «کنترل
 * حساب‌ها» و با موبایل دوم می‌خواند. اگر پولی جابه‌جا شده بود، سندِ برگشت
 * نوشته می‌شود — سند قدیم پاک نمی‌شود تا رد کار بماند.
 */
export async function deletePayment(paymentId: number): Promise<void> {
  return db.transaction('rw', [db.payments, db.sales, db.variants, db.customers, db.suppliers, db.cashMovements, db.purchases, db.adjustments, db.returns], async () => {
    const p = await db.payments.get(paymentId)
    if (!p || p.deleted) return
    for (const e of effectsOf('payments', p)) {
      const row = (await db.table(e.table).get(e.id!)) as Record<string, number> | undefined
      if (row) await db.table(e.table).update(e.id!, { [e.field]: (row[e.field] ?? 0) - e.delta })
    }
    const linkedSale = p.groupUuid
      ? await db.sales.filter((s) => !s.deleted && s.groupUuid === p.groupUuid).first()
      : undefined
    if (linkedSale) {
      for (const e of effectsOf('sales', linkedSale)) {
        const row = (await db.table(e.table).get(e.id!)) as Record<string, number> | undefined
        if (row) await db.table(e.table).update(e.id!, { [e.field]: (row[e.field] ?? 0) - e.delta })
      }
      await db.sales.update(linkedSale.id!, { deleted: true })
    }
    const primary = p.partyType === 'customer' ? await db.customers.get(p.partyId) : await db.suppliers.get(p.partyId)
    const primaryKind = p.partyType === 'supplier' ? (primary as Supplier | undefined)?.kind : undefined
    const cashDelta = paymentCashDelta(p, primaryKind)
    if (cashDelta !== 0) {
      await movement(
        {
          date: Date.now(),
          type: p.partyType === 'customer'
            ? 'customerPayment'
            : primaryKind === 'lender'
              ? p.amount < 0
                ? 'loanIn'
                : p.lenderAction === 'cashLoan'
                  ? 'lenderCashLoan'
                  : 'loanRepay'
              : 'supplierPayment',
          refId: paymentId,
          amount: -cashDelta,
          note: `حذف — ${p.partyName}`
        },
        // اصلاح اشتباه است؛ حتی اگر پول کم شود باید ثبت گردد
        { allowNegative: true }
      )
    }
    await db.payments.update(paymentId, { deleted: true })
    if (linkedSale) await applyRebuiltCosts()
  })
}

/**
 * اثر حذف یک سند بر حساب — پیش از تأیید نشان داده می‌شود تا مالک بداند
 * چه عددی چطور عوض می‌شود.
 */
export async function deletePaymentImpact(
  paymentId: number
): Promise<{
  label: string
  partyName: string
  before: number
  after: number
  cash: number
  related?: { partyName: string; before: number; after: number }
  goods?: { pairs: number; items: string }
} | null> {
  const p = await db.payments.get(paymentId)
  if (!p || p.deleted) return null
  const table = p.partyType === 'customer' ? db.customers : db.suppliers
  const row = await table.get(p.partyId)
  const before = row?.balance ?? 0
  // اثر پرداخت بر بیلانس «منهای مبلغ» است، پس حذفش «به‌علاوهٔ مبلغ»
  const after = before + p.amount
  const partyKind = p.partyType === 'supplier' ? (row as Supplier | undefined)?.kind : undefined
  const cashDelta = paymentCashDelta(p, partyKind)
  let related: { partyName: string; before: number; after: number } | undefined
  if (p.via === 'lender' && p.lenderId) {
    const lender = await db.suppliers.get(p.lenderId)
    if (lender) related = { partyName: lender.name, before: lender.balance, after: lender.balance - p.amount }
  }
  const linkedSale = p.groupUuid
    ? await db.sales.filter((s) => !s.deleted && s.groupUuid === p.groupUuid).first()
    : undefined
  const goods = linkedSale
    ? {
        pairs: linkedSale.lines.reduce((sum, line) => sum + line.qty, 0),
        items: linkedSale.lines
          .map((line) => `${line.productName} ${line.size} ${line.color} ×${line.qty}`.replace(/\s+/g, ' ').trim())
          .join('، ')
      }
    : undefined
  const actionLabel: Partial<Record<LenderAction, string>> = {
    cashRepayment: 'پرداخت نقدی قرض',
    cashLoan: 'قرض نقدی به قرض‌دهنده',
    goodsSettlement: 'کفش بابت تسویه',
    goodsCredit: 'کفش قرضی به قرض‌دهنده'
  }
  return {
    label: p.via === 'lender'
      ? 'پرداخت مستقیم قرض‌دهنده به فروشنده'
      : p.lenderAction
        ? actionLabel[p.lenderAction]!
        : p.amount < 0 ? (p.note?.trim() || 'قرض قبلی') : 'دریافت/پرداخت پول',
    partyName: p.partyName,
    before,
    after,
    cash: -cashDelta,
    related,
    goods
  }
}

export async function addOpeningDebt(
  partyType: 'customer' | 'supplier',
  partyId: number,
  partyName: string,
  amount: number,
  note?: string,
  bookPage?: string
): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.payments, db.customers, db.suppliers, async () => {
    const table = partyType === 'customer' ? db.customers : db.suppliers
    const row = await table.get(partyId)
    if (!row) throw new Error('طرف حساب یافت نشد')
    // صفحهٔ همین قرض، «آخرین صفحهٔ» مشتری می‌شود تا قرض بعدی خودش همان را پیشنهاد کند
    const page = bookPage?.trim()
    await table.update(partyId, {
      balance: row.balance + amount,
      ...(page && partyType === 'customer' ? { bookPage: page } : {})
    })
    await db.payments.add({
      date: Date.now(),
      partyType,
      partyId,
      partyName,
      amount: -amount,
      note: note?.trim() ? `قرض قبلی — ${note.trim()}` : 'قرض قبلی',
      via: 'opening',
      cashDelta: 0,
      bookPage: page || undefined
    })
  })
}

/** سرمایه‌گذاری شریک: پول وارد صندوق و روی سرمایهٔ ثابتش جمع می‌شود؛ در فروش و مفاد حساب نمی‌شود */
export async function addCapital(partnerId: number, partnerName: string, amount: number, note?: string): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.suppliers, db.cashMovements, async () => {
    const p = await db.suppliers.get(partnerId)
    if (p) await db.suppliers.update(partnerId, { capital: (p.capital ?? 0) + amount })
    await movement({ date: Date.now(), type: 'capitalIn', amount, partnerName, note: note?.trim() || undefined })
  })
}

/** ورود نقدِ سرمایهٔ ثبت‌شده به صندوق — عدد سرمایه را تغییر نمی‌دهد (هنگام ثبت شریک) */
export async function recordCapitalCash(partnerName: string, amount: number): Promise<void> {
  if (amount <= 0) return
  await movement({ date: Date.now(), type: 'capitalIn', amount, partnerName, note: 'سرمایهٔ اول سال' })
}

export async function addLender(fields: { name: string; phone?: string; note?: string }): Promise<number> {
  const name = fields.name.trim()
  if (!name) throw new Error('نام قرض‌دهنده لازم است')
  return db.transaction('rw', db.suppliers, async () =>
    (await db.suppliers.add({
      name,
      phone: fields.phone?.trim() || undefined,
      note: fields.note?.trim() || undefined,
      balance: 0,
      kind: 'lender'
    })) as number
  )
}

export async function updateLender(lenderId: number, fields: { name: string; phone?: string; note?: string }): Promise<void> {
  const name = fields.name.trim()
  if (!name) throw new Error('نام قرض‌دهنده لازم است')
  return db.transaction('rw', db.suppliers, async () => {
    const lender = await db.suppliers.get(lenderId)
    if (!lender || lender.deleted || lender.kind !== 'lender') throw new Error('قرض‌دهنده یافت نشد')
    await db.suppliers.update(lenderId, {
      name,
      phone: fields.phone?.trim() || undefined,
      note: fields.note?.trim() || undefined
    })
  })
}

export async function deleteLender(lenderId: number): Promise<void> {
  return db.transaction('rw', [db.suppliers, db.payments], async () => {
    const lender = await db.suppliers.get(lenderId)
    if (!lender || lender.deleted) return
    if (lender.kind !== 'lender') throw new Error('این شخص قرض‌دهنده نیست')
    if (lender.balance !== 0) throw new Error('اول قرض این شخص را صفر کنید')
    const hasDocs = await db.payments.filter((p) => !p.deleted && (p.partyId === lenderId || p.lenderId === lenderId)).first()
    if (hasDocs) throw new Error('اول سندهای این شخص را حذف کنید')
    await db.suppliers.update(lenderId, { deleted: true })
  })
}

export type LoanReceiptMode = 'cash' | 'opening'

/**
 * دریافت قرض از یک شخص (قرض‌دهنده) — قسط به قسط.
 * پول وارد صندوق می‌شود و قرض ما به او بالا می‌رود.
 * سند پرداخت با مبلغ منفی ثبت می‌شود تا بین دستگاه‌ها همگام شود — عین قرض قبلی.
 */
export async function addLoan(
  lenderId: number,
  lenderName: string,
  amount: number,
  date = Date.now(),
  note?: string,
  mode: LoanReceiptMode = 'cash'
): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.payments, db.suppliers, db.cashMovements, async () => {
    const l = await db.suppliers.get(lenderId)
    if (!l || l.deleted || l.kind !== 'lender') throw new Error('قرض‌دهنده یافت نشد')
    await db.suppliers.update(lenderId, { balance: l.balance + amount })
    const paymentId = (await db.payments.add({
      date,
      partyType: 'supplier',
      partyId: lenderId,
      partyName: lenderName,
      amount: -amount,
      note:
        mode === 'opening'
          ? note?.trim() ? `قرض قبلی — ${note.trim()}` : 'قرض قبلی — پول قبلاً مصرف شده'
          : note?.trim() ? `قرض گرفته‌شده — ${note.trim()}` : 'قرض گرفته‌شده',
      via: mode,
      cashDelta: mode === 'cash' ? amount : 0
    })) as number
    if (mode === 'cash') await movement({ date, type: 'loanIn', refId: paymentId, amount, note: `قرض از ${lenderName}` })
  })
}

export type LenderCashOutMode = Extract<LenderAction, 'cashRepayment' | 'cashLoan'>
export type LenderGoodsMode = Extract<LenderAction, 'goodsSettlement' | 'goodsCredit'>
export type LenderGoodsLine = Omit<SaleLine, 'unitCost'>

/**
 * پولی که خود قرض‌دهنده می‌گیرد:
 *  - cashRepayment: پرداخت بدهی ما (بیشتر از قرض فعلی نمی‌شود)
 *  - cashLoan: پولی که او از دکان قرض می‌گیرد و می‌تواند حساب را منفی کند
 */
export async function giveCashToLender(
  lenderId: number,
  lenderName: string,
  amount: number,
  date = Date.now(),
  note?: string,
  mode: LenderCashOutMode = 'cashRepayment'
): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.payments, db.suppliers, db.cashMovements, async () => {
    const l = await db.suppliers.get(lenderId)
    if (!l || l.deleted || l.kind !== 'lender') throw new Error('قرض‌دهنده یافت نشد')
    if (mode === 'cashRepayment' && amount > Math.max(0, afn(l.balance))) {
      throw new Error('مبلغ تسویه بیشتر از قرض فعلی است؛ برای مبلغ اضافی «قرض نقدی به قرض‌دهنده» را انتخاب کنید')
    }
    await db.suppliers.update(lenderId, { balance: l.balance - amount })
    const paymentId = (await db.payments.add({
      date,
      partyType: 'supplier',
      partyId: lenderId,
      partyName: l.name || lenderName,
      amount,
      note: note?.trim() || undefined,
      via: 'cash',
      cashDelta: -amount,
      lenderAction: mode
    })) as number
    await movement({
      date,
      type: mode === 'cashRepayment' ? 'loanRepay' : 'lenderCashLoan',
      refId: paymentId,
      amount: -amount,
      note: note?.trim() || (mode === 'cashRepayment' ? `پرداخت قرض به ${l.name}` : `قرض نقدی به ${l.name}`)
    })
  })
}

/** سازگاری با فورم‌ها و بکاپ‌های پیشین: repayLoan همان پرداخت نقدی قرض است. */
export async function repayLoan(lenderId: number, lenderName: string, amount: number, note?: string): Promise<void> {
  return giveCashToLender(lenderId, lenderName, amount, Date.now(), note, 'cashRepayment')
}

/**
 * دادن کفش به قرض‌دهنده با قیمت توافقی. یک Sale موجودی/مفاد را نگه می‌دارد و
 * یک Payment حساب شخص را؛ groupUuid باعث می‌شود حذف و همگام‌سازی همیشه جفت بماند.
 */
export async function giveGoodsToLender(
  lenderId: number,
  lenderName: string,
  lines: LenderGoodsLine[],
  date = Date.now(),
  note?: string,
  mode: LenderGoodsMode = 'goodsSettlement'
): Promise<{ saleId: number; paymentId: number }> {
  if (lines.length === 0) throw new Error('حداقل یک جنس را انتخاب کنید')
  const clean = lines.map((line) => ({ ...line, unitPrice: afn(line.unitPrice) }))
  for (const line of clean) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) throw new Error('تعداد هر جنس باید عدد صحیح و بیشتر از صفر باشد')
    if (line.unitPrice <= 0) throw new Error('قیمت توافقی هر جنس باید بیشتر از صفر باشد')
  }
  const total = afn(clean.reduce((sum, line) => sum + line.qty * line.unitPrice, 0))
  const groupUuid = newUuid()

  return db.transaction('rw', [db.sales, db.payments, db.variants, db.suppliers], async () => {
    const lender = await db.suppliers.get(lenderId)
    if (!lender || lender.deleted || lender.kind !== 'lender') throw new Error('قرض‌دهنده یافت نشد')
    if (mode === 'goodsSettlement' && total > Math.max(0, afn(lender.balance))) {
      throw new Error('ارزش کفشِ تسویه بیشتر از قرض فعلی است؛ برای اضافه «کفش قرضی» را انتخاب کنید')
    }

    const savedLines: SaleLine[] = []
    for (const line of clean) {
      const variant = await db.variants.get(line.variantId)
      if (!variant || variant.deleted) throw new Error('جنس یافت نشد')
      if (variant.stockQty < line.qty) throw new Error(`موجودی کافی نیست: ${line.productName} ${line.size}`)
      await db.variants.update(line.variantId, { stockQty: variant.stockQty - line.qty })
      savedLines.push({ ...line, unitCost: variant.purchasePrice })
    }

    const saleId = (await db.sales.add({
      date,
      customerName: lender.name || lenderName,
      saleType: 'retail',
      lines: savedLines,
      total,
      // این «پرداخت با حساب شخص» است، نه ورود نقد؛ بنابراین movement ساخته نمی‌شود.
      paid: total,
      lenderId,
      lenderName: lender.name || lenderName,
      lenderAction: mode,
      groupUuid
    })) as number
    await db.suppliers.update(lenderId, { balance: lender.balance - total })
    const paymentId = (await db.payments.add({
      date,
      partyType: 'supplier',
      partyId: lenderId,
      partyName: lender.name || lenderName,
      amount: total,
      note: note?.trim() || undefined,
      via: 'goods',
      cashDelta: 0,
      lenderAction: mode,
      groupUuid
    })) as number
    return { saleId, paymentId }
  })
}

/**
 * تبدیل قرض به سرمایهٔ شریک — روزی که قرض‌دهنده شریک می‌شود.
 * قرضش صفر و به همان اندازه سرمایه می‌شود؛ صندوق تغییر نمی‌کند چون پول قبلاً آمده بود.
 * تاریخ شروع سال شراکت همان روز گذاشته می‌شود تا مفادِ پیش از آن مالِ مالک بماند.
 */
export async function convertLoanToCapital(lenderId: number, share: number): Promise<number> {
  return db.transaction('rw', db.payments, db.suppliers, db.settings, async () => {
    const l = await db.suppliers.get(lenderId)
    if (!l) throw new Error('قرض‌دهنده یافت نشد')
    const owed = afn(l.balance)
    if (owed <= 0) throw new Error('قرضی برای تبدیل وجود ندارد')
    // سند صفر شدن قرض — بدون حرکت صندوق
    await db.payments.add({
      date: Date.now(),
      partyType: 'supplier',
      partyId: lenderId,
      partyName: l.name,
      amount: owed,
      note: 'تبدیل قرض به سرمایهٔ شریک',
      cashDelta: 0
    })
    await db.suppliers.update(lenderId, {
      kind: 'partner',
      balance: 0,
      capital: (l.capital ?? 0) + owed,
      share
    })
    await db.settings.put({ key: 'partnershipStart', value: Date.now() })
    return owed
  })
}

/** برداشت/مصرف شخصی شریک از صندوق — با جزئیات؛ در مفاد تجارت حساب نمی‌شود و آخر سال از سهمش کم می‌شود */
export async function addPartnerWithdrawal(partnerName: string, amount: number, note?: string): Promise<void> {
  if (amount <= 0) return
  await movement({ date: Date.now(), type: 'withdrawal', amount: -amount, partnerName, note: note?.trim() || `برداشت ${partnerName}` })
}

const EXPENSE_MOVE: Record<Expense['type'], 'expense' | 'homeExpense' | 'personalExpense' | 'withdrawal'> = {
  business: 'expense',
  home: 'homeExpense',
  personal: 'personalExpense',
  withdrawal: 'withdrawal'
}

/** ثبت مصرف (تجارت/خانه/شخصی) یا برداشت مالک: خروج نقد از صندوق */
export async function addExpense(expense: Expense, partnerName?: string): Promise<number> {
  expense.amount = afn(expense.amount)
  return db.transaction('rw', db.expenses, db.cashMovements, async () => {
    const id = (await db.expenses.add(expense)) as number
    await movement({
      date: expense.date,
      type: EXPENSE_MOVE[expense.type],
      refId: id,
      amount: -expense.amount,
      // مصرف خانه/شخصی و برداشت باید به نام یک شریک ثبت شود، وگرنه آخر سال
      // از سهم هیچ‌کس کم نمی‌شود و بار آن روی همهٔ شرکا می‌افتد
      ...(partnerName ? { partnerName } : {}),
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
  ret.amount = afn(ret.amount)
  ret.lines.forEach((l) => (l.unitPrice = afn(l.unitPrice)))
  return db.transaction('rw', db.returns, db.variants, db.customers, db.adjustments, db.cashMovements, async () => {
    for (const line of ret.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      if (line.unitCost === undefined) line.unitCost = v.purchasePrice
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
    // اول فروش (پول وارد صندوق)، بعد مرجوعی — تا در تبادله صندوق به اشتباه «کم» حساب نشود
    await addSale(sale)
    await addCustomerReturn(ret)
  })
}

/** مرجوعی به تأمین‌کننده: خروج از گدام + کاهش قرض ما */
export async function addSupplierReturn(ret: ReturnDoc): Promise<number> {
  ret.amount = afn(ret.amount)
  ret.lines.forEach((l) => (l.unitPrice = afn(l.unitPrice)))
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
/**
 * ساختن یک سایز نو. موجودی اولیه با سند ثبت می‌شود، نه با نوشتنِ مستقیمِ عدد —
 * تا موبایل دوم همان عدد را بسازد و «کنترل حساب‌ها» راضی بماند.
 */
export async function addVariant(
  data: Omit<Variant, 'id' | 'stockQty'> & { stockQty?: number },
  productName = ''
): Promise<number> {
  return db.transaction('rw', [db.variants, db.adjustments, db.products, db.sales, db.purchases, db.returns], async () => {
    const opening = afn(data.stockQty ?? 0)
    if (opening < 0) throw new Error('موجودی اولیه منفی نمی‌شود')
    const id = (await db.variants.add({ ...data, stockQty: 0 })) as number
    await db.variants.update(id, { sku: makeSku(id, data.size) })
    if (opening !== 0) await setOpeningStock(id, opening, productName)
    return id
  })
}

/**
 * اصلاح قیمت خرید یک سایز — با سند، نه با نوشتنِ مستقیمِ عدد.
 * قیمت از روی اسناد بازسازی می‌شود، پس تغییری که سند ندارد دفعهٔ بعد پاک می‌شود.
 */
export async function setPurchaseCost(variantId: number, cost: number, productName = ''): Promise<void> {
  if (cost < 0) throw new Error('قیمت خرید منفی نمی‌شود')
  return db.transaction('rw', [db.variants, db.adjustments, db.products, db.sales, db.purchases, db.returns], async () => {
    const v = await db.variants.get(variantId)
    if (!v || v.deleted) throw new Error('جنس یافت نشد')
    if (Math.abs(v.purchasePrice - cost) < 0.005) return
    const p = await db.products.get(v.productId)
    await db.adjustments.add({
      date: Date.now(),
      variantId,
      productName: productName || p?.name || '',
      size: v.size,
      color: v.color,
      // تعداد عوض نمی‌شود — این سند فقط قیمت را می‌گوید
      qtyChange: 0,
      reason: 'correction',
      note: 'اصلاح قیمت خرید',
      unitCost: cost
    })
    await applyRebuiltCosts()
  })
}

/**
 * گذاشتن موجودی یک سایز روی عددِ شمرده‌شده — با سند تعدیل، نه با نوشتنِ عدد.
 * همان کاری که «شمارش گدام» می‌کند، ولی برای یک سایز.
 */
export async function setOpeningStock(variantId: number, counted: number, productName = ''): Promise<void> {
  const qty = afn(counted)
  if (qty < 0) throw new Error('موجودی منفی نمی‌شود')
  return db.transaction('rw', [db.variants, db.adjustments, db.products, db.sales, db.purchases, db.returns], async () => {
    const v = await db.variants.get(variantId)
    if (!v || v.deleted) throw new Error('جنس یافت نشد')
    const delta = qty - v.stockQty
    if (delta === 0) return
    const p = await db.products.get(v.productId)
    await db.variants.update(variantId, {
      stockQty: qty,
      ...(delta > 0 ? { lastPurchaseAt: Date.now() } : {})
    })
    await db.adjustments.add({
      date: Date.now(),
      variantId,
      productName: productName || p?.name || '',
      size: v.size,
      color: v.color,
      qtyChange: delta,
      reason: 'correction',
      note: v.stockQty === 0 && delta > 0 ? 'موجودی اولیه' : 'تصحیح از فورم گدام',
      // قیمت با سند می‌رود تا بازسازیِ قیمت هم به همان عدد برسد
      ...(delta > 0 ? { unitCost: v.purchasePrice } : {})
    })
    await applyRebuiltCosts()
  })
}

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

export async function cashBalance(box?: string): Promise<number> {
  const all = await db.cashMovements.filter((m) => !m.deleted && (!box || boxOf(m) === box)).toArray()
  return all.reduce((s, m) => s + m.amount, 0)
}

export type ShortageAction =
  | { mode: 'adjust' }
  | { mode: 'expense' }
  | { mode: 'debt'; customerId: number; customerName: string }

/**
 * تصفیه صندوق: مقایسهٔ شمارش با موجودی مورد انتظار.
 * برای کمبود سه راه: مصرف «کسر صندوق» (از مفاد کم می‌شود)، قرض شخص مسئول، یا فقط تنظیم.
 */
export async function reconcile(counted: number, note?: string, shortage?: ShortageAction, box = SHOP_BOX): Promise<number> {
  counted = afn(counted)
  return db.transaction(
    'rw',
    [db.cashMovements, db.reconciliations, db.expenses, db.expenseCategories, db.customers, db.payments],
    async () => {
      const all = await db.cashMovements.filter((m) => !m.deleted && boxOf(m) === box).toArray()
      const expected = all.reduce((s, m) => s + m.amount, 0)
      const difference = counted - expected
      if (difference < 0 && shortage?.mode === 'expense') {
        const cat = await db.expenseCategories.filter((c) => !c.deleted && c.name === 'کسر صندوق').first()
        const catId = cat?.id ?? ((await db.expenseCategories.add({ name: 'کسر صندوق' })) as number)
        await db.expenses.add({ date: Date.now(), categoryId: catId, categoryName: 'کسر صندوق', amount: -difference, note, type: 'business' })
        await movement({ date: Date.now(), type: 'expense', amount: difference, box, note: `کسر صندوق — ${box}` })
      } else if (difference < 0 && shortage?.mode === 'debt') {
        await movement({ date: Date.now(), type: 'openingSet', amount: difference, box, note: `کسر صندوق — به حساب ${shortage.customerName}` })
        const c = await db.customers.get(shortage.customerId)
        if (c) await db.customers.update(shortage.customerId, { balance: c.balance - difference })
        await db.payments.add({
          date: Date.now(),
          partyType: 'customer',
          partyId: shortage.customerId,
          partyName: shortage.customerName,
          amount: difference,
          note: 'کسر صندوق'
        })
      } else if (difference !== 0) {
        await movement({ date: Date.now(), type: 'openingSet', amount: difference, box, note: `تصفیه ${box}` })
      }
      return (await db.reconciliations.add({ date: Date.now(), expected, counted, difference, note: note?.trim() ? `${box} — ${note.trim()}` : box })) as number
    }
  )
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
  'candidates',
  'settings'
] as const

// Cloud identity belongs to the account currently signed in on this device.
// A backup may come from another owner/shop, so these rows must never replace it.
const CLOUD_IDENTITY_SETTINGS = new Set(['supaUrl', 'supaKey', 'cachedProfile'])

export async function exportBackup(): Promise<string> {
  const data: Record<string, unknown[]> = {}
  for (const t of TABLES) {
    const rows = await db.table(t).toArray()
    data[t] =
      t === 'settings'
        ? rows.filter((row) => !CLOUD_IDENTITY_SETTINGS.has(String((row as { key?: unknown }).key)))
        : rows
  }
  return JSON.stringify({ app: 'shoeErp', version: 3, exportedAt: Date.now(), data })
}

export type BackupImportMode = 'merge' | 'replace'

export async function importBackup(json: string, mode: BackupImportMode = 'merge'): Promise<void> {
  const parsed = JSON.parse(json)
  if (parsed?.app !== 'shoeErp' || !parsed.data) throw new Error('فایل بکاپ معتبر نیست')
  const restoreTimestamp = Date.now()

  const sync = await import('./sync')
  await sync.pauseSyncForRestore()

  try {
    // Keep the current Supabase project/profile even when the backup came from
    // another owner. Cloud ownership is never transferred by a JSON backup.
    const currentCloudIdentity = (
      await Promise.all([...CLOUD_IDENTITY_SETTINGS].map((key) => db.settings.get(key)))
    ).filter((row): row is { key: string; value: unknown } => Boolean(row))

    await db.transaction('rw', [...TABLES.map((t) => db.table(t)), db.syncState], async () => {
      for (const t of TABLES) {
        await db.table(t).clear()
        const rows = Array.isArray(parsed.data[t]) ? parsed.data[t] : []
        const restorableRows =
          t === 'settings'
            ? rows.filter((row: { key?: unknown }) => !CLOUD_IDENTITY_SETTINGS.has(String(row.key)))
            : rows
        if (restorableRows.length) await db.table(t).bulkAdd(restorableRows)
      }
      if (currentCloudIdentity.length) await db.settings.bulkPut(currentCloudIdentity)

      await db.syncState.clear()
      if (mode === 'merge') {
        await db.syncState.put({ key: 'restorePushMode', value: 'merge' })
      } else {
        // Ordinary sync must not upload this locally imported snapshot until
        // the staging batch has been verified and atomically activated.
        await db.syncState.put({ key: 'restorePending', value: true })
      }

      // Backups made before cloud sync may not contain UUID/timestamp fields.
      // Without these fields the records appear locally but pushTable skips
      // them, which makes other devices receive only part (or none) of the
      // restored backup. Normalize every synced row before the first push.
      for (const t of SYNC_TABLES) {
        await db.table(t).toCollection().modify((row) => {
          if (!row.uuid) row.uuid = newUuid()
          row.localUpdatedAt = restoreTimestamp
        })
      }

      // بکاپ نسخهٔ ۱: کتگوری‌های پیش‌فرض و SKU را بساز
      if (!parsed.data.expenseCategories?.length) {
        for (const name of DEFAULT_EXPENSE_CATEGORIES) {
          await db.expenseCategories.add({ name, isDefault: true })
        }
      }
      const variants = await db.variants.toArray()
      for (const v of variants) {
        if (!v.sku) await db.variants.update(v.id!, { sku: makeSku(v.id!, v.size) })
      }
    })

    if (mode === 'replace') {
      // The cloud keeps serving its previous complete copy while every table
      // is uploaded into staging. One database transaction verifies the row
      // counts, swaps all tables, and advances the generation.
      await sync.replaceCloudWithLocalSnapshot()
    }

    // Safe merge uses insert-only upserts; replace uses the fresh generation.
    await sync.syncNow(true)
  } finally {
    sync.startSync()
  }
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

const KEEP_SETTINGS = ['supaUrl', 'supaKey', 'pinHash', 'cachedProfile', 'expenseReminderOn', 'expenseReminderHour', 'partnershipStart']

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
