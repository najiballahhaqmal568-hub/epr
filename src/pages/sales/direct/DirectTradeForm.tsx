import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, newUuid } from '../../../db'
import { Field, inputCls, Modal, PrimaryBtn } from '../../../components/ui'
import { fmtMoney, fromDateInput, toDateInput } from '../../../lib/format'
import { createDirectTrade } from '../../../lib/directTradeOps'
import { directTotals, validateDirectPayments } from '../../../lib/directTradeMath'
import { directFeatureEnabled } from '../../../lib/directTradeState'
import DirectPaymentFields from './DirectPaymentFields'
import { numberInput, paymentDraft, paymentInputs } from './directForm'

const blankLine = () => ({ lineUuid: newUuid(), productName: '', size: '', color: '', qty: '', unitCost: '', unitPrice: '' })
export default function DirectTradeForm({ onClose, onSaved, onPendingChange }: {
  onClose: () => void; onSaved: (uuid: string) => void; onPendingChange?: (pending: boolean) => void
}) {
  const [tradeUuid] = useState(newUuid)
  const [date, setDate] = useState(toDateInput(Date.now()))
  const [customerId, setCustomer] = useState('')
  const [supplierId, setSupplier] = useState('')
  const [lines, setLines] = useState([blankLine()])
  const [payments, setPayments] = useState(paymentDraft)
  const [confirmed, setConfirmed] = useState(false)
  const [lossConfirmed, setLossConfirmed] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const enabled = useLiveQuery(directFeatureEnabled, [])
  const customers = useLiveQuery(() => db.customers.filter(c => !c.deleted).toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.filter(s => !s.deleted && (!s.kind || s.kind === 'supplier')).toArray(), [])
  let preview: { cost: number; sale: number; profit: number; customer: number; supplier: number; cash: number } | undefined
  let invalid = ''
  const snapshots = lines.map(line => ({ ...line, qty: numberInput(line.qty), unitCost: numberInput(line.unitCost), unitPrice: numberInput(line.unitPrice) }))
  const belowCost = snapshots.some(line => line.unitPrice < line.unitCost)
  try {
    if (!date || !Number.isFinite(fromDateInput(date))) throw new Error('تاریخ معتبر را انتخاب کنید.')
    const totals = directTotals(snapshots)
    const inputs = paymentInputs(payments, fromDateInput(date))
    validateDirectPayments(totals, [], inputs)
    preview = { ...totals, customer: totals.sale - numberInput(payments.customerCash) - numberInput(payments.customerToSupplier),
      supplier: totals.cost - numberInput(payments.supplierPayment) - numberInput(payments.customerToSupplier),
      cash: numberInput(payments.customerCash) - numberInput(payments.supplierPayment) + numberInput(payments.sarrafAmount) }
  } catch { invalid = 'نام، سایز، رنگ، تعداد و قیمت‌ها را کامل و درست بنویسید؛ پرداخت نباید از باقی‌مانده بیشتر باشد.' }
  const valid = !!preview && !!customerId && !!supplierId && confirmed && (!belowCost || lossConfirmed) && enabled && !accessFlags.readOnly
  async function save() {
    if (!valid || busy.current) return
    busy.current = true; setSaving(true); setError(''); onPendingChange?.(true)
    try {
      const result = await createDirectTrade({ tradeUuid, date: fromDateInput(date), customerId: Number(customerId), supplierId: Number(supplierId), lines: snapshots, payments: paymentInputs(payments, fromDateInput(date)) })
      onSaved(result.tradeUuid)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; setSaving(false); onPendingChange?.(false) }
  }
  return <Modal title="فروش مستقیم" onClose={() => { if (!busy.current && confirm('فرم ثبت‌نشده بسته شود؟')) onClose() }}>
    <p className="mb-4 text-sm text-slate-600">جنس از فروشنده مستقیم به مشتری می‌رود؛ موجودی گدام تغییر نمی‌کند.</p>
    <fieldset disabled={saving} className="min-w-0">
      <Field label="مشتری"><select aria-label="مشتری" className={inputCls} value={customerId} onChange={e => { setConfirmed(false); setCustomer(e.target.value) }}><option value="">انتخاب مشتری</option>{customers?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="فروشنده"><select aria-label="فروشنده" className={inputCls} value={supplierId} onChange={e => { setConfirmed(false); setSupplier(e.target.value) }}><option value="">انتخاب فروشنده</option>{suppliers?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      {(!customers?.length || !suppliers?.length) && <p className="mb-3 text-sm text-amber-800">مشتری و فروشنده را نخست در بخش حساب‌ها اضافه کنید.</p>}
      <Field label="تاریخ معامله"><input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      {lines.map((line, index) => <section className="mb-3 rounded-xl border border-slate-200 p-3" key={line.lineUuid} aria-label={`جنس ${index + 1}`}>
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
          {([['productName', 'نام جنس'], ['size', 'سایز'], ['color', 'رنگ'], ['qty', 'تعداد جوره'], ['unitCost', 'قیمت خرید فی جوره'], ['unitPrice', 'قیمت فروش فی جوره']] as const).map(([key, label]) => <Field key={key} label={label}>
            <input className={inputCls} inputMode={['qty', 'unitCost', 'unitPrice'].includes(key) ? 'numeric' : 'text'} value={line[key]} onChange={e => { setConfirmed(false); setLossConfirmed(false); setLines(lines.map((item, n) => n === index ? { ...item, [key]: e.target.value } : item)) }} />
          </Field>)}
        </div>
        {lines.length > 1 && <button className="p-2 text-sm text-red-700" onClick={() => { setConfirmed(false); setLines(lines.filter((_, n) => n !== index)) }}>حذف این جنس</button>}
      </section>)}
      <button className="w-full rounded-xl bg-slate-100 p-3 font-bold" onClick={() => { setConfirmed(false); setLines([...lines, blankLine()]) }}>افزودن جنس دیگر</button>
      <DirectPaymentFields value={payments} onChange={next => { setConfirmed(false); setPayments(next) }} supplierId={Number(supplierId)} />
      {preview && <section aria-live="polite" className="mb-3 rounded-xl bg-teal-50 p-3 text-sm">
        <p>مجموع خرید: {fmtMoney(preview.cost)}</p><p>مجموع فروش: {fmtMoney(preview.sale)}</p><p>مفاد / زیان: {fmtMoney(preview.profit)}</p>
        <p>باقی مشتری: {fmtMoney(preview.customer)}</p><p>باقی فروشنده: {fmtMoney(preview.supplier)}</p><p>تغییر صندوق: {fmtMoney(preview.cash)}</p>
      </section>}
      {belowCost && <label className="mb-3 block text-sm text-red-700"><input type="checkbox" checked={lossConfirmed} onChange={e => setLossConfirmed(e.target.checked)} /> فروش زیر قیمت خرید را تأیید می‌کنم</label>}
      <p className="mb-2 text-sm text-amber-800">اصلاح و لغو فروش مستقیم در این نسخه فعال نیست. کرایهٔ بار پس از ثبت، از جزئیات معامله اضافه می‌شود.</p>
      <label className="mb-4 block text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> معلومات معامله را بررسی کردم</label>
      {!enabled && <p role="alert" className="mb-3 text-amber-800">نخست به‌روزرسانی همهٔ دستگاه‌ها را تأیید و فروش مستقیم را فعال کنید.</p>}
      {invalid && <p className="mb-3 text-xs text-slate-500">{invalid}</p>}
      {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
      <PrimaryBtn disabled={!valid || saving} onClick={() => void save()}>{saving ? 'در حال ثبت…' : 'ثبت معامله'}</PrimaryBtn>
    </fieldset>
  </Modal>
}
