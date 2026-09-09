import type { Payment, Purchase, Sale } from '../src/db'
import { commercialPurchaseLines, commercialSaleLines } from '../src/lib/commercialLines'
import { computeCosts, historicalCostRevision } from '../src/lib/costing'
import { directBalances, directTotals, validateDirectPayments } from '../src/lib/directTradeMath'
import { effectsOf } from '../src/lib/effects'
import { computeStock, computeSupplierBalances } from '../src/lib/integrity'
import { equal, line, payment, rejects, totals } from './direct-trade-fixtures'

export const cases: Array<{ name: string; run: () => Promise<void> }> = []

cases.push({ name: 'commercial totals and invalid quantity', run: async () => {
  equal(directTotals([line]), totals)
  await rejects(async () => directTotals([{ ...line, qty: 1.5 }]))
  await rejects(async () => directTotals([{ ...line, unitCost: Number.NaN }]))
}})

cases.push({ name: 'line validation rejects malformed and unsafe totals', run: async () => {
  const invalid = [
    [],
    [line, { ...line }],
    [{ ...line, lineUuid: '' }],
    [{ ...line, productName: '  ' }],
    [{ ...line, size: '' }],
    [{ ...line, color: '' }],
    [{ ...line, qty: 0 }],
    [{ ...line, qty: -1 }],
    [{ ...line, qty: Number.POSITIVE_INFINITY }],
    [{ ...line, unitCost: -1 }],
    [{ ...line, unitPrice: -1 }],
    [{ ...line, unitPrice: Number.POSITIVE_INFINITY }],
    [{ ...line, qty: Number.MAX_SAFE_INTEGER, unitCost: 2 }],
    [{ ...line, unitPrice: 0 }]
  ]
  for (const lines of invalid) await rejects(async () => directTotals(lines))
}})

cases.push({ name: 'below-cost direct sale preserves explicit loss', run: async () => {
  equal(directTotals([{ ...line, unitPrice: 800 }]), { cost: 10000, sale: 8000, profit: -2000, pairs: 10 })
}})

cases.push({ name: 'balances use live explicit route and cash deltas', run: async () => {
  equal(directBalances(totals, [
    payment('customerCash', 2000, 2000),
    payment('supplierPayment', 3000, -2000, { sarrafId: 9, sarrafAmount: 1000 }),
    payment('customerToSupplier', 4000, 0),
    payment('customerCash', 9999, 9999, { deleted: true })
  ]), {
    customerRemaining: 6000,
    supplierRemaining: 3000,
    customerCash: 2000,
    supplierPaid: 3000,
    customerToSupplier: 4000,
    cashDelta: 0,
    overallocated: false
  })
}})

cases.push({ name: 'balances flag over-allocation and reject invalid stored amounts', run: async () => {
  equal(directBalances(totals, [payment('customerCash', 13000, 13000)]).overallocated, true)
  await rejects(async () => directBalances(totals, [payment('customerCash', 1, undefined as unknown as number)]))
  await rejects(async () => directBalances(totals, [payment('customerCash', 2, 3)]))
  await rejects(async () => directBalances(totals, [payment('supplierPayment', 2, -1, { sarrafAmount: 3 })]))
  await rejects(async () => directBalances(totals, [payment('supplierPayment', 3, -3, { sarrafId: 9, sarrafAmount: 1 })]))
  await rejects(async () => directBalances(totals, [payment('customerToSupplier', 2, 1)]))
  await rejects(async () => directBalances(totals, [
    payment('customerCash', 2, 1, { directPayment: { tradeUuid: 'trade-1', route: 'unknown' as never } })
  ]))
}})

cases.push({ name: 'next payment allocation enforces route, sarraf and balance caps', run: async () => {
  validateDirectPayments(totals, [], [
    { eventUuid: 'event-1', route: 'customerCash', date: 1, amount: 2000 },
    { eventUuid: 'event-2', route: 'supplierPayment', date: 2, amount: 3000, sarrafId: 9, sarrafAmount: 1000 },
    { eventUuid: 'event-3', route: 'customerToSupplier', date: 3, amount: 4000 }
  ])
  const invalid = [
    [{ eventUuid: '', route: 'customerCash' as const, date: 1, amount: 1 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1, amount: 0 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1.5, amount: 1 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1, amount: 1, sarrafAmount: 1 }],
    [{ eventUuid: 'e', route: 'supplierPayment' as const, date: 1, amount: 2, sarrafAmount: 3 }],
    [{ eventUuid: 'e', route: 'customerToSupplier' as const, date: 1, amount: 1, sarrafId: 2 }],
    [{ eventUuid: 'e', route: 'customerCash' as const, date: 1, amount: 12001 }]
  ]
  for (const next of invalid) await rejects(async () => validateDirectPayments(totals, [], next))
  await rejects(async () => validateDirectPayments(totals, [], [
    { eventUuid: 'unknown-route', route: 'unknown' as never, date: 1, amount: 1 }
  ]))
  await rejects(async () => validateDirectPayments(totals, [], [
    { eventUuid: 'same', route: 'customerCash', date: 1, amount: 1 },
    { eventUuid: 'same', route: 'customerCash', date: 1, amount: 1 }
  ]))
}})

cases.push({ name: 'ordinary commercial accessors remain unchanged', run: async () => {
  const ordinarySale = { lines: [{ variantId: 7, productName: 'A', size: '40', color: 'B', qty: 2, unitPrice: 8, unitCost: 5 }] } as Sale
  const ordinaryPurchase = { lines: [{ variantId: 8, productName: 'C', size: '41', color: 'D', qty: 3, unitCost: 6 }] } as Purchase
  equal(commercialSaleLines(ordinarySale), ordinarySale.lines)
  equal(commercialPurchaseLines(ordinaryPurchase), ordinaryPurchase.lines)

  const directSale = { lines: [], directLines: [line] } as unknown as Sale
  const directPurchase = { lines: [], directLines: [line] } as unknown as Purchase
  equal(commercialSaleLines(directSale), [{ lineUuid: line.lineUuid, productName: line.productName, size: line.size, color: line.color, qty: line.qty, unitPrice: line.unitPrice, unitCost: line.unitCost }])
  equal(commercialPurchaseLines(directPurchase), [{ lineUuid: line.lineUuid, productName: line.productName, size: line.size, color: line.color, qty: line.qty, unitCost: line.unitCost }])
}})

cases.push({ name: 'customer-to-supplier payment has exactly two debt effects', run: async () => {
  const directPayment: Payment = {
    date: 1, partyType: 'customer', partyId: 11, partyName: 'آزمایشی',
    amount: 7000, cashDelta: 0, via: 'lender', lenderId: 33, sarrafId: 44, sarrafAmount: 7000,
    directPayment: { tradeUuid: 'trade-test', route: 'customerToSupplier', supplierId: 22 }
  }
  equal(effectsOf('payments', directPayment), [
    { table: 'customers', id: 11, field: 'balance', delta: -7000 },
    { table: 'suppliers', id: 22, field: 'balance', delta: -7000 }
  ])
  equal(Array.from(computeSupplierBalances([], [directPayment], []).entries()), [[22, -7000]])
}})

cases.push({ name: 'direct documents never move warehouse stock or historical costs', run: async () => {
  const ordinaryPurchase = {
    id: 1, date: 1, supplierId: 22, supplierName: 'فروشنده',
    lines: [{ variantId: 7, productName: 'بوت', size: '40', color: 'سیاه', qty: 10, unitCost: 500 }],
    total: 5000, paid: 5000
  } as Purchase
  const ordinarySale = {
    id: 2, date: 2, saleType: 'retail',
    lines: [{ variantId: 7, productName: 'بوت', size: '40', color: 'سیاه', qty: 2, unitPrice: 800, unitCost: 500 }],
    total: 1600, paid: 1600
  } as Sale
  const directTrade = { uuid: 'trade-test', revision: 'rev-1', counterpartUuid: 'counterpart', status: 'active' as const }
  const maliciousDirectPurchase = {
    ...ordinaryPurchase, id: 3, date: 3, directTrade,
    lines: [{ ...ordinaryPurchase.lines[0], qty: 100, unitCost: 9000 }]
  } as Purchase
  const maliciousDirectSale = {
    ...ordinarySale, id: 4, date: 4, directTrade,
    lines: [{ ...ordinarySale.lines[0], qty: 100, unitCost: 9000 }]
  } as Sale

  const stockBefore = computeStock([ordinarySale], [ordinaryPurchase], [], [])
  const costBefore = computeCosts([ordinarySale], [ordinaryPurchase], [], [])
  const revisionBefore = historicalCostRevision(1, [600], [ordinarySale], [ordinaryPurchase], [], [])
  const stockAfter = computeStock([ordinarySale, maliciousDirectSale], [ordinaryPurchase, maliciousDirectPurchase], [], [])
  const costAfter = computeCosts([ordinarySale, maliciousDirectSale], [ordinaryPurchase, maliciousDirectPurchase], [], [])
  const revisionAfter = historicalCostRevision(1, [600], [ordinarySale, maliciousDirectSale], [ordinaryPurchase, maliciousDirectPurchase], [], [])
  const directTargetRevision = historicalCostRevision(3, [9500], [ordinarySale], [ordinaryPurchase, maliciousDirectPurchase], [], [])

  equal(stockBefore.get(7), 8)
  equal(stockAfter.get(7), 8)
  equal(costBefore.get(7), 500)
  equal(costAfter.get(7), 500)
  equal(revisionBefore.sales.get(2)?.[0].unitCost, 600)
  equal(revisionAfter.sales.get(2)?.[0].unitCost, 600)
  equal(revisionAfter.sales.has(4), false)
  equal(directTargetRevision, { sales: new Map(), returns: new Map(), affectedSales: 0, affectedPairs: 0, profitChange: 0 })
}})
