import type { Payment } from '../db'
import type { DirectBalances, DirectLine, DirectPaymentInput, DirectPaymentRoute, DirectTotals } from './directTradeTypes'

function requireText(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${field} is required`)
}

function requireWhole(value: number, field: string, minimum = 0): void {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error(`${field} must be a safe integer of at least ${minimum}`)
}

function safeAdd(left: number, right: number, field: string): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new Error(`${field} exceeds the safe integer range`)
  return result
}

function requireDirectRoute(value: unknown): asserts value is DirectPaymentRoute {
  if (value !== 'customerCash' && value !== 'supplierPayment' && value !== 'customerToSupplier') {
    throw new Error('Unknown direct payment route')
  }
}

export function directTotals(lines: readonly DirectLine[]): DirectTotals {
  if (lines.length === 0) throw new Error('At least one direct line is required')
  const uuids = new Set<string>()
  let cost = 0
  let sale = 0
  let pairs = 0
  for (const line of lines) {
    requireText(line.lineUuid, 'lineUuid')
    if (uuids.has(line.lineUuid)) throw new Error('Direct line UUIDs must be unique')
    uuids.add(line.lineUuid)
    requireText(line.productName, 'productName')
    requireText(line.size, 'size')
    requireText(line.color, 'color')
    requireWhole(line.qty, 'qty', 1)
    requireWhole(line.unitCost, 'unitCost')
    requireWhole(line.unitPrice, 'unitPrice')
    const lineCost = line.qty * line.unitCost
    const lineSale = line.qty * line.unitPrice
    if (!Number.isSafeInteger(lineCost) || !Number.isSafeInteger(lineSale)) throw new Error('Direct line total exceeds the safe integer range')
    cost = safeAdd(cost, lineCost, 'cost')
    sale = safeAdd(sale, lineSale, 'sale')
    pairs = safeAdd(pairs, line.qty, 'pairs')
  }
  if (sale === 0) throw new Error('Direct sale total must be positive')
  const profit = sale - cost
  if (!Number.isSafeInteger(profit)) throw new Error('profit exceeds the safe integer range')
  return { cost, sale, profit, pairs }
}

function validateStoredPayment(payment: Payment): void {
  requireWhole(payment.amount, 'amount', 1)
  if (!Number.isSafeInteger(payment.cashDelta)) throw new Error('Direct payment cashDelta must be an explicit safe integer')
  if (payment.via === 'opening' || payment.via === 'goods') throw new Error('Direct payments cannot use opening or goods routes')
  const route = payment.directPayment?.route
  requireDirectRoute(route)
  const sarrafAmount = payment.sarrafAmount ?? 0
  requireWhole(sarrafAmount, 'sarrafAmount')
  if (route !== 'supplierPayment' && (payment.sarrafId !== undefined || payment.sarrafAmount !== undefined)) {
    throw new Error('Sarraf allocation is only valid for supplier payments')
  }
  if (sarrafAmount > payment.amount) throw new Error('Sarraf allocation cannot exceed payment amount')
  if (sarrafAmount > 0 && payment.sarrafId === undefined) throw new Error('Sarraf is required for a nonzero allocation')
  if (route === 'customerCash' && (payment.cashDelta! < 0 || payment.cashDelta! > payment.amount)) {
    throw new Error('Customer cash delta exceeds its route allocation')
  }
  if (route === 'supplierPayment' && (payment.cashDelta! > 0 || -payment.cashDelta! > payment.amount - sarrafAmount)) {
    throw new Error('Supplier cash delta exceeds its cash-funded allocation')
  }
  if (route === 'customerToSupplier' && payment.cashDelta !== 0) throw new Error('Direct customer-to-supplier payment cannot change cash')
}

export function directBalances(totals: DirectTotals, payments: readonly Payment[]): DirectBalances {
  requireWhole(totals.cost, 'cost')
  requireWhole(totals.sale, 'sale', 1)
  requireWhole(totals.pairs, 'pairs', 1)
  let customerCash = 0
  let supplierPaid = 0
  let customerToSupplier = 0
  let cashDelta = 0
  for (const payment of payments) {
    if (payment.deleted) continue
    validateStoredPayment(payment)
    const route = payment.directPayment!.route
    switch (route) {
      case 'customerCash':
        customerCash = safeAdd(customerCash, payment.amount, 'customerCash')
        break
      case 'supplierPayment':
        supplierPaid = safeAdd(supplierPaid, payment.amount, 'supplierPaid')
        break
      case 'customerToSupplier':
        customerToSupplier = safeAdd(customerToSupplier, payment.amount, 'customerToSupplier')
        break
    }
    cashDelta = safeAdd(cashDelta, payment.cashDelta!, 'cashDelta')
  }
  const customerRemaining = totals.sale - customerCash - customerToSupplier
  const supplierRemaining = totals.cost - supplierPaid - customerToSupplier
  if (!Number.isSafeInteger(customerRemaining) || !Number.isSafeInteger(supplierRemaining)) throw new Error('Direct balance exceeds the safe integer range')
  return {
    customerRemaining,
    supplierRemaining,
    customerCash,
    supplierPaid,
    customerToSupplier,
    cashDelta,
    overallocated: customerRemaining < 0 || supplierRemaining < 0
  }
}

export function validateDirectPayments(totals: DirectTotals, existing: readonly Payment[], next: readonly DirectPaymentInput[]): void {
  const balance = directBalances(totals, existing)
  if (balance.overallocated) throw new Error('Existing direct payments are overallocated')
  let customerRemaining = balance.customerRemaining
  let supplierRemaining = balance.supplierRemaining
  const eventUuids = new Set(existing.filter(payment => !payment.deleted).map(payment => payment.uuid).filter((uuid): uuid is string => Boolean(uuid)))
  for (const input of next) {
    requireText(input.eventUuid, 'eventUuid')
    if (eventUuids.has(input.eventUuid)) throw new Error('Direct payment event UUIDs must be unique')
    eventUuids.add(input.eventUuid)
    requireWhole(input.date, 'date')
    requireWhole(input.amount, 'amount', 1)
    requireDirectRoute(input.route)
    const sarrafAmount = input.sarrafAmount ?? 0
    requireWhole(sarrafAmount, 'sarrafAmount')
    if (input.route !== 'supplierPayment' && (input.sarrafId !== undefined || input.sarrafAmount !== undefined)) {
      throw new Error('Sarraf allocation is only valid for supplier payments')
    }
    if (sarrafAmount > input.amount) throw new Error('Sarraf allocation cannot exceed payment amount')
    if (sarrafAmount > 0 && input.sarrafId === undefined) throw new Error('Sarraf is required for a nonzero allocation')
    switch (input.route) {
      case 'customerCash':
        customerRemaining -= input.amount
        break
      case 'supplierPayment':
        supplierRemaining -= input.amount
        break
      case 'customerToSupplier':
        if (input.box !== undefined) throw new Error('Direct customer-to-supplier payment cannot use a cash box')
        customerRemaining -= input.amount
        supplierRemaining -= input.amount
        break
    }
    if (!Number.isSafeInteger(customerRemaining) || !Number.isSafeInteger(supplierRemaining)) throw new Error('Direct allocation exceeds the safe integer range')
    if (customerRemaining < 0 || supplierRemaining < 0) throw new Error('Direct payment exceeds the remaining balance')
  }
}
