import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../db'
import { deleteSale, deleteSaleImpact } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { deleteSaleDraft, readSaleDrafts, saleDraftTotal, type SaleDraft } from '../lib/saleDrafts'
import { Fab, Empty, Card } from '../components/ui'
import SalesStats from './sales/SalesStats'
import ReturnModal from './sales/ReturnModal'
import ExchangeModal from './sales/ExchangeModal'
import NewSaleModal from './sales/NewSaleModal'
import ReceiptModal from './sales/Receipt'

export default function Sales({ isStaff, openNew = false }: { isStaff?: boolean; openNew?: boolean }) {
  const [view, setView] = useState<'list' | 'stats'>('list')
  const [showNew, setShowNew] = useState(openNew)
  const [returning, setReturning] = useState<Sale | null>(null)
  const [exchanging, setExchanging] = useState<Sale | null>(null)
  const [receiptFor, setReceiptFor] = useState<Sale | null>(null)
  const [justSaved, setJustSaved] = useState<Sale | null>(null)
  const [drafts, setDrafts] = useState<SaleDraft[]>(() => readSaleDrafts())
  const [activeDraft, setActiveDraft] = useState<SaleDraft | null>(null)
  // کفشِ قرض‌دهنده از دفتر همان شخص حذف/اصلاح می‌شود؛ در آمار مفاد می‌ماند
  // اما در این لیست عملیاتی نمی‌آید تا مرجوعی/تبادله حساب پیوندشده را نیمه‌کاره نکند.
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().filter((s) => !s.deleted && !s.lenderAction).limit(100).toArray(), [])

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

  function removeDraft(id: string) {
    deleteSaleDraft(id)
    setDrafts(readSaleDrafts())
    if (activeDraft?.id === id) setActiveDraft(null)
  }

  async function confirmDelete(sale: Sale, isUndo = false) {
    if (!sale.id) return
    const im = await deleteSaleImpact(sale.id)
    let msg = isUndo
      ? 'آخرین فروش برگردانده شود؟ اجناس دوباره به گدام می‌رود و اثر پول و قرض آن هم برعکس می‌شود.'
      : 'این فروش حذف شود؟ اجناس به گدام برمی‌گردد.'
    if (im && im.paid > 0) {
      msg += `\n\nپول ${fmtMoney(im.paid)} از «${im.box}» پس می‌رود: ${fmtMoney(im.before)} ← ${fmtMoney(im.after)}`
      if (im.after < 0) {
        msg += '\n\n⚠️ با این کار پول «' + im.box + '» منفی می‌شود! اگر آن پول را قبلاً خرج کرده‌اید، بهتر است به‌جای حذف، «مرجوعی» ثبت کنید.'
      }
    }
    if (!confirm(msg)) return
    await deleteSale(sale.id)
    if (isUndo) setJustSaved(null)
  }

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">فروش</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('list')} className={tabCls('list')}>
          فروش‌ها
        </button>
        <button onClick={() => setView('stats')} className={tabCls('stats')}>
          آمار
        </button>
      </div>
      {view === 'stats' && <SalesStats isStaff={isStaff} />}
      {view === 'list' && (
        <>
      {drafts.length > 0 && (
        <section className="mb-3 rounded-2xl border border-amber-200 bg-amber-50 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h2 className="font-bold text-amber-900">⏸ فروش‌های معطل ({fmtNum(drafts.length)})</h2>
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
                      setActiveDraft(draft)
                      setShowNew(true)
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
              <p className="font-bold text-teal-800">✅ فروش ثبت شد — {fmtMoney(justSaved.total)}</p>
              <p className="truncate text-xs text-teal-700">
                {justSaved.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
              </p>
            </div>
            <button onClick={() => setJustSaved(null)} className="shrink-0 text-teal-700">
              ✕
            </button>
          </div>
          <div className="mt-2 flex gap-2">
            {justSaved.id && (
              <button
                onClick={() => void confirmDelete(justSaved, true)}
                className="rounded-lg bg-red-50 px-3 py-2 text-sm font-bold text-red-600"
              >
                ↶ برگشت
              </button>
            )}
            <button
              onClick={() => {
                setReceiptFor(justSaved)
                setJustSaved(null)
              }}
              className="flex-1 rounded-lg bg-white py-2 text-sm font-bold text-teal-800"
            >
              🧾 رسید
            </button>
            <button
              onClick={() => {
                setJustSaved(null)
                setShowNew(true)
              }}
              className="flex-1 rounded-lg bg-teal-700 py-2 text-sm font-bold text-white"
            >
              ＋ فروش بعدی
            </button>
          </div>
        </div>
      )}
      {sales?.length === 0 && <Empty text="هنوز فروشی ثبت نشده." />}
      {sales?.map((s) => {
        const remainder = s.total - s.paid
        return (
          <Card key={s.id}>
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
            <div className="mt-1 flex gap-4">
              <button className="text-xs font-bold text-teal-700" onClick={() => setReturning(s)}>
                مرجوعی
              </button>
              <button className="text-xs font-bold text-amber-700" onClick={() => setExchanging(s)}>
                تبادله
              </button>
              <button className="text-xs font-bold text-slate-600" onClick={() => setReceiptFor(s)}>
                🧾 رسید
              </button>
              <button
                className="text-xs text-red-500"
                onClick={() => void confirmDelete(s)}
              >
                حذف فروش
              </button>
            </div>
          </Card>
        )
      })}
      <Fab
        onClick={() => {
          setActiveDraft(null)
          setShowNew(true)
        }}
        label="فروش جدید"
      />
        </>
      )}
      {showNew && (
        <NewSaleModal
          key={activeDraft?.id ?? 'new-sale'}
          draft={activeDraft ?? undefined}
          onClose={() => {
            setShowNew(false)
            setActiveDraft(null)
          }}
          onHeld={() => setDrafts(readSaleDrafts())}
          onSaved={(sale) => {
            if (activeDraft) removeDraft(activeDraft.id)
            setShowNew(false)
            setActiveDraft(null)
            // رسید خودبه‌خود باز نمی‌شود — در وقت شلوغی یک قدم اضافی بود.
            // فقط یک تأیید کوتاه، و اگر رسید خواستند از همان‌جا باز می‌شود.
            setJustSaved(sale)
          }}
        />
      )}
      {receiptFor && (
        <ReceiptModal sale={receiptFor} onClose={() => setReceiptFor(null)} />
      )}
      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} />}
      {exchanging && <ExchangeModal sale={exchanging} onClose={() => setExchanging(null)} />}
    </div>
  )
}

