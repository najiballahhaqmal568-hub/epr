import { useRef, useState } from 'react'
import { db, type Payment } from '../../../db'
import { Field, inputCls, Modal, PrimaryBtn } from '../../../components/ui'
import { fmtMoney, fromDateInput, toDateInput } from '../../../lib/format'
import { correctDirectPayment, previewDirectPaymentCorrection, type DirectPaymentCorrectionInput, type DirectPaymentCorrectionPreview } from '../../../lib/directTradeCorrections'
import { syncNow } from '../../../lib/sync'
import { numberInput, routeLabels } from './directForm'
import { signed } from './directCorrectionFormat'

/** اصلاح مبلغ/تاریخ یا لغو یک پرداخت اشتباه فروش مستقیم — سند اصلی برای رد حساب می‌ماند. */
export default function DirectPaymentCorrectionForm({ tradeUuid, payment, cancelOnly, onClose, onSaved }: {
  tradeUuid: string; payment: Payment; cancelOnly: boolean; onClose: () => void; onSaved: () => void
}) {
  const route = payment.directPayment!.route
  const [action, setAction] = useState<'replace' | 'cancel'>(cancelOnly ? 'cancel' : 'replace')
  const [amount, setAmount] = useState(String(payment.amount))
  const [sarraf, setSarraf] = useState(String(payment.sarrafAmount ?? 0))
  const [date, setDate] = useState(toDateInput(payment.date))
  const [note, setNote] = useState(payment.note ?? '')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<DirectPaymentCorrectionPreview>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)

  const input = (): DirectPaymentCorrectionInput => action === 'cancel' ? { action, reason } : {
    action, reason, date: fromDateInput(date), amount: numberInput(amount), note,
    ...(route === 'supplierPayment' && payment.sarrafId !== undefined ? { sarrafAmount: numberInput(sarraf) } : {})
  }
  const changed = () => { setPreview(undefined); setConfirmed(false); setError('') }

  async function check() {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      if ((await db.settings.get('cachedProfile'))?.value) await syncNow(true)
      setPreview(await previewDirectPaymentCorrection(tradeUuid, payment.uuid!, input()))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { running.current = false; setBusy(false) }
  }
  async function save() {
    if (running.current || !preview?.allowed || !confirmed) return
    running.current = true; setBusy(true); setError('')
    try {
      await correctDirectPayment(tradeUuid, payment.uuid!, input(), preview.token)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPreview(undefined); setConfirmed(false) }
    finally { running.current = false; setBusy(false) }
  }

  return <Modal title={action === 'cancel' ? 'لغو پرداخت اشتباه' : 'اصلاح پرداخت'} onClose={() => { if (!running.current) onClose() }}>
    <fieldset disabled={busy} className="min-w-0">
      <p className="mb-3 text-sm"><b>{routeLabels[route]}</b>: {fmtMoney(payment.amount)}</p>
      {!cancelOnly && <div className="segmented mb-3" role="group" aria-label="نوع تغییر پرداخت">
        <button type="button" aria-pressed={action === 'replace'} onClick={() => { changed(); setAction('replace') }}>اصلاح مبلغ یا تاریخ</button>
        <button type="button" aria-pressed={action === 'cancel'} onClick={() => { changed(); setAction('cancel') }}>لغو کامل پرداخت</button>
      </div>}
      {cancelOnly && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">این معامله لغو شده است؛ پرداخت آن فقط لغو می‌شود.</p>}
      {action === 'replace' && <>
        <Field label="مبلغ درست"><input aria-label="مبلغ درست پرداخت" className={inputCls} inputMode="numeric" value={amount} onChange={e => { changed(); setAmount(e.target.value) }} /></Field>
        {route === 'supplierPayment' && payment.sarrafId !== undefined && <Field label={`سهم صراف (${payment.sarrafName ?? ''})`}><input aria-label="سهم صراف" className={inputCls} inputMode="numeric" value={sarraf} onChange={e => { changed(); setSarraf(e.target.value) }} /></Field>}
        <Field label="تاریخ پرداخت"><input aria-label="تاریخ پرداخت" className={inputCls} type="date" value={date} onChange={e => { changed(); setDate(e.target.value) }} /></Field>
        <Field label="یادداشت"><input aria-label="یادداشت پرداخت" className={inputCls} value={note} onChange={e => { changed(); setNote(e.target.value) }} /></Field>
      </>}
      <Field label={action === 'cancel' ? 'دلیل لغو *' : 'دلیل اصلاح *'}><input aria-label="دلیل تغییر پرداخت" className={inputCls} value={reason} onChange={e => { changed(); setReason(e.target.value) }} /></Field>
      {!preview && <PrimaryBtn disabled={busy} onClick={() => void check()}>{busy ? 'در حال بررسی…' : 'پیش‌نمایش'}</PrimaryBtn>}
      {preview && !preview.allowed && <div role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{preview.reasons.map((r, i) => <p key={i}>{r}</p>)}</div>}
      {preview?.allowed && <>
        <section aria-label="اثر تغییر پرداخت" className="mb-3 rounded-xl bg-[var(--action-tint)] p-3 text-sm">
          {route !== 'supplierPayment' && <p>قرض مشتری: {signed(preview.net.customer)}</p>}
          {route !== 'customerCash' && <p>قرض ما به فروشنده: {signed(preview.net.supplier)}</p>}
          {preview.net.cash.length === 0 ? <p>صندوق: تغییر نمی‌کند</p> : preview.net.cash.map(c => <p key={c.box}>صندوق «{c.box}»: {signed(c.delta)}</p>)}
          <p className="mt-1 text-xs text-slate-600">سند اصلی برای رد حساب می‌ماند؛ برگشت پول صندوق جدا ثبت می‌شود.</p>
        </section>
        <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> اثر این تغییر را بررسی کردم</label>
        <PrimaryBtn disabled={!confirmed || busy} onClick={() => void save()}>{busy ? 'در حال ثبت…' : action === 'cancel' ? 'لغو پرداخت' : 'ثبت اصلاح پرداخت'}</PrimaryBtn>
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </fieldset>
  </Modal>
}
