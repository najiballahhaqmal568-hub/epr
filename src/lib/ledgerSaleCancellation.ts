import { accessFlags, db, saleCreditAmount } from '../db'
import { deleteSale, deleteSaleImpact } from './ops'

// This shortcut must not cascade into other documents. Complex sales stay in
// their existing management flow; the transaction rechecks after the preview.
export async function ledgerSaleCancellationPreview(saleId: number, customerId: number) {
  const sale = await db.sales.get(saleId)
  if (!sale || sale.deleted || sale.customerId !== customerId) throw new Error('این فروش دیگر در حساب این مشتری موجود نیست.')
  if (sale.groupUuid || sale.lenderAction || sale.expenseCreditorId || sale.cashPaid !== undefined) throw new Error('این فروش به تسویه یا تبادله مربوط است؛ از جزئیات فروش بررسی کنید.')
  const impact = await deleteSaleImpact(saleId)
  if (!impact || impact.linkedReturns) throw new Error('این فروش مرجوعی متصل دارد؛ از تاریخچهٔ فروش بررسی کنید تا سند دیگری اشتباه باطل نشود.')
  if (sale.uuid && await db.payments.filter(p => !p.deleted && p.shipping?.saleUuid === sale.uuid).first()) throw new Error('این فروش کرایهٔ بار دارد؛ ابتدا کرایه را از جزئیات فروش بررسی کنید.')
  const customer = await db.customers.get(customerId)
  if (!customer || customer.deleted) throw new Error('حساب مشتری موجود نیست.')
  const stock = []
  for (const line of sale.lines) {
    const variant = await db.variants.get(line.variantId)
    if (!variant || variant.deleted) throw new Error('یکی از اجناس این فروش در گدام پیدا نشد؛ نخست موجودی را بررسی کنید.')
    stock.push({ ...line, before: variant.stockQty })
  }
  return { sale, stock, cash: impact, debtBefore: customer.balance, debtAfter: customer.balance - saleCreditAmount(sale) }
}

export type LedgerSaleCancellationPreview = Awaited<ReturnType<typeof ledgerSaleCancellationPreview>>

export async function cancelLedgerSale(saleId: number, customerId: number, reason: string, preview: LedgerSaleCancellationPreview) {
  if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
  if (!reason.trim()) throw new Error('دلیل ابطال را وارد کنید.')
  await db.transaction('rw', [db.sales, db.payments, db.variants, db.customers, db.suppliers, db.cashMovements, db.purchases, db.adjustments, db.returns], async () => {
    const latest = await ledgerSaleCancellationPreview(saleId, customerId)
    if (JSON.stringify(latest) !== JSON.stringify(preview)) throw new Error('اطلاعات تغییر کرده است؛ اثر تازه را بررسی و دوباره تأیید کنید.')
    if (accessFlags.readOnly) throw new Error('حساب شما فقط اجازهٔ مشاهده دارد.')
    await deleteSale(saleId)
    await db.sales.update(saleId, { cancelledReason: reason.trim(), cancelledAt: Date.now() })
  })
}
