import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../db'
import { deleteSale, deleteSaleImpact } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { Fab, Empty, Card } from '../components/ui'
import SalesStats from './sales/SalesStats'
import ReturnModal from './sales/ReturnModal'
import ExchangeModal from './sales/ExchangeModal'
import NewSaleModal from './sales/NewSaleModal'
import ReceiptModal from './sales/Receipt'

export default function Sales({ isStaff }: { isStaff?: boolean }) {
  const [view, setView] = useState<'list' | 'stats'>('list')
  const [showNew, setShowNew] = useState(false)
  const [returning, setReturning] = useState<Sale | null>(null)
  const [exchanging, setExchanging] = useState<Sale | null>(null)
  const [receiptFor, setReceiptFor] = useState<Sale | null>(null)
  const [justSaved, setJustSaved] = useState<Sale | null>(null)
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().filter((s) => !s.deleted).limit(100).toArray(), [])

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

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
                onClick={async () => {
                  const im = await deleteSaleImpact(s.id!)
                  let msg = 'این فروش حذف شود؟ اجناس به گدام برمی‌گردد.'
                  if (im && im.paid > 0) {
                    msg += `\n\nپول ${fmtMoney(im.paid)} از «${im.box}» پس می‌رود: ${fmtMoney(im.before)} ← ${fmtMoney(im.after)}`
                    // حذف جلو گرفته نمی‌شود، ولی باید بدانید که پول منفی می‌شود
                    if (im.after < 0) msg += '\n\n⚠️ با این حذف پول «' + im.box + '» منفی می‌شود! اگر آن پول را قبلاً خرج کرده‌اید، بهتر است به‌جای حذف، «مرجوعی» ثبت کنید.'
                  }
                  if (confirm(msg)) await deleteSale(s.id!)
                }}
              >
                حذف فروش
              </button>
            </div>
          </Card>
        )
      })}
      <Fab onClick={() => setShowNew(true)} label="فروش جدید" />
        </>
      )}
      {showNew && (
        <NewSaleModal
          onClose={() => setShowNew(false)}
          onSaved={(sale) => {
            setShowNew(false)
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

