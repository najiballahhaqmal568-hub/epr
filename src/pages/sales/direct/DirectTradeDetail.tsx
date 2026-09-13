import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db } from '../../../db'
import { Modal } from '../../../components/ui'
import { fmtDate, fmtMoney, fmtNum } from '../../../lib/format'
import { loadDirectTrade } from '../../../lib/directTradeState'
import { syncNow } from '../../../lib/sync'
import SaleShipping from '../SaleShipping'
import DirectPaymentForm from './DirectPaymentForm'
import DirectReceipt from './DirectReceipt'
import { routeLabels } from './directForm'

export default function DirectTradeDetail({ tradeUuid, onClose, isStaff = false }: { tradeUuid: string; onClose: () => void; isStaff?: boolean }) {
  const [paying, setPaying] = useState(false)
  const [receipt, setReceipt] = useState(false)
  const [error, setError] = useState('')
  const result = useLiveQuery(async () => {
    try {
      const state = await loadDirectTrade(tradeUuid)
      const customer = state.sale?.customerId ? await db.customers.get(state.sale.customerId) : undefined
      const supplier = state.purchase?.supplierId ? await db.suppliers.get(state.purchase.supplierId) : undefined
      const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
      return { state, customer, supplier, staff: isStaff || profile?.role === 'staff', error: '' }
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }, [tradeUuid, isStaff])
  const state = result?.state
  const ready = state?.status === 'ready'
  const visiblePayments = state?.payments.filter(payment => !result?.staff || payment.directPayment?.route !== 'supplierPayment') ?? []
  return <Modal title="جزئیات فروش مستقیم" onClose={onClose}>
    {!result && <p role="status">در حال خواندن معامله…</p>}
    {result?.error && <p role="alert">{result.error}</p>}
    {state && <>
      <p className="mb-2 font-bold">{state.sale?.customerName} ← {state.purchase?.supplierName}</p>
      <p className="mb-3 text-xs text-slate-500">{fmtDate(state.sale?.date ?? state.purchase?.date ?? 0)} · ارسال مستقیم — بدون گدام</p>
      {!ready && <div role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm"><p>این معامله کامل و بدون تعارض نیست؛ پرداخت و رسید بسته است.</p>{state.issues.map((issue, i) => <p key={i}>{issue}</p>)}<button className="mt-2 p-2 font-bold" onClick={() => void syncNow(true).catch(e => setError(e instanceof Error ? e.message : String(e)))}>کوشش دوبارهٔ همگام‌سازی</button></div>}
      {state.sale?.directLines?.map(line => <div key={line.lineUuid} className="border-b border-slate-100 py-2 text-sm"><strong>{line.productName} {line.size} {line.color}</strong><p>{fmtNum(line.qty)} × {fmtMoney(line.unitPrice)}</p></div>)}
      <div className="my-3 rounded-xl bg-teal-50 p-3 text-sm"><p>مجموع فروش: {fmtMoney(state.totals.sale)}</p>{!result?.staff && <><p>مجموع خرید: {fmtMoney(state.totals.cost)}</p><p>مفاد: {fmtMoney(state.totals.profit)}</p></>}</div>
      <h3 className="font-bold">باقی‌ماندهٔ این معامله</h3><p className="text-sm">مشتری: {fmtMoney(state.balances.customerRemaining)}</p>{!result?.staff && <p className="mb-3 text-sm">فروشنده: {fmtMoney(state.balances.supplierRemaining)}</p>}
      <h3 className="font-bold">حساب کلی، همراه قرض‌های قبلی</h3><p className="text-sm">مشتری: {fmtMoney(result?.customer?.balance ?? 0)}</p>{!result?.staff && <p className="mb-3 text-sm">فروشنده: {fmtMoney(result?.supplier?.balance ?? 0)}</p>}
      <h3 className="mt-4 font-bold">پرداخت‌ها</h3>
      {visiblePayments.length === 0 && <p className="text-sm text-slate-500">پرداختی قابل نمایش نیست.</p>}
      {visiblePayments.map(payment => <div key={payment.uuid} className="border-b border-slate-100 py-2 text-sm"><p>{payment.directPayment ? routeLabels[payment.directPayment.route] : ''}: {fmtMoney(payment.amount)}</p><p className="text-xs text-slate-500">{fmtDate(payment.date)} · تغییر صندوق: {fmtMoney(payment.cashDelta ?? 0)}{payment.sarrafAmount ? ` · صراف: ${fmtMoney(payment.sarrafAmount)}` : ''}</p>{payment.note && <p>{payment.note}</p>}</div>)}
      <p className="my-3 text-xs text-amber-800">اصلاح، لغو و مرجوعی این معامله در نسخهٔ اولیه فعال نیست.</p>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><button disabled={!ready} className="rounded-xl bg-slate-100 p-3 font-bold disabled:opacity-40" onClick={() => setReceipt(true)}>رسید مشتری</button>{!accessFlags.readOnly && !result?.staff && <button disabled={!ready || !state.featureEnabled} className="rounded-xl bg-teal-700 p-3 font-bold text-white disabled:opacity-40" onClick={() => setPaying(true)}>پرداخت تازه</button>}</div>
      {ready && state.sale && !result?.staff && <SaleShipping sale={state.sale} />}
      {receipt && ready && <DirectReceipt state={state} onClose={() => setReceipt(false)} />}
      {paying && ready && <DirectPaymentForm state={state} onClose={() => setPaying(false)} onSaved={() => setPaying(false)} />}
    </>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
  </Modal>
}
