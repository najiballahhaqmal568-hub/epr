import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db } from '../../db'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format'
import { cancelCustomerGoodsReceipt, loadCustomerGoodsReceipt, previewCustomerGoodsReceiptCancellation } from '../../lib/customerGoodsReceiptOps'
import { syncNow } from '../../lib/sync'
import CustomerGoodsReceiptModal from './CustomerGoodsReceiptModal'
import ReceiptModal from '../sales/Receipt'
import InvoiceModal from '../sales/InvoiceModal'

export default function CustomerGoodsReceiptDetail({ receiptUuid, onClose, syncBeforeMutation = () => syncNow(true) }: { receiptUuid: string; onClose: () => void; syncBeforeMutation?: () => Promise<void> }) {
  const [correcting, setCorrecting] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelToken, setCancelToken] = useState('')
  const [cancelReasons, setCancelReasons] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receiptOpen, setReceiptOpen] = useState(false)
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const result = useLiveQuery(async () => {
    try {
      const state = await loadCustomerGoodsReceipt(receiptUuid)
      const source = state.payment ? await db.customers.get(state.payment.partyId) : undefined
      const buyer = state.sale?.customerId ? await db.customers.get(state.sale.customerId) : undefined
      const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
      return { state, source, buyer, owner: profile?.role === 'owner', staff: profile?.role === 'staff' || profile?.role === 'viewer', error: '' }
    } catch (caught) { return { error: caught instanceof Error ? caught.message : String(caught) } }
  }, [receiptUuid])
  const state = result?.state
  const snapshot = state?.payment?.goodsReceipt?.snapshot
  const mutable = state?.status === 'ready' && state.featureEnabled && !accessFlags.readOnly && result?.owner === true
  const buyerPrintReady = state?.status === 'ready' && snapshot?.destination === 'onward' && Boolean(state.sale)

  async function prepareCancel() {
    if (!cancelReason.trim()) { setError('دلیل ابطال را بنویسید.'); return }
    setBusy(true); setError(''); setCancelReasons([])
    try {
      await syncBeforeMutation()
      const preview = await previewCustomerGoodsReceiptCancellation(receiptUuid)
      setCancelToken(preview.token)
      setCancelReasons(preview.writeBlockReasons)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  async function cancel() {
    if (!cancelToken || busy) return
    setBusy(true); setError('')
    try {
      await cancelCustomerGoodsReceipt(receiptUuid, cancelToken, cancelReason.trim())
      setCancelToken('')
    } catch (caught) {
      setCancelToken('')
      setError(`${caught instanceof Error ? caught.message : String(caught)}\nاطلاعات تغییر کرده است؛ دوباره پیش‌نمایش بگیرید.`)
    } finally { setBusy(false) }
  }
  return <Modal title="جزئیات دریافت جنس بابت طلب" onClose={onClose}>
    {!result && <p role="status">در حال خواندن سند…</p>}
    {result?.error && <p role="alert" className="text-red-700">{result.error}</p>}
    {state && <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="font-bold">{result?.source?.name ?? state.payment?.partyName ?? 'مشتری'}</p><span className={`rounded-full px-2 py-1 text-xs font-bold ${state.status === 'ready' ? 'bg-emerald-50 text-emerald-800' : state.status === 'cancelled' ? 'bg-slate-100 text-slate-700' : 'bg-amber-50 text-amber-900'}`}>{state.status === 'ready' ? 'فعال' : state.status === 'cancelled' ? 'باطل‌شده' : state.status === 'conflict' ? 'تعارض همگام‌سازی' : 'سند ناتمام'}</span></div>
      <p className="mb-3 text-xs text-slate-500">{snapshot ? fmtDate(snapshot.date) : 'تاریخ نامعلوم'} · {snapshot?.destination === 'warehouse' ? 'ورود به گدام' : 'فروش بعدی بدون گدام'}</p>
      {!['ready', 'cancelled'].includes(state.status) && <div role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">این سند تا تکمیل همگام‌سازی قابل اصلاح یا ابطال نیست.</p>{state.issues.map((issue, index) => <p key={index}>{issue}</p>)}<button type="button" className="mt-2 rounded-lg bg-white px-3 py-2 font-bold" onClick={() => void syncNow(true).catch(caught => setError(caught instanceof Error ? caught.message : String(caught)))}>کوشش دوبارهٔ همگام‌سازی</button></div>}
      {snapshot?.lines.map(line => <article key={line.lineUuid} className="border-b border-slate-100 py-2 text-sm"><p className="font-bold">{line.productName} · {line.size} · {line.color}</p><p>{fmtNum(line.qty)} جوره{!result?.staff && <> × قیمت توافقی {fmtMoney(line.unitCost)}</>}</p>{snapshot.destination === 'onward' && <p>قیمت فروش فی جوره: {fmtMoney(line.unitPrice ?? 0)}</p>}{line.photo && <img src={line.photo} alt={`عکس ${line.productName}`} className="mt-2 h-20 w-20 rounded-xl object-cover" />}</article>)}
      <section className="my-3 rounded-xl bg-teal-50 p-3 text-sm">{!result?.staff && <p>ارزش دریافت: {fmtMoney(state.totals.value)} · {fmtNum(state.totals.pairs)} جوره</p>}{snapshot?.destination === 'warehouse' ? <p>موجودی اضافه‌شده: {fmtNum(state.totals.pairs)} جوره</p> : <><p>خریدار: {result?.buyer?.name ?? state.sale?.customerName}</p><p>فروش: {fmtMoney(state.totals.sale)} · نقد: {fmtMoney(state.totals.cash)}</p><p>قرض خریدار: {fmtMoney(state.totals.buyerDebt)}</p>{!result?.staff && <p>مفاد: {fmtMoney(state.totals.profit)}</p>}</>}</section>
      <p className="mb-1 text-sm">سند منبع: دریافت غیرنقدی از حساب مشتری</p>{state.sale && <p className="mb-1 text-sm">سند پیوندی فروش: {state.sale.uuid}</p>}{state.adjustments.length > 0 && <p className="mb-1 text-sm">اسناد گدام: {state.adjustments.length}</p>}
      {buyerPrintReady && <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" className="rounded-xl bg-teal-700 p-3 font-bold text-white" onClick={() => setReceiptOpen(true)}>رسید خریدار</button><button type="button" className="rounded-xl bg-slate-100 p-3 font-bold text-slate-700" onClick={() => setInvoiceOpen(true)}>فاکتور خریدار</button></div>}
      {snapshot?.note && <p className="mt-3 text-sm text-slate-600">یادداشت: {snapshot.note}</p>}
      {state.payment?.goodsReceipt?.reason && <p className="mt-2 text-sm text-slate-600">دلیل اصلاح/ابطال: {state.payment.goodsReceipt.reason}</p>}
      {state.writeBlockReasons.length > 0 && <div role="alert" className="my-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{state.writeBlockReasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}
      {mutable && <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2"><button type="button" className="rounded-xl bg-slate-100 p-3 font-bold" onClick={() => setCorrecting(true)}>اصلاح سند</button><button type="button" className="rounded-xl bg-red-50 p-3 font-bold text-red-700" onClick={() => { setCancelToken(''); setCancelReasons([]) }}>آماده‌کردن ابطال</button></div>}
      {mutable && <section className="mt-3 rounded-xl border border-red-100 p-3"><Field label="دلیل ابطال"><input aria-label="دلیل ابطال دریافت" className={inputCls} value={cancelReason} onChange={event => { setCancelToken(''); setCancelReasons([]); setCancelReason(event.target.value) }} /></Field>{!cancelToken && <button type="button" disabled={busy || !cancelReason.trim()} className="w-full rounded-xl bg-red-50 p-3 font-bold text-red-700 disabled:opacity-40" onClick={() => void prepareCancel()}>{busy ? 'در حال بررسی…' : 'پیش‌نمایش ابطال'}</button>}{cancelReasons.length > 0 && <div role="alert" className="mt-2 text-sm text-red-700">{cancelReasons.map((reason, index) => <p key={index}>{reason}</p>)}</div>}{cancelToken && cancelReasons.length === 0 && <><p role="status" className="mb-2 text-sm text-red-700">ابطال اثر طلب و موجودی/فروش این سند را برمی‌گرداند. آیا مطمئن هستید؟</p><PrimaryBtn disabled={busy} onClick={() => void cancel()}>{busy ? 'در حال ابطال…' : 'تأیید نهایی ابطال'}</PrimaryBtn></>}</section>}
      {state.status === 'cancelled' && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm">این سند برای حساب فعلی اثر ندارد؛ برای رد حساب و بازرسی نگه‌داری شده است.</p>}
    </>}
    {error && <p role="alert" className="mt-3 whitespace-pre-line text-sm text-red-700">{error}</p>}
    {correcting && state && result?.source && <CustomerGoodsReceiptModal customer={result.source} correction={state} syncBeforeMutation={syncBeforeMutation} onClose={() => setCorrecting(false)} onSaved={uuid => { setCorrecting(false); onClose(); void uuid }} />}
    {receiptOpen && state?.sale && <ReceiptModal sale={state.sale} onClose={() => setReceiptOpen(false)} />}
    {invoiceOpen && state?.sale && <InvoiceModal sale={state.sale} onClose={() => setInvoiceOpen(false)} />}
  </Modal>
}
