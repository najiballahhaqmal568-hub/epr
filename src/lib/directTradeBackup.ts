import type { Payment } from '../db'
import { directBalances, directTotals } from './directTradeMath'
import type { DirectLine } from './directTradeTypes'

type Row = Record<string, unknown>
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const failure = () => new Error('معلومات فروش مستقیم در بکاپ معتبر نیست؛ هیچ داده‌ای جایگزین نشد.')
function check(valid: boolean): asserts valid { if (!valid) throw failure() }
function row(value: unknown): Row {
  check(!!value && typeof value === 'object' && !Array.isArray(value))
  return value as Row
}
const uuid = (value: unknown) => typeof value === 'string' && uuidPattern.test(value)
const whole = (value: unknown, minimum = 0) => Number.isSafeInteger(value) && (value as number) >= minimum
const date = (value: unknown) => whole(value, 1) && (value as number) <= 8_640_000_000_000_000
const rows = (data: Row, table: string): unknown[] => Array.isArray(data[table]) ? data[table] as unknown[] : []

/** Validate values before restore clears tables. Missing counterpart/party rows
 * remain recoverable incomplete states; do not throw away partial backups. */
export function validateDirectBackup(value: unknown): void {
  const data = row(value)
  try {
    for (const table of ['sales', 'purchases'] as const) for (const candidate of rows(data, table)) {
      if (!candidate || typeof candidate !== 'object') continue
      const doc = row(candidate)
      if (doc.directTrade === undefined && doc.directLines === undefined) continue
      const meta = row(doc.directTrade)
      check(uuid(doc.uuid) && date(doc.date) && uuid(meta.uuid) && uuid(meta.revision) && uuid(meta.counterpartUuid))
      check(meta.status === 'active' || meta.status === 'cancelled')
      check(meta.previousRevision === undefined || uuid(meta.previousRevision))
      check(Array.isArray(doc.lines) && doc.lines.length === 0 && Array.isArray(doc.directLines))
      const totals = directTotals(doc.directLines as DirectLine[])
      check(doc.total === (table === 'sales' ? totals.sale : totals.cost) && doc.paid === 0)
      const zeroFields = table === 'sales' ? ['discount'] : ['sarrafAmount', 'landingCost', 'landingUnpaid', 'landingSarrafAmount']
      check(zeroFields.every(key => doc[key] === undefined || doc[key] === 0))
      const absentFields = table === 'sales'
        ? ['cashPaid', 'lenderAction', 'lenderId', 'expenseCreditorId']
        : ['sarrafId', 'landingVia', 'landingSarrafId', 'landingPaid', 'receivedAt']
      check(absentFields.every(key => doc[key] === undefined))
      check(whole(doc[table === 'sales' ? 'customerId' : 'supplierId'], 1))
      if (table === 'purchases') check(doc.received === false)
    }
    for (const candidate of rows(data, 'payments')) {
      if (!candidate || typeof candidate !== 'object') continue
      const payment = row(candidate)
      if (payment.directPayment === undefined) continue
      const ref = row(payment.directPayment)
      check(uuid(payment.uuid) && uuid(ref.tradeUuid) && date(payment.date) && whole(payment.partyId, 1))
      // Reuse the route/amount validator without applying a trade allocation cap:
      // an overallocated imported trade must remain visible as a conflict.
      directBalances({ cost: Number.MAX_SAFE_INTEGER, sale: Number.MAX_SAFE_INTEGER, pairs: 1, profit: 0 }, [{ ...payment, deleted: false } as unknown as Payment])
      const amount = payment.amount as number
      const sarraf = (payment.sarrafAmount ?? 0) as number
      if (ref.route === 'customerCash') {
        check(payment.partyType === 'customer' && payment.via === 'cash' && payment.cashDelta === amount)
      } else if (ref.route === 'supplierPayment') {
        check(payment.partyType === 'supplier' && payment.cashDelta === -(amount - sarraf))
        check(sarraf > 0 ? payment.via === 'sarraf' && whole(payment.sarrafId, 1) : payment.via === 'cash')
      } else {
        check(ref.route === 'customerToSupplier' && payment.partyType === 'customer' && payment.via === undefined && payment.cashDelta === 0)
        check(whole(ref.supplierId, 1) && uuid(ref.supplierUuid))
      }
    }
    for (const candidate of rows(data, 'cashMovements')) {
      if (!candidate || typeof candidate !== 'object') continue
      const movement = row(candidate)
      if (movement.directPaymentUuid === undefined) continue
      check(uuid(movement.uuid) && uuid(movement.directPaymentUuid) && date(movement.date) && Number.isSafeInteger(movement.amount))
    }
  } catch {
    throw failure()
  }
}
