import type { Payment, Purchase, Sale } from '../src/db'
import { byModel, saleProfit } from '../src/lib/analytics'
import { directPeriodSummary, directReceiptModel, ordinaryCustomerCollections } from '../src/lib/directTradeReports'
import type { DirectTradeState } from '../src/lib/directTradeState'
import { buildCustomerLedger } from '../src/lib/ledger'
import { groupSaleHistory } from '../src/lib/saleHistory'
import { soldInPeriod, soldVariantIds } from '../src/lib/sold'
import { equal, line, totals } from './direct-trade-fixtures'

const baseMeta = { uuid: 'trade-report', revision: 'r1', counterpartUuid: 'other', status: 'active' as const }
const sale = { id: 10, uuid: 'sale-direct', date: 100, customerId: 2, customerName: 'مشتری مستقیم', saleType: 'wholesale' as const,
  lines: [], directLines: [line], directTrade: baseMeta, total: 12000, paid: 0 }
const purchase = { id: 11, uuid: 'purchase-direct', date: 100, supplierId: 3, supplierName: 'فروشنده مستقیم', lines: [], directLines: [line],
  directTrade: { ...baseMeta, counterpartUuid: 'sale-direct' }, total: 10000, paid: 0, received: false }
const payments: Payment[] = [
  { id: 12, date: 100, partyType: 'customer', partyId: 2, partyName: 'مشتری مستقیم', amount: 3000, cashDelta: 3000, via: 'cash', directPayment: { tradeUuid: baseMeta.uuid, route: 'customerCash' } },
  { id: 13, date: 100, partyType: 'customer', partyId: 2, partyName: 'مشتری مستقیم', amount: 7000, cashDelta: 0, directPayment: { tradeUuid: baseMeta.uuid, route: 'customerToSupplier', supplierId: 3 } }
]
const state: DirectTradeState = { sale: sale as Sale, purchase: purchase as Purchase, payments, totals,
  balances: { customerRemaining: 2000, supplierRemaining: 3000, customerCash: 3000, supplierPaid: 0, customerToSupplier: 7000, cashDelta: 3000, overallocated: false },
  status: 'ready', token: '', issues: [], featureEnabled: false }

export const cases = [
  { name: 'receipt is customer-safe and rejects uncertain state', run: async () => {
    equal(directReceiptModel(state), { date: 100, customerName: 'مشتری مستقیم', lines: [{ productName: line.productName, size: line.size, color: line.color, qty: 10, unitPrice: 1200 }], total: 12000, settled: 10000, remaining: 2000 })
    equal(Object.keys(directReceiptModel(state)).sort(), ['customerName', 'date', 'lines', 'remaining', 'settled', 'total'])
    equal(Object.keys(directReceiptModel(state).lines[0]).sort(), ['color', 'productName', 'qty', 'size', 'unitPrice'])
    let refused = false; try { directReceiptModel({ ...state, status: 'conflict' }) } catch { refused = true }; equal(refused, true)
  } },
  { name: 'customer-to-supplier route is excluded from ordinary cash collection', run: async () => {
    equal(ordinaryCustomerCollections([...payments, { id: 15, date: 100, partyType: 'customer', partyId: 9, partyName: 'عادی', amount: 500 }]), 500)
  } },
  { name: 'period summary separates base date from payment date', run: async () => {
    equal(directPeriodSummary([state], 100, 100), { sales: 12000, purchases: 10000, profit: 2000, pairs: 10, customerCash: 3000, customerDirect: 7000, supplierCash: 0, incomplete: 0 })
    const later = { ...state, payments: [...payments, { ...payments[0], id: 14, date: 101, amount: 1000 }] }
    equal(directPeriodSummary([later], 101, 101), { sales: 0, purchases: 0, profit: 0, pairs: 0, customerCash: 1000, customerDirect: 0, supplierCash: 0, incomplete: 0 })
    equal(directPeriodSummary([{ ...state, sale: undefined, status: 'incomplete' }], 100, 100).incomplete, 1)
    equal(directPeriodSummary([{ ...state, sale: undefined, status: 'incomplete' }], 101, 101).incomplete, 0)
  } },
  { name: 'analytics sold search and ledger include direct commercial lines without stock ids', run: async () => {
    const ordinary = { id: 20, date: 100, customerName: 'عادی', saleType: 'retail', lines: [{ variantId: 8, productName: 'عادی', size: '42', color: 'سفید', qty: 1, unitPrice: 800, unitCost: 500 }], total: 800, paid: 800 } as Sale
    equal(saleProfit(sale as Sale), 2000)
    equal(byModel([ordinary, sale as Sale]).map(r => [r.name, r.pairs]), [['عادی', 1], [line.productName, 10]])
    const sold = soldInPeriod([ordinary, sale as Sale]); equal(sold.length, 2); equal(sold.some(r => r.variantId === undefined && r.qty === 10), true)
    equal([...soldVariantIds([ordinary, sale as Sale])], [8])
    equal(groupSaleHistory([sale as Sale], line.productName).length, 1)
    const ledger = buildCustomerLedger([sale as Sale], payments, [])
    equal(ledger.map(r => [r.label, r.delta]), [['فروش مستقیم', 12000], ['رسید', -3000], ['مشتری مستقیم به فروشنده داده — بدون صندوق', -7000]])
  } }
]
