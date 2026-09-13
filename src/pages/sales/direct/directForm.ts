import { newUuid } from '../../../db'
import { toLatinDigits } from '../../../lib/format'
import type { DirectPaymentInput, DirectPaymentRoute } from '../../../lib/directTradeTypes'

export const routeLabels: Record<DirectPaymentRoute, string> = {
  customerCash: 'دریافت از مشتری', supplierPayment: 'پرداخت به فروشنده', customerToSupplier: 'مشتری مستقیم به فروشنده داده'
}
export function numberInput(value: string): number {
  const normalized = toLatinDigits(value).replace(/[,،]/g, '').trim()
  return /^\d+$/.test(normalized) && Number.isSafeInteger(Number(normalized)) ? Number(normalized) : NaN
}
export function paymentDraft() {
  return { customerCash: '0', supplierPayment: '0', customerToSupplier: '0', sarrafAmount: '0', sarrafId: '', box: 'دکان', note: '',
    ids: { customerCash: newUuid(), supplierPayment: newUuid(), customerToSupplier: newUuid() } }
}
export type PaymentDraft = ReturnType<typeof paymentDraft>
export function paymentInputs(draft: PaymentDraft, date: number): DirectPaymentInput[] {
  const inputs: DirectPaymentInput[] = []
  for (const route of Object.keys(routeLabels) as DirectPaymentRoute[]) {
    const amount = numberInput(draft[route])
    if (!Number.isFinite(amount)) throw new Error('مبلغ پرداخت باید عدد صحیح و صفر یا بیشتر باشد.')
    if (amount === 0) continue
    inputs.push({ eventUuid: draft.ids[route], date, route, amount, note: draft.note,
      ...(route === 'customerToSupplier' ? {} : { box: draft.box }),
      ...(route === 'supplierPayment' && numberInput(draft.sarrafAmount) > 0 ? { sarrafId: Number(draft.sarrafId), sarrafAmount: numberInput(draft.sarrafAmount) } : {}) })
  }
  const sarraf = numberInput(draft.sarrafAmount)
  if (!Number.isFinite(sarraf) || sarraf > numberInput(draft.supplierPayment) || (sarraf > 0 && !draft.sarrafId)) throw new Error('سهم صراف و نام صراف را درست انتخاب کنید.')
  return inputs
}
