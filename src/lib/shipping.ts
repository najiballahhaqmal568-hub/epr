/** Money only: callers validate the sale, customer, date and cash box. */
export interface ShippingAmounts {
  total: number
  customerShare: number
  /** Cash received now for freight only, not the payment for shoes. */
  received: number
}

export interface ShippingCalculation extends ShippingAmounts {
  shopExpense: number
  customerDebt: number
  /** Net cash effect. Keep the gross payment and receipt in the cash ledger. */
  cashDelta: number
}

/**
 * Freight never changes shoe revenue, cost or stock. Only the shop's share
 * is an expense; the unpaid customer share is a receivable.
 * Round actual money to whole AFN, matching ops.afn, before subtraction so
 * cash, expense and debt always balance exactly.
 */
export function calculateShipping(input: ShippingAmounts): ShippingCalculation {
  for (const value of [input.total, input.customerShare, input.received]) {
    if (!Number.isFinite(value) || value < 0 || !Number.isSafeInteger(Math.round(value))) {
      throw new Error('مبلغ کرایه و سهم‌ها باید ارقام معتبر و غیرمنفی باشند')
    }
  }
  if (input.customerShare > input.total) throw new Error('سهم مشتری از کل کرایه بیشتر است')
  if (input.received > input.customerShare) throw new Error('دریافت نقدی از سهم کرایهٔ مشتری بیشتر است')

  const total = Math.round(input.total)
  const customerShare = Math.round(input.customerShare)
  const received = Math.round(input.received)
  if (total <= 0) throw new Error('مبلغ کرایه باید حداقل یک افغانی باشد')

  return {
    total,
    customerShare,
    received,
    shopExpense: total - customerShare,
    customerDebt: customerShare - received,
    cashDelta: received - total
  }
}
