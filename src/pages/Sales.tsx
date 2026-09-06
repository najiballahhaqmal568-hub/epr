import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type Sale } from '../db'
import { deleteSale, deleteSaleImpact } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { clearWorkingSale, readWorkingSale, deleteSaleDraft, readSaleDrafts, saleDraftTotal, type SaleDraft } from '../lib/saleDrafts'
import { Empty, Card, Modal } from '../components/ui'
import { Icon } from '../components/Icon'
import SalesStats from './sales/SalesStats'
import ReturnModal from './sales/ReturnModal'
import ExchangeModal from './sales/ExchangeModal'
import NewSaleModal from './sales/NewSaleModal'
import ReceiptModal from './sales/Receipt'
import InvoiceModal from './sales/InvoiceModal'

export default function Sales({ isStaff, openNew = false, pending = false, onPendingChange }: { isStaff?: boolean; openNew?: boolean; pending?: boolean; onPendingChange?: (pending: boolean) => void }) {
  const [view, setView] = useState<'new' | 'list' | 'stats' | 'held'>(accessFlags.readOnly ? 'list' : 'new')
  const [workspaceKey, setWorkspaceKey] = useState(openNew ? 1 : 0)
  const [detail, setDetail] = useState<Sale | null>(null)
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
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().filter((s) => !s.deleted && !s.lenderAction).limit(100).toArray(), [])

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

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
      <fieldset disabled={pending} className="sale-tabs mb-5 flex min-w-0 gap-2" aria-label="بخش‌های فروش">
        {!accessFlags.readOnly && <button onClick={() => setView('new')} className={tabCls('new')}>فروش جدید</button>}
        <button onClick={() => setView('list')} className={tabCls('list')}>
          تاریخچه
        </button>
        {!accessFlags.readOnly && <button onClick={() => setView('held')} className={tabCls('held')}>معطل ({fmtNum(drafts.length)})</button>}
        <button onClick={() => setView('stats')} className={tabCls('stats')}>
          آمار
        </button>
      </fieldset>
      {error && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {view === 'stats' && <SalesStats isStaff={isStaff} />}
      {view === 'held' && drafts.length === 0 && <Empty text="فروش معطل ندارید." />}
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
                    className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-bold text-white"
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
              className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-bold text-white"
            >
              فروش بعدی
            </button>
          </div>
        </div>
      )}
      {view === 'list' && <section className="rounded-2xl border border-slate-200 bg-white p-4"><div className="mb-4"><h2 className="font-bold">تاریخچه فروش</h2><p className="mt-1 text-xs text-slate-500">آخرین ۱۰۰ فروش · برای جزئیات، یک فروش را باز کنید.</p></div>
      {sales === undefined && <p role="status">در حال بارگذاری…</p>}
      {sales?.length === 0 && <Empty text="هنوز فروشی ثبت نشده." />}
      {sales?.map((s) => {
        const remainder = s.total - s.paid
        return (
          <Card key={s.id}>
            <button onClick={() => setDetail(s)} className="sale-history-row w-full text-right" aria-label={`جزئیات فروش ${s.customerName || 'مشتری نقدی'} ${fmtMoney(s.total)}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-800">
                  {s.customerName || 'مشتری نقدی'}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({s.saleType === 'retail' ? 'پرچون' : 'عمده'})
                  </span>
                </p>
                <p className="text-xs text-slate-500">{fmtDate(s.date)}</p>
              </div>
              <div className="text-left">
                <p className="font-bold text-teal-700">{fmtMoney(s.total)}</p>
                {(s.discount ?? 0) > 0 && <p className="text-xs text-amber-600">تخفیف: {fmtMoney(s.discount!)}</p>}
                {remainder > 0 && <p className="text-xs text-red-600">باقی: {fmtMoney(remainder)}</p>}
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {s.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
            </p>
            <span className="mt-2 block text-xs font-bold text-teal-700">نمایش جزئیات و رسید</span>
            </button>
          </Card>
        )
      })}
      </section>}
      {!accessFlags.readOnly && <div hidden={view !== 'new'}>
        <NewSaleModal
          key={`${workspaceKey}-${activeDraft?.id ?? 'new-sale'}`}
          embedded
          onPendingChange={onPendingChange}
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
        <p className="font-bold">{detail.customerName || 'مشتری نقدی'}</p><p className="mb-4 text-xs text-slate-500">{fmtDate(detail.date)} · {detail.saleType === 'retail' ? 'پرچون' : 'عمده'}</p>
        <div className="divide-y divide-slate-100">{detail.lines.map((line, index) => <div key={index} className="flex justify-between gap-3 py-3 text-sm"><span>{line.productName} {line.size} {line.color}<span className="block text-xs text-slate-500">{fmtNum(line.qty)} × {fmtMoney(line.unitPrice)}</span></span><strong>{fmtMoney(line.qty * line.unitPrice)}</strong></div>)}</div>
        <div className="my-4 rounded-xl bg-teal-50 p-3"><p className="flex justify-between font-bold"><span>مجموع</span><span>{fmtMoney(detail.total)}</span></p>{(detail.discount ?? 0) > 0 && <p className="mt-2 text-sm">تخفیف: {fmtMoney(detail.discount!)}</p>}<p className="mt-2 text-sm">دریافتی: {fmtMoney(detail.paid)}</p>{detail.total > detail.paid && <p className="mt-2 text-sm text-red-600">قرض: {fmtMoney(detail.total - detail.paid)}</p>}{detail.bookPage && <p className="mt-2 text-sm">صفحهٔ دفتر: {detail.bookPage}</p>}</div>
        <div className="grid grid-cols-2 gap-2"><button className="rounded-xl bg-teal-700 py-3 font-bold text-white" onClick={() => { setReceiptFor(detail); setDetail(null) }}>رسید</button><button className="rounded-xl bg-slate-100 py-3 font-bold" onClick={() => { setInvoiceFor(detail); setDetail(null) }}>فاکتور</button>{!accessFlags.readOnly && <><button className="rounded-xl bg-slate-100 py-3 font-bold" onClick={() => { setReturning(detail); setDetail(null) }}>مرجوعی</button><button className="rounded-xl bg-amber-50 py-3 font-bold text-amber-800" onClick={() => { setExchanging(detail); setDetail(null) }}>تبادله</button><button disabled={deleting} className="col-span-2 rounded-xl bg-red-50 py-3 text-red-600" onClick={() => void confirmDelete(detail)}>{deleting ? 'در حال بررسی…' : 'حذف فروش'}</button></>}</div>
      </Modal>}
      {receiptFor && (
        <ReceiptModal sale={receiptFor} onClose={() => setReceiptFor(null)} />
      )}
      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} />}
      {exchanging && <ExchangeModal sale={exchanging} onClose={() => setExchanging(null)} />}
      {invoiceFor && <InvoiceModal sale={invoiceFor} onClose={() => setInvoiceFor(null)} />}
    </div>
  )
}

