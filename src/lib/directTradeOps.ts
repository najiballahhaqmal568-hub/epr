import { accessFlags, db, SYNC_TABLES, type Payment, type Purchase, type Sale } from '../db'
import { effectsOf } from './effects'
import { directTotals, validateDirectPayments } from './directTradeMath'
import { assertDirectWriteReady, directFeatureEnabled, loadDirectTrade } from './directTradeState'
import type { DirectLine, DirectPaymentInput } from './directTradeTypes'
import { boxOf, postCashMovement } from './financialPosting'
import { addSaleShipping, type SaleShippingInput } from './ops'

export interface CreateDirectTradeInput {
  tradeUuid: string
  date: number
  customerId: number
  supplierId: number
  lines: DirectLine[]
  payments: DirectPaymentInput[]
  shipping?: SaleShippingInput
}
export interface DirectTradeResult { tradeUuid: string; saleId: number; purchaseId: number }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_DATE = 8_640_000_000_000_000

function validUuid(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} معتبر نیست.`)
}
function validDate(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0 || (value as number) > MAX_DATE) throw new Error('تاریخ درست را وارد کنید')
}
function validateInputScalars(input: CreateDirectTradeInput): void {
  if (!Number.isSafeInteger(input.customerId) || input.customerId <= 0 || !Number.isSafeInteger(input.supplierId) || input.supplierId <= 0) {
    throw new Error('طرف حساب معتبر نیست.')
  }
  for (const payment of input.payments) {
    if (payment.box !== undefined && typeof payment.box !== 'string') throw new Error('صندوق معتبر نیست.')
    if (payment.note !== undefined && typeof payment.note !== 'string') throw new Error('یادداشت معتبر نیست.')
    if (payment.sarrafId !== undefined && (!Number.isSafeInteger(payment.sarrafId) || payment.sarrafId <= 0)) throw new Error('صراف معتبر نیست.')
  }
}
function stableUuid(seed: string): string {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (let i = 0; i < seed.length; i++) for (let j = 0; j < hashes.length; j++) {
    hashes[j] = Math.imul(hashes[j] ^ (seed.charCodeAt(i) + j * 97), 0x01000193 + j * 2)
    hashes[j] ^= hashes[j] >>> 13
  }
  const raw = hashes.map(value => (value >>> 0).toString(16).padStart(8, '0')).join('')
  const versioned = `${raw.slice(0, 12)}5${raw.slice(13)}`
  const variant = ((parseInt(versioned[16], 16) & 3) | 8).toString(16)
  const hex = `${versioned.slice(0, 16)}${variant}${versioned.slice(17)}`
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined).sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonical(child)]))
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : value
}
function creationFingerprint(input: CreateDirectTradeInput, customerUuid: string | undefined, supplierUuid: string | undefined,
  sarrafUuids: Map<number, string | undefined>): string {
  const payments = input.payments.map(payment => ({ ...payment, eventUuid: payment.eventUuid.toLowerCase(),
    box: payment.route === 'customerToSupplier' ? undefined : boxOf(payment),
    sarrafId: undefined, sarrafUuid: payment.sarrafId === undefined ? undefined : sarrafUuids.get(payment.sarrafId),
    note: payment.note?.trim() || undefined })).sort((left, right) => left.eventUuid.localeCompare(right.eventUuid))
  return JSON.stringify(canonical({ tradeUuid: input.tradeUuid.toLowerCase(), date: input.date, customerUuid,
    supplierUuid, lines: input.lines, payments, shipping: input.shipping ? { ...input.shipping,
      box: boxOf(input.shipping), note: input.shipping.note?.trim() || undefined } : undefined }))
}
async function applyEffects(doc: Payment | Sale | Purchase, table: 'payments' | 'sales' | 'purchases'): Promise<void> {
  for (const effect of effectsOf(table, doc)) {
    const row = await db.table(effect.table).get(effect.id!) as Record<string, number> | undefined
    if (!row) throw new Error('طرف حساب سند یافت نشد')
    await db.table(effect.table).update(effect.id!, { [effect.field]: (row[effect.field] ?? 0) + effect.delta })
  }
}

function buildPayment(input: DirectPaymentInput, customer: { id?: number; uuid?: string; name: string },
  supplier: { id?: number; uuid?: string; name: string }, tradeUuid: string): Payment {
  validUuid(input.eventUuid, 'شناسهٔ پرداخت')
  validDate(input.date)
  const note = input.note?.trim() || undefined
  if (input.route === 'customerCash') return {
    uuid: input.eventUuid, date: input.date, partyType: 'customer', partyId: customer.id!, partyName: customer.name,
    amount: input.amount, via: 'cash', cashDelta: input.amount, box: boxOf(input), note,
    directPayment: { tradeUuid, route: input.route }
  }
  if (input.route === 'supplierPayment') {
    const sarrafAmount = input.sarrafAmount ?? 0
    return {
      uuid: input.eventUuid, date: input.date, partyType: 'supplier', partyId: supplier.id!, partyName: supplier.name,
      amount: input.amount, via: sarrafAmount > 0 ? 'sarraf' : 'cash', sarrafId: input.sarrafId,
      sarrafAmount: sarrafAmount > 0 ? sarrafAmount : undefined, cashDelta: -(input.amount - sarrafAmount),
      box: boxOf(input), note, directPayment: { tradeUuid, route: input.route }
    }
  }
  return {
    uuid: input.eventUuid, date: input.date, partyType: 'customer', partyId: customer.id!, partyName: customer.name,
    amount: input.amount, cashDelta: 0, note,
    directPayment: { tradeUuid, route: input.route, supplierId: supplier.id, supplierUuid: supplier.uuid, supplierName: supplier.name }
  }
}
async function insertPayment(tradeUuid: string, input: DirectPaymentInput, customer: { id?: number; uuid?: string; name: string },
  supplier: { id?: number; uuid?: string; name: string }): Promise<number> {
  const payment = buildPayment(input, customer, supplier, tradeUuid)
  if (payment.sarrafId !== undefined) {
    const sarraf = await db.suppliers.get(payment.sarrafId)
    if (!sarraf || sarraf.deleted || !sarraf.uuid || !UUID.test(sarraf.uuid) || sarraf.kind !== 'sarraf' || sarraf.id === supplier.id) throw new Error('صراف معتبر و جدا از فروشنده را انتخاب کنید')
    payment.sarrafName = sarraf.name
  }
  const id = await db.payments.add(payment) as number
  await applyEffects(payment, 'payments')
  if (payment.cashDelta) await postCashMovement({
    uuid: stableUuid(`direct-cash:${payment.uuid}`), directPaymentUuid: payment.uuid, date: payment.date,
    type: payment.partyType === 'customer' ? 'customerPayment' : 'supplierPayment', refId: id,
    amount: payment.cashDelta, box: payment.box, note: payment.partyName
  })
  return id
}
const paymentView = (payment: Payment) => ({
  eventUuid: payment.uuid, route: payment.directPayment?.route, date: payment.date, amount: payment.amount,
  box: payment.box, sarrafId: payment.sarrafId, sarrafAmount: payment.sarrafAmount, note: payment.note
})

export async function createDirectTrade(input: CreateDirectTradeInput): Promise<DirectTradeResult> {
  if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
  validUuid(input.tradeUuid, 'شناسهٔ معامله')
  validDate(input.date)
  validateInputScalars(input)
  input.payments.forEach(payment => { validUuid(payment.eventUuid, 'شناسهٔ پرداخت'); validDate(payment.date) })
  input = { ...input, tradeUuid: input.tradeUuid.toLowerCase(), payments: input.payments.map(payment => ({ ...payment, eventUuid: payment.eventUuid.toLowerCase() })) }
  const totals = directTotals(input.lines)
  validateDirectPayments(totals, [], input.payments)
  return db.transaction('rw', [...SYNC_TABLES.map(table => db.table(table)), db.settings, db.syncState], async () => {
    if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
    if (!await directFeatureEnabled()) throw new Error('فروش مستقیم هنوز برای ثبت فعال نشده است.')
    const customer = await db.customers.get(input.customerId)
    const supplier = await db.suppliers.get(input.supplierId)
    if (!customer || customer.deleted || !customer.uuid || !UUID.test(customer.uuid)) throw new Error('مشتری یافت نشد')
    if (!supplier || supplier.deleted || !supplier.uuid || !UUID.test(supplier.uuid) || (supplier.kind !== undefined && supplier.kind !== 'supplier')) throw new Error('فروشنده یافت نشد')
    const sarrafUuids = new Map<number, string | undefined>()
    for (const payment of input.payments) if (payment.sarrafId !== undefined) {
      const sarraf = await db.suppliers.get(payment.sarrafId)
      if (!sarraf || sarraf.deleted || !sarraf.uuid || !UUID.test(sarraf.uuid) || sarraf.kind !== 'sarraf' || sarraf.id === supplier.id) throw new Error('صراف معتبر و جدا از فروشنده را انتخاب کنید')
      sarrafUuids.set(payment.sarrafId, sarraf.uuid)
    }
    const fingerprint = creationFingerprint(input, customer.uuid, supplier.uuid, sarrafUuids)
    const existing = await loadDirectTrade(input.tradeUuid)
    if (existing.sale || existing.purchase) {
      if (!existing.sale || !existing.purchase || existing.status === 'conflict' ||
          existing.sale.directTrade?.creationFingerprint !== fingerprint || existing.purchase.directTrade?.creationFingerprint !== fingerprint) {
        throw new Error('این شناسهٔ معامله با معلومات متفاوت قبلاً ثبت شده است.')
      }
      return { tradeUuid: input.tradeUuid, saleId: existing.sale.id!, purchaseId: existing.purchase.id! }
    }
    for (const event of input.payments) if (await db.payments.where('uuid').equals(event.eventUuid).first()) throw new Error('شناسهٔ پرداخت قبلاً استفاده شده است.')
    const saleUuid = stableUuid(`direct-sale:${input.tradeUuid}`)
    const purchaseUuid = stableUuid(`direct-purchase:${input.tradeUuid}`)
    const revision = stableUuid(`direct-revision:${input.tradeUuid}`)
    const sale: Sale = { uuid: saleUuid, date: input.date, customerId: customer.id, customerName: customer.name, saleType: 'wholesale', lines: [], directLines: input.lines, directTrade: { uuid: input.tradeUuid, revision, creationFingerprint: fingerprint, counterpartUuid: purchaseUuid, status: 'active' }, total: totals.sale, paid: 0, discount: 0 }
    const purchase: Purchase = { uuid: purchaseUuid, date: input.date, supplierId: supplier.id!, supplierName: supplier.name, lines: [], directLines: input.lines, directTrade: { uuid: input.tradeUuid, revision, creationFingerprint: fingerprint, counterpartUuid: saleUuid, status: 'active' }, total: totals.cost, paid: 0, received: false }
    const saleId = await db.sales.add(sale) as number
    const purchaseId = await db.purchases.add(purchase) as number
    await applyEffects(sale, 'sales')
    await applyEffects(purchase, 'purchases')
    for (const payment of [...input.payments].sort((left, right) => Number(left.route === 'supplierPayment') - Number(right.route === 'supplierPayment'))) await insertPayment(input.tradeUuid, payment, customer, supplier)
    if (input.shipping) await addSaleShipping(saleId, input.shipping)
    return { tradeUuid: input.tradeUuid, saleId, purchaseId }
  })
}

export async function addDirectPayment(tradeUuid: string, input: DirectPaymentInput, expectedToken: string): Promise<number> {
  if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
  validUuid(tradeUuid, 'شناسهٔ معامله')
  validUuid(input.eventUuid, 'شناسهٔ پرداخت')
  validDate(input.date)
  tradeUuid = tradeUuid.toLowerCase()
  input = { ...input, eventUuid: input.eventUuid.toLowerCase() }
  return db.transaction('rw', [...SYNC_TABLES.map(table => db.table(table)), db.settings, db.syncState], async () => {
    if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
    const state = await loadDirectTrade(tradeUuid)
    const customer = state.sale?.customerId === undefined ? undefined : await db.customers.get(state.sale.customerId)
    const supplier = state.purchase ? await db.suppliers.get(state.purchase.supplierId) : undefined
    if (!customer || !customer.uuid || !UUID.test(customer.uuid) || !supplier || !supplier.uuid || !UUID.test(supplier.uuid)) throw new Error('طرف حساب معامله یافت نشد')
    assertDirectWriteReady(state)
    const existing = await db.payments.where('uuid').equals(input.eventUuid).first()
    if (existing) {
      if (existing.deleted || existing.correctedByUuid) throw new Error('این پرداخت دیگر فعال نیست و دوباره قابل ثبت نیست.')
      const wanted = buildPayment(input, customer, supplier, tradeUuid)
      const fields = (payment: Payment) => ({ uuid: payment.uuid, ...paymentView(payment), partyType: payment.partyType, partyId: payment.partyId, partyName: payment.partyName, via: payment.via, cashDelta: payment.cashDelta, directPayment: payment.directPayment })
      if (!same(fields(existing), fields(wanted))) throw new Error('این شناسهٔ پرداخت با معلومات متفاوت قبلاً ثبت شده است.')
      return existing.id!
    }
    assertDirectWriteReady(state, expectedToken)
    validateDirectPayments(state.totals, state.payments, [input])
    return insertPayment(tradeUuid, input, customer, supplier)
  })
}
