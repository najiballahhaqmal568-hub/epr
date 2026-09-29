import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type Payment } from '../../../db'
import { Field, inputCls, Modal, PrimaryBtn, Skeleton } from '../../../components/ui'
import { fmtDate, fmtMoney, fmtNum } from '../../../lib/format'
import { loadDirectTrade } from '../../../lib/directTradeState'
import { cancelDirectTrade, previewDirectTradeCancellation, type DirectTradeCancellationPreview } from '../../../lib/directTradeCorrections'
import { syncNow } from '../../../lib/sync'
import SaleShipping from '../SaleShipping'
import DirectPaymentForm from './DirectPaymentForm'
import DirectPaymentCorrectionForm from './DirectPaymentCorrectionForm'
import DirectTradeCorrectionForm from './DirectTradeCorrectionForm'
import DirectReceipt from './DirectReceipt'
import { routeLabels } from './directForm'
import { signed } from './directCorrectionFormat'

export default function DirectTradeDetail({ tradeUuid, onClose, isStaff = false }: { tradeUuid: string; onClose: () => void; isStaff?: boolean }) {
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [fixingPayment, setFixingPayment] = useState<Payment | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelPreview, setCancelPreview] = useState<DirectTradeCancellationPreview>()
  const [cancelConfirmed, setCancelConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const [error, setError] = useState('')
  const result = useLiveQuery(async () => {
    try {
      const state = await loadDirectTrade(tradeUuid)
      const customer = state.sale?.customerId ? await db.customers.get(state.sale.customerId) : undefined
      const supplier = state.purchase?.supplierId ? await db.suppliers.get(state.purchase.supplierId) : undefined
      const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
      return { state, customer, supplier, staff: isStaff || profile?.role === 'staff', owner: !isStaff && profile?.role === 'owner', error: '' }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }, [tradeUuid, isStaff])
  const state = result?.state
  const ready = state?.status === 'ready'
  const cancelled = state?.status === 'cancelled'
  // Corrections are owner-only and need the direct-sale compatibility gate; the operations re-check this.
  const canManage = Boolean(!isStaff && result?.owner && !accessFlags.readOnly && state?.featureEnabled)
  const visiblePayments = state?.payments.filter(payment => !result?.staff || payment.directPayment?.route !== 'supplierPayment') ?? []
  const history = state?.sale?.directTrade?.corrections ?? []
  const resetCancel = () => { setCancelPreview(undefined); setCancelConfirmed(false); setError('') }

  async function previewCancel() {
    if (running.current) return
    running.current = true; setBusy(true); setError('')
    try {
      if ((await db.settings.get('cachedProfile'))?.value) await syncNow(true)
      setCancelPreview(await previewDirectTradeCancellation(tradeUuid))
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { running.current = false; setBusy(false) }
  }
  async function cancel() {
    if (running.current || !cancelPreview?.allowed || !cancelConfirmed) return
    running.current = true; setBusy(true); setError('')
    try {
      await cancelDirectTrade(tradeUuid, cancelReason, cancelPreview.token)
      setCancelOpen(false); resetCancel()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setCancelPreview(undefined); setCancelConfirmed(false) }
    finally { running.current = false; setBusy(false) }
  }

  return <Modal title="جزئیات فروش مستقیم" onClose={onClose}>
    {!result && <Skeleton rows={4} label="در حال خواندن معامله…" />}
    {result?.error && <p role="alert">{result.error}</p>}
    {state && <>
      <p className="mb-2 font-bold">{state.sale?.customerName} ← {state.purchase?.supplierName}</p>
      <p className="mb-3 text-xs text-slate-500">{fmtDate(state.sale?.date ?? state.purchase?.date ?? 0)} · ارسال مستقیم — بدون گدام</p>
      {cancelled && <div role="status" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">
        <p className="font-bold">این معامله لغو شده است{state.sale?.cancelledAt ? ` — ${fmtDate(state.sale.cancelledAt)}` : ''}.</p>
        {state.sale?.cancelledReason && <p>دلیل: {state.sale.cancelledReason}</p>}
        <p className="mt-1 text-xs">قرض و مفاد این معامله از حساب‌ها برداشته شد. پول‌هایی که واقعاً پرداخت شده بود در حساب مشتری و فروشنده مانده است.</p>
      </div>}
      {!ready && !cancelled && <div role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm"><p>این معامله کامل و بدون تعارض نیست؛ پرداخت و رسید بسته است.</p>{state.issues.map((issue, i) => <p key={i}>{issue}</p>)}<button className="mt-2 p-2 font-bold" onClick={() => void syncNow(true).catch(e => setError(e instanceof Error ? e.message : String(e)))}>کوشش دوبارهٔ همگام‌سازی</button></div>}
      {state.sale?.directLines?.map(line => <div key={line.lineUuid} className="border-b border-slate-100 py-2 text-sm"><strong>{line.productName} {line.size} {line.color}</strong><p>{fmtNum(line.qty)} × {fmtMoney(line.unitPrice)}</p></div>)}
      <div className="my-3 rounded-xl bg-slate-50 p-3 text-sm"><p>مجموع فروش: {fmtMoney(state.totals.sale)}</p>{!result?.staff && <><p>مجموع خرید: {fmtMoney(state.totals.cost)}</p><p>مفاد: {cancelled ? `${fmtMoney(0)} (لغو شده)` : fmtMoney(state.totals.profit)}</p></>}</div>
      {!cancelled && <><h3 className="font-bold">باقی‌ماندهٔ این معامله</h3><p className="text-sm">مشتری: {fmtMoney(state.balances.customerRemaining)}</p>{!result?.staff && <p className="mb-3 text-sm">فروشنده: {fmtMoney(state.balances.supplierRemaining)}</p>}</>}
      <h3 className="font-bold">حساب کلی، همراه قرض‌های قبلی</h3><p className="text-sm">مشتری: {fmtMoney(result?.customer?.balance ?? 0)}</p>{!result?.staff && <p className="mb-3 text-sm">فروشنده: {fmtMoney(result?.supplier?.balance ?? 0)}</p>}
      <h3 className="mt-4 font-bold">پرداخت‌ها</h3>
      {visiblePayments.length === 0 && <p className="text-sm text-slate-500">پرداختی قابل نمایش نیست.</p>}
      {visiblePayments.map(payment => <div key={payment.uuid} className="border-b border-slate-100 py-2 text-sm">
        <p>{payment.directPayment ? routeLabels[payment.directPayment.route] : ''}: {fmtMoney(payment.amount)}</p>
        <p className="text-xs text-slate-500">{fmtDate(payment.date)} · تغییر صندوق: {fmtMoney(payment.cashDelta ?? 0)}{payment.sarrafAmount ? ` · صراف: ${fmtMoney(payment.sarrafAmount)}` : ''}</p>
        {payment.note && <p>{payment.note}</p>}
        {payment.correctionReason && <p className="text-xs text-amber-800">اصلاح‌شده از {fmtMoney(payment.correctionPrevious?.amount ?? 0)} — دلیل: {payment.correctionReason}</p>}
        {canManage && (ready || cancelled) && <button className="mt-1 text-xs font-bold text-[var(--action)]" onClick={() => setFixingPayment(payment)}>{cancelled ? 'لغو این پرداخت اشتباه' : 'اصلاح یا لغو این پرداخت'}</button>}
      </div>)}
      {history.length > 0 && !result?.staff && <details className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
        <summary className="font-bold">سابقهٔ اصلاح ({fmtNum(history.length)})</summary>
        {[...history].reverse().map(entry => <div key={entry.revision} className="mt-2 border-t border-slate-100 pt-2">
          <p className="text-xs text-slate-500">{fmtDate(entry.correctedAt)} — دلیل: {entry.reason}</p>
          <p>نسخهٔ قبلی: {fmtDate(entry.date)} · {entry.lines.map(line => `${line.productName} ${line.size} ${line.color} ×${fmtNum(line.qty)} (خرید ${fmtMoney(line.unitCost)}، فروش ${fmtMoney(line.unitPrice)})`).join('، ')}</p>
        </div>)}
      </details>}
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><button disabled={!ready} className="rounded-xl bg-slate-100 p-3 font-bold disabled:opacity-40" onClick={() => setReceipt(true)}>رسید مشتری</button>{!accessFlags.readOnly && !result?.staff && <button disabled={!ready || !state.featureEnabled} className="rounded-xl bg-[var(--action)] p-3 font-bold text-white disabled:opacity-40" onClick={() => setPaying(true)}>پرداخت تازه</button>}</div>
      {canManage && ready && <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button className="party-action" onClick={() => setCorrecting(true)}>اصلاح معامله</button>
        <button className="party-action text-red-700" aria-expanded={cancelOpen} onClick={() => { setCancelOpen(!cancelOpen); resetCancel() }}>لغو معامله</button>
      </div>}
      {!canManage && !cancelled && !result?.staff && <p className="mt-3 text-xs text-slate-500">اصلاح و لغو فروش مستقیم فقط برای مالک است.</p>}
      {canManage && ready && cancelOpen && <section aria-label="لغو معامله" className="mt-3 rounded-xl border border-red-200 p-3">
        <p className="mb-2 text-xs text-slate-600">فقط برای معامله‌ای که اشتباه ثبت شده است؛ برای جنس واقعاً برگشته نیست. پول پرداخت‌شده خودکار برگردانده نمی‌شود.</p>
        <Field label="دلیل لغو *"><input aria-label="دلیل لغو معامله" className={inputCls} value={cancelReason} disabled={busy} onChange={e => { resetCancel(); setCancelReason(e.target.value) }} /></Field>
        {!cancelPreview && <button type="button" disabled={busy || !cancelReason.trim()} className="w-full rounded-xl bg-red-50 p-3 font-bold text-red-700 disabled:opacity-40" onClick={() => void previewCancel()}>{busy ? 'در حال بررسی…' : 'پیش‌نمایش لغو'}</button>}
        {cancelPreview && !cancelPreview.allowed && <div role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{cancelPreview.reasons.map((r, i) => <p key={i}>{r}</p>)}</div>}
        {cancelPreview?.allowed && <>
          <div aria-label="اثر لغو" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-900">
            <p>قرض مشتری: {signed(cancelPreview.net.customer)}</p>
            <p>قرض ما به فروشنده: {signed(cancelPreview.net.supplier)}</p>
            <p>مفاد: {signed(cancelPreview.net.profit)}</p>
            <p className="mt-1">پول‌هایی که می‌مانند: دریافت نقد از مشتری {fmtMoney(cancelPreview.retained.customerCash)} · پرداخت به فروشنده {fmtMoney(cancelPreview.retained.supplierPaid)} · مشتری مستقیم به فروشنده {fmtMoney(cancelPreview.retained.customerToSupplier)}</p>
            <p className="mt-1 text-xs">صندوق و گدام تغییر نمی‌کنند. اگر پرداختی هم اشتباه بوده، بعد از لغو آن را جدا لغو کنید.</p>
          </div>
          <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={cancelConfirmed} onChange={e => setCancelConfirmed(e.target.checked)} /> اثر لغو را بررسی کردم</label>
          <PrimaryBtn disabled={!cancelConfirmed || busy} onClick={() => void cancel()}>{busy ? 'در حال لغو…' : 'تأیید لغو معامله'}</PrimaryBtn>
        </>}
      </section>}
      {ready && state.sale && !result?.staff && <SaleShipping sale={state.sale} />}
      {receipt && ready && <DirectReceipt state={state} onClose={() => setReceipt(false)} />}
      {paying && ready && <DirectPaymentForm state={state} onClose={() => setPaying(false)} onSaved={() => setPaying(false)} />}
      {correcting && ready && <DirectTradeCorrectionForm state={state} onClose={() => setCorrecting(false)} onSaved={() => setCorrecting(false)} />}
      {fixingPayment && <DirectPaymentCorrectionForm tradeUuid={tradeUuid} payment={fixingPayment} cancelOnly={cancelled} onClose={() => setFixingPayment(null)} onSaved={() => setFixingPayment(null)} />}
    </>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </Modal>
}
