import type { Payment } from '../src/db'
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
