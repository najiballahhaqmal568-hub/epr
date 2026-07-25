import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Purchase, type Supplier } from '../db'
import { receivePurchase, payLanding, landingUnpaidOf } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { Fab, Empty, Card } from '../components/ui'
import CandidatesView from './purchases/Candidates'
import LandingCostModal from './purchases/LandingCostModal'
import SupplierDetailModal from './purchases/SupplierDetailModal'
import { PurchaseReturnModal, SupplierReturnModal } from './purchases/ReturnModals'
import { NewSupplierModal, PaySupplierModal } from './purchases/SupplierModals'
import NewPurchaseModal from './purchases/NewPurchaseModal'

export default function Purchases() {
  const [view, setView] = useState<'history' | 'suppliers' | 'sarrafs' | 'candidates'>('history')
  const [showNew, setShowNew] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState<'supplier' | 'sarraf' | null>(null)
  const [payingSupplier, setPayingSupplier] = useState<number | null>(null)
  const [returningTo, setReturningTo] = useState<Supplier | null>(null)
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(null)
  const [detail, setDetail] = useState<Supplier | null>(null)
  const [showLanding, setShowLanding] = useState(false)

  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().filter((p) => !p.deleted).limit(100).toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])
  const vendors = suppliers?.filter((s) => s.kind !== 'sarraf' && s.kind !== 'partner')
  const sarrafs = suppliers?.filter((s) => s.kind === 'sarraf')

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">خرید</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('history')} className={tabCls('history')}>
          خریدها
        </button>
        <button onClick={() => setView('suppliers')} className={tabCls('suppliers')}>
          تأمین‌کنندگان
        </button>
        <button onClick={() => setView('sarrafs')} className={tabCls('sarrafs')}>
          صراف‌ها
        </button>
        <button onClick={() => setView('candidates')} className={tabCls('candidates')}>
          کاندیدها
        </button>
      </div>

      {view === 'candidates' && <CandidatesView />}

      {view === 'history' && (
        <>
          <button
            onClick={() => setShowLanding(true)}
            className="mb-3 w-full rounded-xl border-2 border-dashed border-amber-400 py-2.5 text-sm font-bold text-amber-700"
          >
            🚚 ثبت مصارف رسیدن (کرایه/حمالی/کمیشن)
          </button>
          {purchases?.length === 0 && <Empty text="هنوز خریدی ثبت نشده." />}
          {purchases?.map((p) => {
            const hawala = p.sarrafAmount ?? 0
            const remainder = p.total - p.paid - hawala
            const pending = p.received === false
            return (
              <Card key={p.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">
                      {p.supplierName}
                      {pending && <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">🚚 در راه</span>}
                    </p>
                    <p className="text-xs text-slate-500">{fmtDate(p.date)}</p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-teal-700">{fmtMoney(p.total)}</p>
                    {remainder > 0 && <p className="text-xs text-red-600">باقی: {fmtMoney(remainder)}</p>}
                    {hawala > 0 && (
                      <p className="text-xs text-amber-600">
                        حواله {p.sarrafName}: {fmtMoney(hawala)}
                      </p>
                    )}
                    {(p.landingCost ?? 0) > 0 && (
                      <p className="text-xs text-amber-600">مصارف رسیدن: {fmtMoney(p.landingCost!)}</p>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {p.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
                </p>
                {landingUnpaidOf(p) > 0 && (
                  <button
                    onClick={() => void payLanding(p.id!)}
                    className="mt-2 w-full rounded-xl bg-amber-500 py-2 text-sm font-bold text-white"
                  >
                    💵 پرداخت مصارف رسیدن ({fmtMoney(landingUnpaidOf(p))}) — نقد از صندوق
                  </button>
                )}
                {pending ? (
                  <button
                    onClick={() => void receivePurchase(p.id!)}
                    className="mt-2 w-full rounded-xl bg-teal-700 py-2 text-sm font-bold text-white"
                  >
                    ✓ جنس رسید — به گدام اضافه شود
                  </button>
                ) : (
                  <button className="mt-1 text-xs font-bold text-amber-700" onClick={() => setReturningPurchase(p)}>
                    مرجوعی به تأمین‌کننده
                  </button>
                )}
              </Card>
            )
          })}
          <Fab onClick={() => setShowNew(true)} label="خرید جدید" />
        </>
      )}

      {view === 'suppliers' && (
        <>
          {vendors?.length === 0 && <Empty text="تأمین‌کننده‌ای ثبت نشده." />}
          {vendors?.map((s) => (
            <Card key={s.id} onClick={() => setDetail(s)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">{s.name}</p>
                  {s.phone && <p className="text-sm text-slate-500" dir="ltr">{s.phone}</p>}
                </div>
                <div className="text-left">
                  <p className={`font-bold ${s.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(s.balance))}</p>
                  <p className={`text-xs ${s.balance < 0 ? 'font-bold text-teal-700' : 'text-slate-400'}`}>
                    {s.balance > 0 ? 'قرض ما' : s.balance < 0 ? 'طلب ما' : 'تصفیه'}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-4">
                <button
                  className="text-sm font-bold text-teal-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPayingSupplier(s.id!)
                  }}
                >
                  {s.balance > 0 ? 'پرداخت قرض' : 'پیشکی'}
                </button>
                <button
                  className="text-sm font-bold text-amber-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    setReturningTo(s)
                  }}
                >
                  مرجوعی جنس
                </button>
                <span className="mr-auto text-xs text-slate-400">جزئیات ←</span>
              </div>
            </Card>
          ))}
          <Fab onClick={() => setShowNewSupplier('supplier')} label="تأمین‌کننده" />
        </>
      )}

      {view === 'sarrafs' && (
        <>
          {sarrafs?.length === 0 && <Empty text="صرافی ثبت نشده. صراف کسی است که برای شما حواله می‌کند." />}
          {sarrafs?.map((s) => (
            <Card key={s.id} onClick={() => setDetail(s)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">💱 {s.name}</p>
                  {s.phone && <p className="text-sm text-slate-500" dir="ltr">{s.phone}</p>}
                </div>
                <div className="text-left">
                  <p className={`font-bold ${s.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(s.balance))}</p>
                  <p className={`text-xs ${s.balance < 0 ? 'font-bold text-teal-700' : 'text-slate-400'}`}>
                    {s.balance > 0 ? 'قرض ما به صراف' : s.balance < 0 ? 'طلب ما از صراف' : 'تصفیه'}
                  </p>
                </div>
              </div>
              <div className="mt-2 flex gap-4">
                <button
                  className="text-sm font-bold text-teal-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    setPayingSupplier(s.id!)
                  }}
                >
                  {s.balance > 0 ? 'پرداخت به صراف' : 'پیشکی به صراف'}
                </button>
                <span className="mr-auto text-xs text-slate-400">جزئیات ←</span>
              </div>
            </Card>
          ))}
          <Fab onClick={() => setShowNewSupplier('sarraf')} label="صراف جدید" />
        </>
      )}

      {showNew && <NewPurchaseModal onClose={() => setShowNew(false)} />}
      {showNewSupplier && <NewSupplierModal kind={showNewSupplier} onClose={() => setShowNewSupplier(null)} />}
      {payingSupplier != null && <PaySupplierModal supplierId={payingSupplier} onClose={() => setPayingSupplier(null)} />}
      {returningTo && <SupplierReturnModal supplier={returningTo} onClose={() => setReturningTo(null)} />}
      {returningPurchase && <PurchaseReturnModal purchase={returningPurchase} onClose={() => setReturningPurchase(null)} />}
      {detail && <SupplierDetailModal supplier={detail} onClose={() => setDetail(null)} />}
      {showLanding && <LandingCostModal onClose={() => setShowLanding(false)} />}
    </div>
  )
}
