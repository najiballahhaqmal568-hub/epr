import { useRef, useState } from 'react'
import { accessFlags, db } from '../../../db'
import { Modal, Field, inputCls, PrimaryBtn } from '../../../components/ui'
import { fmtMoney, fromDateInput, toDateInput } from '../../../lib/format'
import { addDirectPayment } from '../../../lib/directTradeOps'
import { validateDirectPayments } from '../../../lib/directTradeMath'
import { loadDirectTrade, type DirectTradeState } from '../../../lib/directTradeState'
import type { DirectPaymentRoute } from '../../../lib/directTradeTypes'
import { syncNow } from '../../../lib/sync'
import DirectPaymentFields from './DirectPaymentFields'
import { paymentDraft, paymentInputs, routeLabels } from './directForm'

export default function DirectPaymentForm({ state: initial, onClose, onSaved }: { state: DirectTradeState; onClose: () => void; onSaved: () => void }) {
  const [state, setState] = useState(initial)
  const [route, setRoute] = useState<DirectPaymentRoute>('customerCash')
  const [draft, setDraft] = useState(paymentDraft)
  const [date, setDate] = useState(toDateInput(Date.now()))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  let valid = false
  let amount = 0
  try {
    const inputs = paymentInputs(draft, fromDateInput(date))
    validateDirectPayments(state.totals, state.payments, inputs)
    valid = inputs.length === 1 && state.status === 'ready' && state.featureEnabled && !!date && !accessFlags.readOnly
    amount = inputs[0]?.amount ?? 0
  } catch { /* Keep input available to correct it. */ }
  async function save() {
    if (!valid || busy.current) return
    busy.current = true; setSaving(true); setError('')
    const uuid = state.sale!.directTrade!.uuid
    try {
      // Signed-in business devices must refresh before allocating a later payment.
      if ((await db.settings.get('cachedProfile'))?.value) await syncNow(true)
      await addDirectPayment(uuid, paymentInputs(draft, fromDateInput(date))[0], state.token)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setState(await loadDirectTrade(uuid))
    } finally { busy.current = false; setSaving(false) }
  }
  return <Modal title="پرداخت فروش مستقیم" onClose={() => { if (!busy.current) onClose() }}>
    <fieldset disabled={saving} className="min-w-0">
      <Field label="نوع پرداخت"><select className={inputCls} value={route} onChange={e => { setRoute(e.target.value as DirectPaymentRoute); setDraft(paymentDraft()) }}>{(Object.keys(routeLabels) as DirectPaymentRoute[]).map(key => <option key={key} value={key}>{routeLabels[key]}</option>)}</select></Field>
      <Field label="تاریخ پرداخت"><input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <DirectPaymentFields value={draft} onChange={setDraft} supplierId={state.purchase?.supplierId} route={route} />
      <div className="mb-3 rounded-xl bg-teal-50 p-3 text-sm"><p>باقی مشتری: {fmtMoney(state.balances.customerRemaining - (valid && route !== 'supplierPayment' ? amount : 0))}</p><p>باقی فروشنده: {fmtMoney(state.balances.supplierRemaining - (valid && route !== 'customerCash' ? amount : 0))}</p></div>
      <p className="mb-3 text-xs text-amber-800">فقط تسویهٔ همین معامله؛ قرض‌های قبلی جدا هستند. اصلاح این پرداخت فعلاً فعال نیست.</p>
      {!valid && <p className="mb-3 text-sm text-slate-600">مبلغ معتبر، بیشتر از صفر و حداکثر برابر باقی‌ماندهٔ مربوط را وارد کنید.</p>}
      {error && <p role="alert" className="mb-3 text-red-700">{error} معلومات تازه شد؛ پیش از کوشش دوباره بررسی کنید.</p>}
      <PrimaryBtn disabled={!valid || saving} onClick={() => void save()}>{saving ? 'در حال ثبت…' : 'ثبت پرداخت مستقیم'}</PrimaryBtn>
    </fieldset>
  </Modal>
}
