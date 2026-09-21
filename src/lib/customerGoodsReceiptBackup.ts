import type { Adjustment, CashMovement, Customer, Payment, Product, Sale, Variant } from '../db'
import { validateCustomerGoodsReceiptRows } from './customerGoodsReceiptState'
import { RECEIPT_UUID, type CustomerGoodsReceiptMeta } from './customerGoodsReceiptTypes'

type Row = Record<string, unknown>
const failure = () => new Error('معلومات دریافت جنس در بکاپ معتبر نیست؛ هیچ داده‌ای جایگزین نشد.')
function check(value: unknown): asserts value { if (!value) throw failure() }
function object(value: unknown): Row {
  check(!!value && typeof value === 'object' && !Array.isArray(value))
  return value as Row
}
function rows(data: Row, table: string): Row[] {
  const value = data[table]
  check(value === undefined || Array.isArray(value))
  return (value ?? []) as Row[]
}
const validId = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0

function exactMaster<T extends Row>(masterRows: T[], id: unknown, uuid: unknown, requireLive: boolean): T {
  check(validId(id) && typeof uuid === 'string' && RECEIPT_UUID.test(uuid))
  const byId = masterRows.filter(row => row.id === id)
  const byUuid = masterRows.filter(row => row.uuid === uuid)
  check(byId.length === 1 && byUuid.length === 1 && byId[0] === byUuid[0])
  check(!requireLive || !byId[0].deleted)
  return byId[0]
}

function sameCorrectionIdentity(left: CustomerGoodsReceiptMeta, right: CustomerGoodsReceiptMeta): boolean {
  return left.snapshot.date === right.snapshot.date &&
    left.snapshot.customerUuid === right.snapshot.customerUuid &&
    left.snapshot.destination === right.snapshot.destination &&
    left.snapshot.onward?.buyerUuid === right.snapshot.onward?.buyerUuid &&
    left.snapshot.onward?.box === right.snapshot.onward?.box
}

/** Receipt backups are aggregate snapshots, not a recoverable row stream. Reject
 * partial/malformed groups before importBackup pauses sync or clears any table. */
export function validateCustomerGoodsReceiptBackup(value: unknown): void {
  try {
    const data = object(value)
    const payments = rows(data, 'payments') as unknown as Payment[]
    const adjustments = rows(data, 'adjustments') as unknown as Adjustment[]
    const sales = rows(data, 'sales') as unknown as Sale[]
    const cashMovements = rows(data, 'cashMovements') as unknown as CashMovement[]
    const customers = rows(data, 'customers') as unknown as Array<Customer & Row>
    const variants = rows(data, 'variants') as unknown as Array<Variant & Row>
    const products = rows(data, 'products') as unknown as Array<Product & Row>

    for (const payment of payments) if ((payment as unknown as Row).goodsReceipt !== undefined) check(!!payment.goodsReceipt && typeof payment.goodsReceipt === 'object')
    for (const child of [...adjustments, ...sales, ...cashMovements]) if ((child as unknown as Row).goodsReceiptChild !== undefined) check(!!child.goodsReceiptChild && typeof child.goodsReceiptChild === 'object')

    const anchors = payments.filter(payment => payment.goodsReceipt)
    const receiptUuids = new Set(anchors.map(payment => payment.goodsReceipt!.receiptUuid))
    check(receiptUuids.size === anchors.length)
    for (const child of [...adjustments, ...sales, ...cashMovements].filter(row => row.goodsReceiptChild)) {
      check(receiptUuids.has(child.goodsReceiptChild!.receiptUuid))
    }

    const anchorByUuid = new Map<string, Payment>()
    for (const receiptUuid of receiptUuids) {
      check(typeof receiptUuid === 'string' && RECEIPT_UUID.test(receiptUuid))
      const state = validateCustomerGoodsReceiptRows(receiptUuid, { payments, adjustments, sales, cashMovements })
      check((state.status === 'ready' || state.status === 'cancelled') && !!state.payment && state.issues.length === 0)
      const anchor = state.payment
      const meta = anchor.goodsReceipt!
      const requireLive = meta.status === 'active'
      check(anchor.uuid === receiptUuid && validId(anchor.id) && validId(anchor.partyId))
      exactMaster(customers, anchor.partyId, meta.snapshot.customerUuid, requireLive)
      if (state.sale) {
        check(validId(state.sale.id) && validId(state.sale.customerId))
        exactMaster(customers, state.sale.customerId, meta.snapshot.onward?.buyerUuid, requireLive)
      }
      for (const adjustment of state.adjustments) {
        const member = meta.members.find(item => item.table === 'adjustments' && item.uuid === adjustment.uuid)
        check(!!member && validId(adjustment.id) && validId(adjustment.variantId))
        const variant = exactMaster(variants, adjustment.variantId, member.variantUuid, requireLive)
        check(validId(variant.productId))
        const product = products.filter(row => row.id === variant.productId)
        check(product.length === 1 && typeof product[0].uuid === 'string' && RECEIPT_UUID.test(product[0].uuid!) && (!requireLive || !product[0].deleted))
      }
      for (const movement of state.cashMovements) check(validId(movement.id))
      anchorByUuid.set(receiptUuid, anchor)
    }

    const successorOf = new Map<string, string>()
    for (const [receiptUuid, anchor] of anchorByUuid) {
      const meta = anchor.goodsReceipt!
      if (meta.correctionOfUuid) {
        const predecessor = anchorByUuid.get(meta.correctionOfUuid)
        check(!!predecessor && predecessor.deleted && predecessor.goodsReceipt?.status === 'cancelled')
        check(predecessor.goodsReceipt.correctedByUuid === receiptUuid && sameCorrectionIdentity(predecessor.goodsReceipt, meta))
        check(!successorOf.has(meta.correctionOfUuid))
        successorOf.set(meta.correctionOfUuid, receiptUuid)
      }
      if (meta.correctedByUuid) {
        const successor = anchorByUuid.get(meta.correctedByUuid)
        check(!!successor && successor.goodsReceipt?.correctionOfUuid === receiptUuid)
      }
    }
    for (const start of anchorByUuid.keys()) {
      const seen = new Set<string>()
      let current: string | undefined = start
      while (current) {
        check(!seen.has(current)); seen.add(current)
        current = anchorByUuid.get(current)?.goodsReceipt?.correctionOfUuid
      }
    }
  } catch {
    throw failure()
  }
}
