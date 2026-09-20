import { accessFlags, db, SYNC_TABLES, type Adjustment, type Payment, type Sale } from '../db'
import { applyRebuiltCosts } from './costing'
import { effectsOf, type DocTable } from './effects'
import { boxOf, postCashMovement } from './financialPosting'
import { customerGoodsReceiptFeatureEnabled, loadCustomerGoodsReceipt } from './customerGoodsReceiptState'
import { receiptCanonical, receiptInteger, receiptStableUuid, receiptTotals, RECEIPT_UUID, type CreateCustomerGoodsReceiptInput, type CustomerGoodsReceiptMeta, type CustomerGoodsReceiptSnapshot, type CustomerGoodsReceiptState, type CustomerGoodsReceiptPreview } from './customerGoodsReceiptTypes'
export { customerGoodsReceiptFeatureEnabled, loadCustomerGoodsReceipt }
export type { CreateCustomerGoodsReceiptInput, CustomerGoodsReceiptState } from './customerGoodsReceiptTypes'

const tables = () => [...SYNC_TABLES.map(t => db.table(t)), db.settings, db.syncState]
async function eligibility(): Promise<void> {
  if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
  if (!await customerGoodsReceiptFeatureEnabled()) throw new Error('ابتدا سازگاری نسخهٔ همهٔ دستگاه‌ها را تأیید کنید.')
}
async function normalized(input: CreateCustomerGoodsReceiptInput): Promise<CustomerGoodsReceiptSnapshot> {
  if (!input || !RECEIPT_UUID.test(input.receiptUuid)) throw new Error('شناسهٔ دریافت معتبر نیست.')
  receiptInteger(input.date, true)
  if (input.date > 8_640_000_000_000_000) throw new Error('تاریخ معتبر نیست.')
  receiptInteger(input.customerId, true)
  if (input.note !== undefined && typeof input.note !== 'string') throw new Error('یادداشت معتبر نیست.')
  const customer = await db.customers.get(input.customerId)
  if (!customer || customer.deleted || !customer.uuid || !RECEIPT_UUID.test(customer.uuid)) throw new Error('مشتری فعال یافت نشد.')
  const snapshot: CustomerGoodsReceiptSnapshot = { receiptUuid: input.receiptUuid.toLowerCase(), date: input.date, customerUuid: customer.uuid, destination: input.destination, note: input.note?.trim() || undefined, lines: [] }
  if (!Array.isArray(input.lines)) throw new Error('جنس دریافت‌شده را وارد کنید.')
  for (const line of input.lines) {
    const { variantId, ...rest } = line
    let selectedVariantUuid: string | undefined
    if (variantId !== undefined) {
      if (input.destination !== 'warehouse') throw new Error('فروش بعدی به گدام پیوند ندارد.')
      receiptInteger(variantId, true)
      const variant = await db.variants.get(variantId)
      const product = variant && await db.products.get(variant.productId)
      if (!variant || variant.deleted || !variant.uuid || !RECEIPT_UUID.test(variant.uuid) || !product || product.deleted) throw new Error('جنس فعال یافت نشد.')
      if (product.name !== line.productName?.trim() || variant.size !== line.size?.trim() || variant.color !== line.color?.trim()) throw new Error('مشخصات جنس انتخاب‌شده تغییر نکند.')
      selectedVariantUuid = variant.uuid
    }
    snapshot.lines.push({ ...rest, lineUuid: typeof line.lineUuid === 'string' ? line.lineUuid.toLowerCase() : line.lineUuid,
      productName: typeof line.productName === 'string' ? line.productName.trim() : line.productName,
      size: typeof line.size === 'string' ? line.size.trim() : line.size, color: typeof line.color === 'string' ? line.color.trim() : line.color, selectedVariantUuid })
  }
  snapshot.lines.sort((a, b) => String(a.lineUuid).localeCompare(String(b.lineUuid)))
  const selected = snapshot.lines.flatMap(l => l.selectedVariantUuid ? [l.selectedVariantUuid] : [])
  if (new Set(selected).size !== selected.length) throw new Error('هر سایز گدام را در یک سطر وارد کنید.')
  if (input.onward) {
    receiptInteger(input.onward.buyerId, true)
    if (input.onward.box !== undefined && typeof input.onward.box !== 'string') throw new Error('صندوق معتبر نیست.')
    const buyer = await db.customers.get(input.onward.buyerId)
    if (!buyer || buyer.deleted || !buyer.uuid || !RECEIPT_UUID.test(buyer.uuid) || buyer.uuid === customer.uuid) throw new Error('خریدار فعال و جدا از مشتری را انتخاب کنید.')
    snapshot.onward = { buyerUuid: buyer.uuid, paid: input.onward.paid, box: boxOf(input.onward) }
  }
  receiptTotals(snapshot)
  return snapshot
}
async function apply(table: DocTable, doc: unknown, sign = 1): Promise<void> {
  for (const effect of effectsOf(table, doc)) {
    const row = await db.table(effect.table).get(effect.id!)
    if (!row || row.deleted) throw new Error('طرف حساب یا جنس یافت نشد.')
    const value = (row[effect.field] ?? 0) + sign * effect.delta
    if (!Number.isSafeInteger(value) || (effect.field === 'stockQty' && value < 0)) throw new Error('موجودی یا حساب از حد مجاز خارج است.')
    await db.table(effect.table).update(effect.id!, { [effect.field]: value })
  }
}
async function insert(snapshot: CustomerGoodsReceiptSnapshot, correctionOfUuid?: string, reason?: string): Promise<void> {
  const totals = receiptTotals(snapshot), receiptUuid = snapshot.receiptUuid
  const customer = await db.customers.where('uuid').equals(snapshot.customerUuid).first()
  if (!customer || customer.deleted || customer.balance < totals.value) throw new Error('ارزش جنس از طلب فعلی مشتری بیشتر است.')
  const meta: CustomerGoodsReceiptMeta = { schema: 1, receiptUuid, revision: receiptStableUuid(`goods-revision:${receiptUuid}`), status: 'active', createdAt: Date.now(), creationFingerprint: receiptCanonical(snapshot), snapshot, members: [], correctionOfUuid, reason }
  const child = { receiptUuid, revision: meta.revision, status: 'active' as const }
  const reserved: Array<[string, string]> = [['payments', receiptUuid]]
  for (const line of snapshot.lines) if (snapshot.destination === 'warehouse') {
    reserved.push(['adjustments', receiptStableUuid(`goods-adjustment:${receiptUuid}:${line.lineUuid}`)])
    if (!line.selectedVariantUuid) reserved.push(['products', receiptStableUuid(`goods-product:${receiptUuid}:${line.lineUuid}`)], ['variants', receiptStableUuid(`goods-variant:${receiptUuid}:${line.lineUuid}`)])
  }
  if (snapshot.destination === 'onward') {
    reserved.push(['sales', receiptStableUuid(`goods-sale:${receiptUuid}`)])
    if (totals.cash) reserved.push(['cashMovements', receiptStableUuid(`goods-cash:${receiptUuid}`)])
  }
  for (const [table, uuid] of reserved) if (await db.table(table).where('uuid').equals(uuid).first()) throw new Error('شناسهٔ یکی از سندهای دریافت قبلاً استفاده شده است.')
  if (snapshot.destination === 'warehouse') {
    for (const line of snapshot.lines) {
      let variant = line.selectedVariantUuid ? await db.variants.where('uuid').equals(line.selectedVariantUuid).first() : undefined
      if (variant) {
        const id = variant.id!, later = (row: { date: number; deleted?: boolean }) => !row.deleted && row.date >= snapshot.date
        const [sales, purchases, adjustments, returns] = await Promise.all([db.sales.toArray(), db.purchases.toArray(), db.adjustments.toArray(), db.returns.toArray()])
        if (sales.some(s => later(s) && s.lines.some(l => l.variantId === id)) || purchases.some(p => later({ ...p, date: p.receivedAt ?? p.date }) && p.lines.some(l => l.variantId === id)) || adjustments.some(a => later(a) && a.variantId === id) || returns.some(r => later(r) && r.lines.some(l => l.variantId === id))) throw new Error('در این تاریخ یا پس از آن برای جنس انتخاب‌شده معامله ثبت شده است؛ دریافت با تاریخ قدیمی قیمت فروش‌های ثبت‌شده را تغییر می‌دهد.')
      }
      if (!variant) {
        const productId = await db.products.add({ uuid: receiptStableUuid(`goods-product:${receiptUuid}:${line.lineUuid}`), name: line.productName, photo: line.photo, createdAt: meta.createdAt }) as number
        const variantId = await db.variants.add({ uuid: receiptStableUuid(`goods-variant:${receiptUuid}:${line.lineUuid}`), productId, size: line.size, color: line.color, stockQty: 0, purchasePrice: 0, retailPrice: 0, wholesalePrice: 0, lowStock: 0 }) as number
        variant = (await db.variants.get(variantId))!
      }
      const uuid = receiptStableUuid(`goods-adjustment:${receiptUuid}:${line.lineUuid}`)
      const adjustment: Adjustment = { uuid, date: snapshot.date, variantId: variant.id!, productName: line.productName, size: line.size, color: line.color, qtyChange: line.qty, unitCost: line.unitCost, reason: 'correction', goodsReceiptChild: child, note: snapshot.note }
      meta.members.push({ table: 'adjustments', uuid, lineUuid: line.lineUuid, variantUuid: variant.uuid, priorUnitCost: variant.purchasePrice })
      await db.adjustments.add(adjustment)
      await apply('adjustments', adjustment)
    }
  } else {
    const buyer = await db.customers.where('uuid').equals(snapshot.onward!.buyerUuid).first()
    if (!buyer || buyer.deleted) throw new Error('خریدار فعال یافت نشد.')
    const uuid = receiptStableUuid(`goods-sale:${receiptUuid}`)
    const sale: Sale = { uuid, date: snapshot.date, customerId: buyer.id, customerName: buyer.name, saleType: 'wholesale', lines: [], goodsReceiptLines: snapshot.lines.map(({ selectedVariantUuid: _v, ...line }) => ({ ...line, unitPrice: line.unitPrice! })), goodsReceiptChild: child, total: totals.sale, paid: totals.cash, discount: 0 }
    const saleId = await db.sales.add(sale) as number
    meta.members.push({ table: 'sales', uuid })
    await apply('sales', sale)
    if (totals.cash) {
      const cash = await db.cashMovements.filter(c => !c.deleted && boxOf(c) === snapshot.onward!.box).toArray()
      const balance = cash.reduce((sum, c) => sum + c.amount, 0)
      if (!Number.isSafeInteger(balance) || !Number.isSafeInteger(balance + totals.cash)) throw new Error('موجودی صندوق از حد مجاز خارج است.')
      const cashUuid = receiptStableUuid(`goods-cash:${receiptUuid}`)
      meta.members.push({ table: 'cashMovements', uuid: cashUuid })
      await postCashMovement({ uuid: cashUuid, date: snapshot.date, type: 'sale', refId: saleId, amount: totals.cash, box: snapshot.onward!.box, goodsReceiptChild: child })
    }
  }
  const payment: Payment = { uuid: receiptUuid, date: snapshot.date, partyType: 'customer', partyId: customer.id!, partyName: customer.name, amount: totals.value, via: 'goods', cashDelta: 0, note: snapshot.note, goodsReceipt: meta, correctionOfUuid, correctionReason: reason }
  await db.payments.add(payment)
  await apply('payments', payment)
  await applyRebuiltCosts()
}
export async function createCustomerGoodsReceipt(input: CreateCustomerGoodsReceiptInput): Promise<CustomerGoodsReceiptState> {
  return db.transaction('rw', tables(), async () => {
    await eligibility()
    const snapshot = await normalized(input)
    const current = await loadCustomerGoodsReceipt(snapshot.receiptUuid)
    if (current.payment) {
      if (!['ready', 'cancelled'].includes(current.status) || current.payment.goodsReceipt?.creationFingerprint !== receiptCanonical(snapshot)) throw new Error('این شناسه با معلومات متفاوت یا ناقص قبلاً ثبت شده است.')
      return current
    }
    if (current.adjustments.length || current.sale || current.cashMovements.length || await db.payments.where('uuid').equals(snapshot.receiptUuid).first()) throw new Error('شناسهٔ دریافت قبلاً استفاده شده است.')
    await insert(snapshot)
    const result = await loadCustomerGoodsReceipt(snapshot.receiptUuid)
    if (result.status !== 'ready') throw new Error(result.issues.join('\n'))
    return result
  })
}

async function dependencies(state: CustomerGoodsReceiptState): Promise<string[]> {
  const meta = state.payment?.goodsReceipt
  if (!meta) return []
  const [sales, purchases, adjustments, returns, payments, cash] = await Promise.all([db.sales.toArray(), db.purchases.toArray(), db.adjustments.toArray(), db.returns.toArray(), db.payments.toArray(), db.cashMovements.toArray()])
  const family = new Set([state.receiptUuid])
  let previous = meta.correctionOfUuid
  while (previous && !family.has(previous)) { family.add(previous); previous = payments.find(p => p.uuid === previous)?.goodsReceipt?.correctionOfUuid }
  const later = (row: { date: number; localUpdatedAt?: number }) => row.date >= meta.snapshot.date || (row.localUpdatedAt ?? 0) >= meta.createdAt
  if (meta.snapshot.destination === 'warehouse') {
    const ids = new Set(state.adjustments.map(a => a.variantId))
    if (sales.some(s => later(s) && s.lines.some(l => ids.has(l.variantId))) || purchases.some(p => later({ ...p, date: p.receivedAt ?? p.date }) && p.lines.some(l => ids.has(l.variantId))) || returns.some(r => later(r) && r.lines.some(l => ids.has(l.variantId))) || adjustments.some(a => !family.has(a.goodsReceiptChild?.receiptUuid ?? '') && later(a) && ids.has(a.variantId))) {
      return ['پس از دریافت، روی این جنس معامله یا تغییر دیگری ثبت شده است؛ حتی با جبران موجودی، اصلاح یا ابطال خودکار مجاز نیست.']
    }
  } else if (state.sale) {
    const buyer = state.sale.customerId
    if (sales.some(s => s.customerId === buyer && !family.has(s.goodsReceiptChild?.receiptUuid ?? '') && later(s)) || payments.some(p => p.partyType === 'customer' && p.partyId === buyer && !family.has(p.goodsReceipt?.receiptUuid ?? '') && later(p)) || returns.some(r => r.kind === 'customer' && r.partyId === buyer && later(r))) return ['پس از فروش بعدی، معامله یا وصول دیگری برای خریدار ثبت شده است؛ حساب بعدی او خودکار تغییر نمی‌کند.']
    const balance = cash.filter(c => !c.deleted && boxOf(c) === meta.snapshot.onward?.box).reduce((n, c) => n + c.amount, 0)
    if (!Number.isSafeInteger(balance) || balance < state.totals.cash) return ['نقد فروش بعدی مصرف شده است؛ موجودی صندوق برای ابطال کافی نیست.']
  }
  return []
}
function stableCorrection(state: CustomerGoodsReceiptState, next: CustomerGoodsReceiptSnapshot): void {
  const old = state.payment!.goodsReceipt!.snapshot
  if (next.receiptUuid === old.receiptUuid || next.date !== old.date || next.customerUuid !== old.customerUuid || next.destination !== old.destination || next.onward?.buyerUuid !== old.onward?.buyerUuid || next.onward?.box !== old.onward?.box) throw new Error('اصلاح باید شناسهٔ تازه داشته باشد؛ تاریخ، مشتری، مقصد، خریدار و صندوق تغییر نمی‌کند. برای تغییر هویت، دریافت را باطل و جداگانه ثبت کنید.')
}
async function preview(receiptUuid: string, input?: CreateCustomerGoodsReceiptInput): Promise<CustomerGoodsReceiptPreview> {
  const state = await loadCustomerGoodsReceipt(receiptUuid)
  const reasons = [...state.writeBlockReasons, ...await dependencies(state)]
  let next = { value: 0, pairs: 0, cash: 0, buyerDebt: 0, profit: 0 }
  if (input && state.payment) {
    try {
      const snapshot = await normalized(input)
      stableCorrection(state, snapshot)
      next = receiptTotals(snapshot)
      const customer = await db.customers.get(state.payment.partyId)
      if (!customer || next.value > customer.balance + state.totals.value) throw new Error('ارزش جایگزین از طلب مشتری بیشتر است.')
      if (await db.payments.where('uuid').equals(snapshot.receiptUuid).first()) throw new Error('شناسهٔ جایگزین قبلاً استفاده شده است.')
    } catch (e) { reasons.push(e instanceof Error ? e.message : 'اصلاح معتبر نیست.') }
  }
  return { state, token: state.token, allowed: reasons.length === 0, writeBlockReasons: reasons,
    net: { sourceDebt: state.totals.value - next.value, stock: state.payment?.goodsReceipt?.snapshot.destination === 'warehouse' ? next.pairs - state.totals.pairs : 0, cash: next.cash - state.totals.cash, buyerDebt: next.buyerDebt - state.totals.buyerDebt, profit: next.profit - state.totals.profit } }
}
export async function previewCustomerGoodsReceiptCorrection(receiptUuid: string, input: CreateCustomerGoodsReceiptInput): Promise<CustomerGoodsReceiptPreview> {
  return db.transaction('r', tables(), () => preview(receiptUuid, input))
}
export async function previewCustomerGoodsReceiptCancellation(receiptUuid: string): Promise<CustomerGoodsReceiptPreview> {
  return db.transaction('r', tables(), () => preview(receiptUuid))
}
async function reverse(state: CustomerGoodsReceiptState, token: string, reason: string, successor?: string): Promise<void> {
  const payment = state.payment!, meta = payment.goodsReceipt!, now = Date.now()
  await apply('payments', payment, -1)
  for (const a of state.adjustments) {
    await apply('adjustments', a, -1)
    const member = meta.members.find(m => m.uuid === a.uuid)!
    await db.variants.update(a.variantId, { purchasePrice: member.priorUnitCost ?? 0 })
    await db.adjustments.update(a.id!, { deleted: true, goodsReceiptChild: { ...a.goodsReceiptChild!, status: 'cancelled' } })
  }
  if (state.sale) {
    await apply('sales', state.sale, -1)
    await db.sales.update(state.sale.id!, { deleted: true, cancelledAt: now, cancelledReason: reason, goodsReceiptChild: { ...state.sale.goodsReceiptChild!, status: 'cancelled' } })
  }
  for (const cash of state.cashMovements) await db.cashMovements.update(cash.id!, { deleted: true, cancelledAt: now, cancelledReason: reason, goodsReceiptChild: { ...cash.goodsReceiptChild!, status: 'cancelled' } })
  await db.payments.update(payment.id!, { deleted: true, cancelledAt: now, cancelledReason: reason, correctedByUuid: successor,
    goodsReceipt: { ...meta, status: 'cancelled', cancelledAt: now, reason, mutationToken: token, correctedByUuid: successor } })
  await applyRebuiltCosts()
}
export async function correctCustomerGoodsReceipt(receiptUuid: string, input: CreateCustomerGoodsReceiptInput, expectedToken: string, reason: string): Promise<CustomerGoodsReceiptState> {
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('دلیل اصلاح را بنویسید.')
  return db.transaction('rw', tables(), async () => {
    await eligibility()
    const state = await loadCustomerGoodsReceipt(receiptUuid), snapshot = await normalized(input)
    const meta = state.payment?.goodsReceipt
    if (state.status === 'cancelled' && meta?.correctedByUuid === snapshot.receiptUuid) {
      const successor = await loadCustomerGoodsReceipt(snapshot.receiptUuid)
      if (!['ready', 'cancelled'].includes(successor.status) || successor.payment?.goodsReceipt?.creationFingerprint !== receiptCanonical(snapshot) || meta.mutationToken !== expectedToken || meta.reason !== reason.trim()) throw new Error('درخواست تکراری اصلاح با سند قبلی فرق دارد.')
      return successor
    }
    const check = await preview(receiptUuid, input)
    if (!check.allowed) throw new Error(check.writeBlockReasons.join('\n'))
    if (check.token !== expectedToken) throw new Error('اطلاعات تغییر کرده است؛ پیش‌نمایش تازه بگیرید.')
    await reverse(state, expectedToken, reason.trim(), snapshot.receiptUuid)
    await insert(snapshot, state.receiptUuid, reason.trim())
    const result = await loadCustomerGoodsReceipt(snapshot.receiptUuid)
    if (result.status !== 'ready') throw new Error(result.issues.join('\n'))
    return result
  })
}
export async function cancelCustomerGoodsReceipt(receiptUuid: string, expectedToken: string, reason: string): Promise<CustomerGoodsReceiptState> {
  if (typeof reason !== 'string' || !reason.trim()) throw new Error('دلیل ابطال را بنویسید.')
  return db.transaction('rw', tables(), async () => {
    await eligibility()
    const state = await loadCustomerGoodsReceipt(receiptUuid), meta = state.payment?.goodsReceipt
    if (state.status === 'cancelled' && !meta?.correctedByUuid) {
      if (meta?.mutationToken !== expectedToken || meta.reason !== reason.trim()) throw new Error('درخواست تکراری ابطال فرق دارد.')
      return state
    }
    const check = await preview(receiptUuid)
    if (!check.allowed) throw new Error(check.writeBlockReasons.join('\n'))
    if (check.token !== expectedToken) throw new Error('اطلاعات تغییر کرده است؛ پیش‌نمایش تازه بگیرید.')
    await reverse(state, expectedToken, reason.trim())
    return loadCustomerGoodsReceipt(receiptUuid)
  })
}
