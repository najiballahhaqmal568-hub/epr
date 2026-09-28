import { useRef, useState } from 'react'
import { db } from '../../../db'
import { Field, inputCls, Modal, PrimaryBtn } from '../../../components/ui'
import { fmtMoney, fromDateInput, toDateInput } from '../../../lib/format'
import { correctDirectTrade, previewDirectTradeCorrection, type DirectTradeCorrectionPreview } from '../../../lib/directTradeCorrections'
import type { DirectTradeState } from '../../../lib/directTradeState'
import { syncNow } from '../../../lib/sync'
import { numberInput } from './directForm'
import { signed } from './directCorrectionFormat'

type DraftLine = { lineUuid: string; productName: string; size: string; color: string; qty: string; unitCost: string; unitPrice: string }

/** اصلاح جنس، تعداد، قیمت یا تاریخ یک فروش مستقیم — با دلیل، پیش‌نمایش و تأیید. */
export default function DirectTradeCorrectionForm({ state, onClose, onSaved }: { state: DirectTradeState; onClose: () => void; onSaved: () => void }) {
  const sale = state.sale!
  const [date, setDate] = useState(toDateInput(sale.date))
  const [lines, setLines] = useState<DraftLine[]>(() => (sale.directLines ?? []).map(line => ({ ...line, qty: String(line.qty), unitCost: String(line.unitCost), unitPrice: String(line.unitPrice) })))
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<DirectTradeCorrectionPreview>()
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const running = useRef(false)
  const tradeUuid = sale.directTrade!.uuid

  const input = () => ({ date: fromDateInput(date), reason, lines: lines.map(line => ({
    lineUuid: line.lineUuid, productName: line.productName.trim(), size: line.size.trim(), color: line.color.trim(),
    qty: numberInput(line.qty), unitCost: numberInput(line.unitCost), unitPrice: numberInput(line.unitPrice)
  })) })
  const changed = () => { setPreview(undefined); setConfirmed(false); setError('') }
  const setLine = (index: number, key: keyof DraftLine, value: string) => { changed(); setLines(lines.map((line, i) => i === index ? { ...line, [key]: value } : line)) }

  async function check() {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      // دستگاه‌های وصل به سرور پیش از اصلاح تازه می‌شوند تا نسخهٔ کهنه اصلاح نشود.
      if ((await db.settings.get('cachedProfile'))?.value) await syncNow(true)
      setPreview(await previewDirectTradeCorrection(tradeUuid, input()))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { running.current = false; setBusy(false) }
  }
  async function save() {
    if (running.current || !preview?.allowed || !confirmed) return
    running.current = true; setBusy(true); setError('')
    try {
      await correctDirectTrade(tradeUuid, input(), preview.token)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setPreview(undefined); setConfirmed(false) }
    finally { running.current = false; setBusy(false) }
  }

  return <Modal title="اصلاح فروش مستقیم" onClose={() => { if (!running.current) onClose() }}>
    <fieldset disabled={busy} className="min-w-0">
      <p className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">مشتری و فروشنده عوض نمی‌شوند. نسخهٔ قبلی با دلیل در سابقهٔ معامله می‌ماند.</p>
      <Field label="تاریخ معامله"><input aria-label="تاریخ معامله" className={inputCls} type="date" value={date} onChange={e => { changed(); setDate(e.target.value) }} /></Field>
      {lines.map((line, index) => <section key={line.lineUuid} aria-label={`جنس ${index + 1}`} className="mb-3 rounded-xl border border-slate-200 p-3">
        <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-3">
          <Field label="نام / مدل"><input aria-label={`نام جنس ${index + 1}`} className={inputCls} value={line.productName} onChange={e => setLine(index, 'productName', e.target.value)} /></Field>
          <Field label="سایز"><input aria-label={`سایز ${index + 1}`} className={inputCls} value={line.size} onChange={e => setLine(index, 'size', e.target.value)} /></Field>
          <Field label="رنگ"><input aria-label={`رنگ ${index + 1}`} className={inputCls} value={line.color} onChange={e => setLine(index, 'color', e.target.value)} /></Field>
          <Field label="تعداد جوره"><input aria-label={`تعداد ${index + 1}`} className={inputCls} inputMode="numeric" value={line.qty} onChange={e => setLine(index, 'qty', e.target.value)} /></Field>
          <Field label="قیمت خرید فی جوره"><input aria-label={`قیمت خرید ${index + 1}`} className={inputCls} inputMode="numeric" value={line.unitCost} onChange={e => setLine(index, 'unitCost', e.target.value)} /></Field>
          <Field label="قیمت فروش فی جوره"><input aria-label={`قیمت فروش ${index + 1}`} className={inputCls} inputMode="numeric" value={line.unitPrice} onChange={e => setLine(index, 'unitPrice', e.target.value)} /></Field>
        </div>
      </section>)}
      <Field label="دلیل اصلاح *"><input aria-label="دلیل اصلاح معامله" className={inputCls} value={reason} onChange={e => { changed(); setReason(e.target.value) }} /></Field>
      {!preview && <PrimaryBtn disabled={busy} onClick={() => void check()}>{busy ? 'در حال بررسی…' : 'پیش‌نمایش اصلاح'}</PrimaryBtn>}
      {preview && !preview.allowed && <div role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">{preview.reasons.map((reason, i) => <p key={i}>{reason}</p>)}</div>}
      {preview?.allowed && <>
        <section aria-label="اثر اصلاح" className="mb-3 rounded-xl bg-[var(--action-tint)] p-3 text-sm">
          <p className="mb-1 font-bold">تغییر نسبت به نسخهٔ فعلی:</p>
          <p>قرض مشتری: {signed(preview.net.customer)}</p>
          <p>قرض ما به فروشنده: {signed(preview.net.supplier)}</p>
          <p>مفاد: {signed(preview.net.profit)}</p>
          <p className="mt-1 text-xs text-slate-600">صندوق و گدام تغییر نمی‌کنند. مجموع تازه: فروش {fmtMoney(preview.next?.sale ?? 0)} · خرید {fmtMoney(preview.next?.cost ?? 0)}</p>
        </section>
        <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /> اثر این اصلاح را بررسی کردم</label>
        <PrimaryBtn disabled={!confirmed || busy} onClick={() => void save()}>{busy ? 'در حال ثبت…' : 'ثبت اصلاح'}</PrimaryBtn>
      </>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </fieldset>
  </Modal>
}
