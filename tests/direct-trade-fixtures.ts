import { accessFlags, db, SYNC_TABLES, newUuid, type Payment } from '../src/db'
import { addOpeningDebt, addPayment, addSale, setOpeningStock } from '../src/lib/ops'
import type { DirectLine, DirectPaymentRoute, DirectTotals } from '../src/lib/directTradeTypes'

export function equal(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  if (left !== right) throw new Error(`Expected ${right}, received ${left}`)
}

export async function rejects(action: () => Promise<unknown>): Promise<void> {
  try {
    await action()
  } catch {
    return
  }
  throw new Error('Expected action to reject')
}

export const line: DirectLine = {
  lineUuid: '10000000-0000-4000-8000-000000000001',
  productName: 'بوت آزمایشی',
  size: '40',
  color: 'سیاه',
  qty: 10,
  unitCost: 1000,
  unitPrice: 1200
}

export const totals: DirectTotals = { cost: 10000, sale: 12000, profit: 2000, pairs: 10 }

export function payment(route: DirectPaymentRoute, amount: number, cashDelta: number, extra: Partial<Payment> = {}): Payment {
  return {
    uuid: `20000000-0000-4000-8000-${route}-${amount}`,
    date: 1,
    partyType: route === 'supplierPayment' ? 'supplier' : 'customer',
    partyId: 1,
    partyName: 'Test',
    amount,
    cashDelta,
    directPayment: { tradeUuid: 'trade-1', route },
    ...extra
  }
}

export async function seed(): Promise<{ customerId: number; cashCustomerId: number; supplierId: number; variantId: number; sarrafId: number }> {
  accessFlags.readOnly = false
  await db.transaction('rw', [...SYNC_TABLES.map(table => db.table(table)), db.settings, db.syncState], async () => {
    for (const table of SYNC_TABLES) await db.table(table).clear()
    await db.settings.clear()
    await db.syncState.clear()
  })
  await db.settings.put({ key: 'directTrades.enabled', value: true })
  const productId = await db.products.add({ uuid: newUuid(), name: 'جنس قبلی', createdAt: 1 }) as number
  const variantId = await db.variants.add({ uuid: newUuid(), productId, size: '42', color: 'قهوه‌ای', purchasePrice: 500, retailPrice: 700, wholesalePrice: 650, stockQty: 0, lowStock: 0 }) as number
  await setOpeningStock(variantId, 32, 'جنس قبلی')
  const customerId = await db.customers.add({ uuid: newUuid(), name: 'مشتری مستقیم', type: 'wholesale', balance: 0 }) as number
  const cashCustomerId = await db.customers.add({ uuid: newUuid(), name: 'مشتری صندوق آزمایشی', type: 'wholesale', balance: 0 }) as number
  const supplierId = await db.suppliers.add({ uuid: newUuid(), name: 'فروشنده مستقیم', kind: 'supplier', balance: 0 }) as number
  const sarrafId = await db.suppliers.add({ uuid: newUuid(), name: 'صراف آزمایشی', kind: 'sarraf', balance: 0 }) as number
  await addOpeningDebt('customer', customerId, 'مشتری مستقیم', 1000, 'قرض قبلی مشتری')
  await addOpeningDebt('supplier', supplierId, 'فروشنده مستقیم', 2000, 'قرض قبلی فروشنده')
  await addPayment({ uuid: newUuid(), date: 1, partyType: 'customer', partyId: cashCustomerId, partyName: 'مشتری صندوق آزمایشی', amount: 20000 })
  await addPayment({ uuid: newUuid(), date: 1, partyType: 'supplier', partyId: sarrafId, partyName: 'صراف آزمایشی', amount: 4000 })
  await addSale({ uuid: newUuid(), date: 2, customerId: cashCustomerId, customerName: 'مشتری صندوق آزمایشی', saleType: 'wholesale',
    lines: [{ variantId, productName: 'جنس قبلی', size: '42', color: 'قهوه‌ای', qty: 2, unitPrice: 750 }], total: 1500, paid: 0 })
  equal([(await db.customers.get(customerId))?.balance, (await db.suppliers.get(supplierId))?.balance,
    (await db.suppliers.get(sarrafId))?.balance, (await db.variants.get(variantId))?.stockQty,
    (await db.variants.get(variantId))?.purchasePrice], [1000, 2000, -4000, 30, 500])
  return { customerId, cashCustomerId, supplierId, variantId, sarrafId }
}

export async function snapshot(): Promise<unknown> {
  return Object.fromEntries(await Promise.all(SYNC_TABLES.map(async table => [table, await db.table(table).toArray()])))
}

export async function warehouseSnapshot(): Promise<unknown> {
  return {
    variants: await db.variants.toArray(),
    ordinarySales: (await db.sales.filter(row => !row.directTrade).toArray()).map(row => ({ id: row.id, date: row.date, total: row.total, lines: row.lines }))
  }
}
