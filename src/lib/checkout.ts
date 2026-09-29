import type { Sale, SaleLine, Variant } from '../db'
import { fromDateInput, parseNum } from './format'
import { calculateShipping } from './shipping'
import type { SaleShippingInput } from './ops'

/**
 * The checkout rules of the sale desk, in one place: what the customer owes, how the money the customer
 * handed over is read (cash / credit / part), when a sale is refused, and what the Sale document says.
 * The screen only collects the form and shows the answer; `ops.addSale` stays the authority that writes.
 *
 * Money is read from two form facts — the text in the «مبلغ دریافتی» box and whether the seller touched it
 * (`paidTouched`). Untouched means "the customer paid in full".
 */
export type PaymentMode = 'cash' | 'credit' | 'mixed'

export interface PaymentForm { subtotal: number; discountStr: string; paidStr: string; paidTouched: boolean }
export interface PaymentReading { discount: number; total: number; paid: number; remainder: number; mode: PaymentMode }

export function readPayment(form: PaymentForm): PaymentReading {
  // a discount can never be negative (that would raise the price) or bigger than the goods
  const discount = Math.min(Math.max(parseNum(form.discountStr), 0), form.subtotal)
  const total = form.subtotal - discount
  const paid = form.paidTouched ? parseNum(form.paidStr) : total
  const mode: PaymentMode = form.paidTouched && !form.paidStr.trim() ? 'mixed' : !form.paidTouched || paid >= total ? 'cash' : paid === 0 ? 'credit' : 'mixed'
  return { discount, total, paid, remainder: total - paid, mode }
}

/** What the «نقد / قرض / نقد و قرض» buttons write into the form. */
export function paymentFieldsFor(mode: PaymentMode): { paidTouched: boolean; paidStr: string } {
  return { paidTouched: mode !== 'cash', paidStr: mode === 'credit' ? '0' : '' }
}

export const saleSubtotal = (lines: readonly SaleLine[]): number => lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0)

/** True while any line asks for more than the shelf holds, has a bad quantity, or its size no longer exists. */
export function stockProblem(lines: readonly SaleLine[], variants: readonly Variant[] | undefined): boolean {
  if (!variants) return true
  const asked = new Map<number, number>()
  for (const line of lines) asked.set(line.variantId, (asked.get(line.variantId) ?? 0) + line.qty)
  return lines.some((line) => {
    const variant = variants.find((v) => v.id === line.variantId)
    return !variant || !Number.isInteger(line.qty) || line.qty <= 0 || (asked.get(line.variantId) ?? 0) > variant.stockQty
  })
}

export interface CheckoutForm extends PaymentForm {
  lines: readonly SaleLine[]
  variants: readonly Variant[] | undefined
  saleType: 'retail' | 'wholesale'
  customerId: number | ''
  shipping?: SaleShippingInput
  /** the «نقد» button: the customer paid the whole total, whatever the box says */
  cashOnly?: boolean
}
export type CheckoutRefusal = { message: string; needsCustomer?: boolean }

/** Why this sale cannot be saved yet, or null. The order of the checks is the order the seller should fix them in. */
export function checkoutRefusal(form: CheckoutForm): CheckoutRefusal | null {
  const reading = readPayment(form)
  const remainder = form.cashOnly ? 0 : reading.remainder
  if (!form.lines.length) return { message: 'حداقل یک جنس انتخاب کنید' }
  if (form.shipping && (form.saleType !== 'wholesale' || !form.customerId)) return { message: 'کرایه به مشتری عمده مربوط است؛ مشتری را انتخاب کنید یا کرایه را بردارید' }
  if (form.shipping) {
    try { calculateShipping(form.shipping) }
    catch { return { message: 'معلومات کرایه درست نیست؛ کرایه را باز و اصلاح کنید' } }
  }
  if (stockProblem(form.lines, form.variants)) return { message: 'موجودی بعضی سایزها کافی نیست یا تعداد درست نیست؛ سبد را اصلاح کنید' }
  if (!form.cashOnly && form.paidTouched && !form.paidStr.trim()) return { message: 'مبلغ نقد دریافتی را وارد کنید؛ اگر هیچ نقد نگرفته‌اید، گزینهٔ قرض را انتخاب کنید.' }
  if (remainder > 0 && !form.customerId) return { message: 'برای فروش قرضی باید مشتری انتخاب شود', needsCustomer: true }
  return null
}

export interface SaleFacts { customer?: { id?: number; name: string }; promise: string; bookPage: string }

/** The Sale document for a form that passed `checkoutRefusal`. Change is never kept: paid is at most the total. */
export function buildSale(form: CheckoutForm, facts: SaleFacts, now = Date.now()): Sale {
  const reading = readPayment(form)
  const paid = form.cashOnly ? reading.total : reading.paid
  const remainder = reading.total - paid
  return {
    date: now,
    customerId: form.customerId || undefined,
    customerName: facts.customer?.name,
    saleType: form.saleType,
    lines: [...form.lines],
    total: reading.total,
    paid: Math.min(paid, reading.total),
    discount: reading.discount > 0 ? reading.discount : undefined,
    promiseDate: remainder > 0 && facts.promise ? fromDateInput(facts.promise) : undefined,
    // the page only means something for credit; a cash sale is not written in the debt book
    bookPage: remainder > 0 && facts.bookPage.trim() ? facts.bookPage.trim() : undefined
  }
}
