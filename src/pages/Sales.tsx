import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { commercialSaleLines } from '../lib/commercialLines'
import { directFeatureEnabled } from '../lib/directTradeState'
import DirectTradeForm from './sales/direct/DirectTradeForm'
import DirectTradeDetail from './sales/direct/DirectTradeDetail'
import DirectTradeEnable from './sales/direct/DirectTradeEnable'
import { accessFlags, db, saleCashPaid, type Sale } from '../db'
import { saleCustomerCredit, saleSettledByAccount } from '../lib/salesFigures'
import { deleteSale, deleteSaleImpact } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { clearWorkingSale, readWorkingSale, deleteSaleDraft, readSaleDrafts, saleDraftTotal, type SaleDraft } from '../lib/saleDrafts'
import { Empty, Modal } from '../components/ui'
import { Icon } from '../components/Icon'
import SalesStats from './sales/SalesStats'
import ReturnModal from './sales/ReturnModal'
import ExchangeModal from './sales/ExchangeModal'
import NewSaleModal from './sales/NewSaleModal'
import ReceiptModal from './sales/Receipt'
import InvoiceModal from './sales/InvoiceModal'
import SaleHistory from './sales/SaleHistory'
import SaleShipping from './sales/SaleShipping'
import SaleTimeline from './sales/SaleTimeline'
import CustomerGoodsReceiptDetail from './customers/CustomerGoodsReceiptDetail'

export default function Sales({ isStaff, openNew = false, pending = false, onPendingChange, openSaleId = null, onSaleOpened }: { isStaff?: boolean; openNew?: boolean; pending?: boolean; onPendingChange?: (pending: boolean) => void; openSaleId?: number | null; onSaleOpened?: () => void }) {
  const [view, setView] = useState<'new' | 'list' | 'stats' | 'held'>(accessFlags.readOnly ? 'list' : 'new')
  const [workspaceKey, setWorkspaceKey] = useState(openNew ? 1 : 0)
  const [checkoutStage, setCheckoutStage] = useState<'selection' | 'payment'>('selection')
  const [detail, setDetail] = useState<Sale | null>(null)
  const [newDirect, setNewDirect] = useState(false)
  const [directDetail, setDirectDetail] = useState<string | null>(null)
  const [goodsReceiptDetail, setGoodsReceiptDetail] = useState<string | null>(null)
  const [enableDirect, setEnableDirect] = useState(false)
  const directEnabled = useLiveQuery(directFeatureEnabled, [])
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [returning, setReturning] = useState<Sale | null>(null)
  const [exchanging, setExchanging] = useState<Sale | null>(null)
  const [receiptFor, setReceiptFor] = useState<Sale | null>(null)
  // فاکتورِ کاغذی برای چاپ/اشتراک
  const [invoiceFor, setInvoiceFor] = useState<Sale | null>(null)
  const [justSaved, setJustSaved] = useState<Sale | null>(null)
  const [drafts, setDrafts] = useState<SaleDraft[]>(() => readSaleDrafts())
  const [activeDraft, setActiveDraft] = useState<SaleDraft | null>(null)
  // کفشِ قرض‌دهنده از دفتر همان شخص حذف/اصلاح می‌شود؛ در آمار مفاد می‌ماند
  // اما در این لیست عملیاتی نمی‌آید تا مرجوعی/تبادله حساب پیوندشده را نیمه‌کاره نکند.

  // از صفحهٔ خانه یک فروش انتخاب شده: همان سندی باز می‌شود که در تاریخچه با زدن روی همان فروش باز می‌شد
  useEffect(() => {
    if (openSaleId === null) return
    let cancelled = false
    void db.sales.get(openSaleId).then((found) => {
      if (cancelled) return
      if (found && !found.deleted) {
        setView('list')
        if (found.directTrade) setDirectDetail(found.directTrade.uuid)
        else if (found.goodsReceiptChild) setGoodsReceiptDetail(found.goodsReceiptChild.receiptUuid)
        else setDetail(found)
      }
      onSaleOpened?.()
    })
    return () => { cancelled = true }
  }, [openSaleId])

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-[var(--action)] text-white' : 'bg-slate-100 text-slate-600'}`

  function removeDraft(id: string) {
    try {
      deleteSaleDraft(id)
      if (readWorkingSale()?.id === id) clearWorkingSale()
      setDrafts(readSaleDrafts())
      if (activeDraft?.id === id) setActiveDraft(null)
    } catch { setError('پیش‌نویس پاک نشد؛ دوباره کوشش کنید.') }
  }

  function resetWorkspace() {
    setActiveDraft(null)
    setWorkspaceKey((key) => key + 1)
    setDrafts(readSaleDrafts())
  }

  async function confirmDelete(sale: Sale, isUndo = false) {
    if (!sale.id || deleting) return
    setDeleting(true)
    try {
    const im = await deleteSaleImpact(sale.id)
    let msg = isUndo
      ? 'آخرین فروش برگردانده شود؟ اجناس دوباره به گدام می‌رود و اثر پول و قرض آن هم برعکس می‌شود.'
      : 'این فروش حذف شود؟ اجناس به گدام برمی‌گردد.'
    if (im && im.linkedReturns > 0) {
      msg += `\n\n⚠️ ${im.linkedReturns} برگشت متصل به این فروش هم همراه آن حذف می‌شود و اثرش بر گدام، صندوق و قرض برعکس می‌گردد.`
    }
    if (im && im.paid > 0) {
      msg += `\n\nپول ${fmtMoney(im.paid)} از «${im.box}» پس می‌رود: ${fmtMoney(im.before)} ← ${fmtMoney(im.after)}`
      if (im.after < 0) {
        msg += '\n\n⚠️ با این کار پول «' + im.box + '» منفی می‌شود! اگر آن پول را قبلاً خرج کرده‌اید، بهتر است به‌جای حذف، «مرجوعی» ثبت کنید.'
      }
    }
    if (!confirm(msg)) return
    await deleteSale(sale.id)
    setDetail(null)
    if (isUndo) setJustSaved(null)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setDeleting(false) }
  }

  return (
    <div className="sales-page p-4">
      <header className="page-heading"><h1>میز فروش</h1><span className="text-sm text-slate-500">پرچون و عمده</span></header>
      <fieldset hidden={view === 'new' && checkoutStage === 'payment'} disabled={pending} className="sale-tabs mb-5 flex min-w-0 gap-2" aria-label="بخش‌های فروش">
        {!accessFlags.readOnly && <button onClick={() => setView('new')} className={tabCls('new')}>فروش جدید</button>}
        <button onClick={() => setView('list')} className={tabCls('list')}>
          تاریخچه
        </button>
        {!accessFlags.readOnly && <button onClick={() => setView('held')} className={tabCls('held')}>معطل ({fmtNum(drafts.length)})</button>}
        <button onClick={() => setView('stats')} className={tabCls('stats')}>
          آمار
        </button>
      </fieldset>
      {!accessFlags.readOnly && !isStaff && !(view === 'new' && checkoutStage === 'payment') && <button disabled={pending || directEnabled === undefined} className="sale-secondary-action mb-4" onClick={() => directEnabled ? setNewDirect(true) : setEnableDirect(true)}>فروش مستقیم</button>}
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {view === 'stats' && <SalesStats isStaff={isStaff} />}
      {view === 'held' && drafts.length === 0 && <Empty text="فروش معطل ندارید." hint="اگر مشتری رفت پول بیاورد، سبدش را با «معطل» نگه دارید و مشتری بعدی را راه بیندازید." />}
      {view === 'held' && drafts.length > 0 && (
        <section className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-amber-900">فروش‌های معطل ({fmtNum(drafts.length)})</h2>
              <p className="text-xs text-amber-700">فقط در همین دستگاه؛ هنوز از گدام و صندوق کم نشده است.</p>
            </div>
          </div>
          <div className="space-y-2">
            {drafts.map((draft) => (
              <div key={draft.id} className="rounded-xl bg-white p-2.5 shadow-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800">
                      {draft.lines.map((line) => `${line.productName} ${line.size} ×${fmtNum(line.qty)}`).join('، ')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(draft.updatedAt)} · {fmtMoney(saleDraftTotal(draft))}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
                    {draft.saleType === 'retail' ? 'پرچون' : 'عمده'}
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    className="flex-1 rounded-lg bg-[var(--action)] py-2 text-sm font-bold text-white"
                    onClick={() => {
                      const working = readWorkingSale()
                      if (working && working.id !== draft.id && !confirm('سبد جاری با این فروش معطل جایگزین شود؟ برای نگه‌داشتن سبد جاری، نخست آن را معطل کنید.')) return
                      setActiveDraft(draft)
                      setWorkspaceKey((key) => key + 1)
                      setView('new')
                    }}
                  >
                    ادامه و ثبت
                  </button>
                  <button
                    className="rounded-lg bg-red-50 px-4 py-2 text-sm font-bold text-red-600"
                    onClick={() => {
                      if (confirm('این فروش معطل فقط از همین دستگاه پاک شود؟')) removeDraft(draft.id)
                    }}
                  >
                    حذف
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {justSaved && (
        <div className="mb-3 rounded-xl bg-teal-50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-teal-800">فروش ثبت شد — {fmtMoney(justSaved.total)}</p>
              <p className="mt-1 text-xs text-teal-700">سبد تازه برای مشتری بعدی آماده است.</p>
              <p className="truncate text-xs text-teal-700">
                {justSaved.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
              </p>
            </div>
            <button aria-label="بستن تأیید فروش" onClick={() => setJustSaved(null)} className="shrink-0 text-teal-700">
              <Icon name="close" />
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {justSaved.id && (
              <button
                onClick={() => void confirmDelete(justSaved, true)}
                className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600"
              >
                برگرداندن
              </button>
            )}
            <button
              onClick={() => {
                setReceiptFor(justSaved)
                setJustSaved(null)
              }}
              className="flex-1 rounded-lg bg-white py-2 text-sm font-bold text-teal-800"
            >
              رسید
            </button>
            <button
              onClick={() => setInvoiceFor(justSaved)}
              className="flex-1 rounded-lg bg-slate-800 py-2 text-sm font-bold text-white"
            >
              فاکتور
            </button>
            <button
              onClick={() => {
                setJustSaved(null)
                setView('new')
              }}
              className="flex-1 rounded-lg bg-[var(--action)] py-2 text-sm font-bold text-white"
            >
              فروش بعدی
            </button>
          </div>
        </div>
      )}
      {view === 'list' && <SaleHistory>{(s) => {
        const remainder = saleCustomerCredit(s)
        return (
            <button key={s.id} onClick={() => s.directTrade ? setDirectDetail(s.directTrade.uuid) : s.goodsReceiptChild ? setGoodsReceiptDetail(s.goodsReceiptChild.receiptUuid) : setDetail(s)} className="sale-history-row" aria-label={`جزئیات فروش ${s.customerName || 'مشتری نقدی'} ${fmtMoney(s.total)}`}>
            <div className="sale-history-row-heading">
              <div className="sale-history-customer">
                <p className="font-bold">{s.customerName || 'مشتری نقدی'}</p>
                <p className="sale-history-meta">{s.directTrade ? 'مستقیم' : s.goodsReceiptChild ? 'فروش جنس دریافت‌شده' : s.saleType === 'retail' ? 'پرچون' : 'عمده'} · {fmtDate(s.date)}</p>
              </div>
              <div className="sale-history-amount">
                <strong>{fmtMoney(s.total)}</strong>
                {!s.directTrade && <span className={remainder > 0 ? 'sale-status-debt' : 'sale-status-paid'}>{remainder > 0 ? `باقی: ${fmtMoney(remainder)}` : 'پرداخت شده'}</span>}
                {s.directTrade && <span className="sale-history-meta">حساب در جزئیات معامله</span>}
              </div>
            </div>
            <p className="sale-history-goods">
              {commercialSaleLines(s).map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
            </p>
            <div className="sale-history-row-footer">{(s.discount ?? 0) > 0 && <span>تخفیف: {fmtMoney(s.discount!)}</span>}<span>جزئیات و رسید <span aria-hidden="true">←</span></span></div>
            </button>
        )
      }}</SaleHistory>}
      {!accessFlags.readOnly && <div hidden={view !== 'new'}>
        <NewSaleModal
          key={`${workspaceKey}-${activeDraft?.id ?? 'new-sale'}`}
          embedded
          isStaff={isStaff}
          onPendingChange={onPendingChange}
          onStageChange={setCheckoutStage}
          draft={activeDraft ?? undefined}
          onClose={resetWorkspace}
          onHeld={() => { setDrafts(readSaleDrafts()); setView('held') }}
          onSaved={(sale) => {
            resetWorkspace()
            // رسید خودبه‌خود باز نمی‌شود — در وقت شلوغی یک قدم اضافی بود.
            // فقط یک تأیید کوتاه، و اگر رسید خواستند از همان‌جا باز می‌شود.
            setJustSaved(sale)
          }}
        />
      </div>}
      {detail && <Modal title={`جزئیات فروش ${fmtNum(detail.id ?? 0)}`} onClose={() => setDetail(null)}>
        <div className="doc-paper">
        <div className="doc-paper-brand"><b>اتل</b><span>فروشگاه اتل · سند فروش {fmtNum(detail.id ?? 0)}</span></div>
        <div className="sale-document-heading"><strong>{detail.customerName || 'مشتری نقدی'}</strong><p>{fmtDate(detail.date)} · {detail.saleType === 'retail' ? 'پرچون' : 'عمده'}</p></div>
        <section aria-label="اجناس فروش" className="sale-detail-goods">{detail.lines.map((line, index) => <div key={index}><span>{line.productName} {line.size} {line.color}<small>{fmtNum(line.qty)} × {fmtMoney(line.unitPrice)}</small></span><strong>{fmtMoney(line.qty * line.unitPrice)}</strong></div>)}</section>
        <div className="sale-document-totals"><p><span>مجموع اجناس</span><strong>{fmtMoney(detail.total + (detail.discount ?? 0))}</strong></p>{(detail.discount ?? 0) > 0 && <p><span>تخفیف</span><span>{fmtMoney(detail.discount!)}</span></p>}<p className="sale-document-net"><span>قابل پرداخت</span><strong>{fmtMoney(detail.total)}</strong></p><p><span>دریافتی</span><span>{fmtMoney(saleCashPaid(detail))}</span></p>{saleSettledByAccount(detail) > 0 && <p><span>تسویه با حساب (کفش)</span><span>{fmtMoney(saleSettledByAccount(detail))}</span></p>}{saleCustomerCredit(detail) > 0 && <p className="sale-status-debt"><span>قرض</span><strong>{fmtMoney(saleCustomerCredit(detail))}</strong></p>}{detail.bookPage && <p><span>صفحهٔ دفتر</span><span>{detail.bookPage}</span></p>}</div>
        </div>
        <div className="sale-document-actions"><button className="primary-button" onClick={() => { setReceiptFor(detail); setDetail(null) }}>رسید</button><button className="sale-secondary-action" onClick={() => { setInvoiceFor(detail); setDetail(null) }}>فاکتور</button></div>
        <SaleShipping sale={detail} />
        {!accessFlags.readOnly && <section className="sale-detail-corrections" aria-label="مرجوعی و تغییر فروش"><h3>مرجوعی و تغییر فروش</h3><div className="sale-document-actions"><button className="sale-secondary-action" onClick={() => { setReturning(detail); setDetail(null) }}>مرجوعی</button><button className="sale-secondary-action" onClick={() => { setExchanging(detail); setDetail(null) }}>تبادله</button></div><button disabled={deleting} className="sale-delete-action" onClick={() => void confirmDelete(detail)}>{deleting ? 'در حال بررسی…' : 'حذف فروش'}</button></section>}
        <SaleTimeline sale={detail} />
      </Modal>}
      {receiptFor && (
        <ReceiptModal sale={receiptFor} onClose={() => setReceiptFor(null)} />
      )}
      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} />}
      {exchanging && <ExchangeModal sale={exchanging} onClose={() => setExchanging(null)} />}
      {invoiceFor && <InvoiceModal sale={invoiceFor} onClose={() => setInvoiceFor(null)} />}
      {enableDirect && <DirectTradeEnable onClose={() => setEnableDirect(false)} onEnabled={() => { setEnableDirect(false); setNewDirect(true) }} />}
      {newDirect && <DirectTradeForm onClose={() => setNewDirect(false)} onPendingChange={onPendingChange} onSaved={uuid => { setNewDirect(false); setDirectDetail(uuid) }} />}
      {directDetail && <DirectTradeDetail tradeUuid={directDetail} isStaff={isStaff} onClose={() => setDirectDetail(null)} />}
      {goodsReceiptDetail && <CustomerGoodsReceiptDetail receiptUuid={goodsReceiptDetail} onClose={() => setGoodsReceiptDetail(null)} />}
    </div>
  )
}

