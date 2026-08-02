import { db, makeSku, landingUnpaidOf, type Sale, type Purchase, type Payment, type Expense, type Adjustment, type ReturnDoc, type CashMovement } from '../db'

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
    // پول در همان جایی برمی‌گردد که آمده بود
    const orig = await db.cashMovements.filter((m) => !m.deleted && m.type === 'sale' && m.refId === saleId).first()
    // حذفِ اصلاحی است — حتی اگر پول کم شود باید ثبت گردد
    await movement(
      { date: Date.now(), type: 'sale', refId: saleId, amount: -sale.paid, box: orig ? boxOf(orig) : SHOP_BOX, note: 'حذف فروش' },
      { allowNegative: true }
    )
    await db.sales.update(saleId, { deleted: true })
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
  return { paid: sale.paid, box, before, after: before - sale.paid }
}

/** میانگین وزنی قیمت خرید — تا موجودی قدیم با قیمت نو تبدیل نشود */
function weightedCost(oldQty: number, oldCost: number, addQty: number, addCost: number): number {
  const total = oldQty + addQty
  if (total <= 0) return addCost
  if (oldQty <= 0) return addCost
  return (oldQty * oldCost + addQty * addCost) / total
}

/** قیمت تمام‌شدهٔ هر جوړه = قیمت خرید + سهم مصارف رسیدن (تقسیم مساوی) */
export function landedUnitCost(purchase: Purchase, unitCost: number): number {
  const landing = purchase.landingCost ?? 0
  const totalPairs = purchase.lines.reduce((s, l) => s + l.qty, 0)
  if (landing <= 0 || totalPairs <= 0) return unitCost
  return unitCost + landing / totalPairs
}

/** ثبت خرید: افزایش گدام (به قیمت تمام‌شده) + قرض ما + خروج نقد + مصارف رسیدن */
export async function addPurchase(purchase: Purchase): Promise<number> {
  purchase.total = afn(purchase.total)
  purchase.paid = afn(purchase.paid)
  if (purchase.sarrafAmount !== undefined) purchase.sarrafAmount = afn(purchase.sarrafAmount)
  return db.transaction('rw', db.purchases, db.variants, db.suppliers, db.cashMovements, async () => {
    for (const line of purchase.lines) {
      const v = await db.variants.get(line.variantId)
      if (!v) throw new Error('جنس یافت نشد')
      // جنس «در راه» تا وقت رسیدن به گدام اضافه نمی‌شود
      if (purchase.received !== false) {
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
  return db.transaction('rw', db.purchases, db.variants, db.suppliers, db.cashMovements, async () => {
    const list = (await db.purchases.bulkGet(purchaseIds)).filter((p): p is Purchase => Boolean(p) && !p!.deleted)
    if (!list.length) throw new Error('خریدی یافت نشد')
    const pairsOf = (p: Purchase) => p.lines.reduce((a, l) => a + l.qty, 0)
    const totalPairs = list.reduce((s, p) => s + pairsOf(p), 0)
    if (totalPairs <= 0) throw new Error('تعداد جوړه صفر است')
    // سهم هر خرید به افغانی صحیح — جمع سهم‌ها دقیقاً برابر مبلغ کل می‌شود
    const shares = allocate(amount, list.map(pairsOf))

    // مصارف رسیدن فقط روی جوړه‌های همین حمل می‌نشیند (میانگین وزنی با بقیهٔ موجودی)
    for (const [idx, p] of list.entries()) {
      const share = shares[idx]
      const perPair = share / pairsOf(p)
      for (const line of p.lines) {
        const v = await db.variants.get(line.variantId)
        if (v) {
          const rest = Math.max(0, v.stockQty - line.qty)
          const newCost = v.stockQty > 0 ? (rest * v.purchasePrice + line.qty * (v.purchasePrice + perPair)) / v.stockQty : v.purchasePrice + perPair
          await db.variants.update(line.variantId, { purchasePrice: newCost })
        }
      }
      const unpaidBefore = p.landingUnpaid ?? (p.landingPaid === false ? (p.landingCost ?? 0) : 0)
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
  return db.transaction('rw', db.purchases, db.variants, db.adjustments, async () => {
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
    await db.purchases.update(purchaseId, { received: true })
  })
}

/** ثبت پرداخت/دریافت: کاهش قرض طرف حساب + حرکت صندوق */
export async function addPayment(payment: Payment): Promise<number> {
  payment.amount = afn(payment.amount)
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

/**
 * قرض قبلی (پیش از استفاده از اپ): فقط بیلانس طرف بالا می‌رود.
 * سند پرداخت با مبلغ منفی ثبت می‌شود تا بین دستگاه‌ها همگام شود؛
 * نه فروش است، نه در مفاد می‌آید و نه صندوق را تغییر می‌دهد.
 */
export async function addOpeningDebt(
  partyType: 'customer' | 'supplier',
  partyId: number,
  partyName: string,
  amount: number,
  note?: string
): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.payments, db.customers, db.suppliers, async () => {
    const table = partyType === 'customer' ? db.customers : db.suppliers
    const row = await table.get(partyId)
    if (!row) throw new Error('طرف حساب یافت نشد')
    await table.update(partyId, { balance: row.balance + amount })
    await db.payments.add({
      date: Date.now(),
      partyType,
      partyId,
      partyName,
      amount: -amount,
      note: note?.trim() ? `قرض قبلی — ${note.trim()}` : 'قرض قبلی'
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

/**
 * دریافت قرض از یک شخص (قرض‌دهنده) — قسط به قسط.
 * پول وارد صندوق می‌شود و قرض ما به او بالا می‌رود.
 * سند پرداخت با مبلغ منفی ثبت می‌شود تا بین دستگاه‌ها همگام شود — عین قرض قبلی.
 */
export async function addLoan(lenderId: number, lenderName: string, amount: number, date = Date.now(), note?: string): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.payments, db.suppliers, db.cashMovements, async () => {
    const l = await db.suppliers.get(lenderId)
    if (!l) throw new Error('قرض‌دهنده یافت نشد')
    await db.suppliers.update(lenderId, { balance: l.balance + amount })
    await db.payments.add({
      date,
      partyType: 'supplier',
      partyId: lenderId,
      partyName: lenderName,
      amount: -amount,
      note: note?.trim() ? `قرض گرفته‌شده — ${note.trim()}` : 'قرض گرفته‌شده'
    })
    await movement({ date, type: 'loanIn', amount, note: `قرض از ${lenderName}` })
  })
}

/** پرداخت قرض به قرض‌دهنده — نقد از صندوق */
export async function repayLoan(lenderId: number, lenderName: string, amount: number, note?: string): Promise<void> {
  amount = afn(amount)
  if (amount <= 0) return
  return db.transaction('rw', db.payments, db.suppliers, db.cashMovements, async () => {
    const l = await db.suppliers.get(lenderId)
    if (!l) throw new Error('قرض‌دهنده یافت نشد')
    await db.suppliers.update(lenderId, { balance: l.balance - amount })
    await db.payments.add({
      date: Date.now(),
      partyType: 'supplier',
      partyId: lenderId,
      partyName: lenderName,
      amount,
      note: note?.trim() || 'پرداخت قرض'
    })
    await movement({ date: Date.now(), type: 'loanRepay', amount: -amount, note: `پرداخت قرض به ${lenderName}` })
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
      note: 'تبدیل قرض به سرمایهٔ شریک'
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
