import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Purchase, type Supplier } from '../db'
import { receivePurchase, payLanding, landingUnpaidOf } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { inputCls, Fab, Empty, Card } from '../components/ui'
import { reorderProducts } from '../lib/reorder'
import CandidatesView from './purchases/Candidates'
import LandingCostModal from './purchases/LandingCostModal'
import SupplierDetailModal from './purchases/SupplierDetailModal'
import { PurchaseReturnModal, SupplierReturnModal } from './purchases/ReturnModals'
import { NewSupplierModal, PaySupplierModal } from './purchases/SupplierModals'
import NewPurchaseModal from './purchases/NewPurchaseModal'
import LendersView from './purchases/LendersView'
import PurchasePriceCorrectionModal from './purchases/PurchasePriceCorrectionModal'

export type PurchaseView = 'history' | 'suppliers' | 'sarrafs' | 'lenders' | 'candidates'
type PurchaseFilter = 'all' | 'debt' | 'transit'

export default function Purchases({
  initialView = 'history',
  openNew = false,
  onBack,
  onOpenReorder,
  onOpenAccounts
}: {
  initialView?: PurchaseView
  openNew?: boolean
  onBack?: () => void
  onOpenReorder?: () => void
  onOpenAccounts?: () => void
}) {
  const [view, setView] = useState<PurchaseView>(initialView)
  const [showNew, setShowNew] = useState(openNew)
  const [showNewSupplier, setShowNewSupplier] = useState<'supplier' | 'sarraf' | null>(null)
  const [payingSupplier, setPayingSupplier] = useState<number | null>(null)
  const [returningTo, setReturningTo] = useState<Supplier | null>(null)
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(null)
  const [correctingPurchase, setCorrectingPurchase] = useState<Purchase | null>(null)
  const [detail, setDetail] = useState<Supplier | null>(null)
  const [showLanding, setShowLanding] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PurchaseFilter>('all')
  const [showFilters, setShowFilters] = useState(false)

  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().filter((p) => !p.deleted).limit(100).toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const vendors = suppliers?.filter((s) => s.kind !== 'sarraf' && s.kind !== 'partner' && s.kind !== 'lender' && s.kind !== 'expenseCreditor')
  const sarrafs = suppliers?.filter((s) => s.kind === 'sarraf')
  const lenders = suppliers?.filter((s) => s.kind === 'lender')
  const reorderCount = reorderProducts(products ?? [], variants ?? []).length
  const vendorDebt = (vendors ?? []).reduce((sum, supplier) => sum + Math.max(0, supplier.balance), 0)
  const lenderDebt = (lenders ?? []).reduce((sum, supplier) => sum + Math.max(0, supplier.balance), 0)

  const shownPurchases = (purchases ?? []).filter((purchase) => {
    const term = search.trim().toLowerCase()
    const matchesSearch =
      !term ||
      `${purchase.supplierName} ${purchase.lines.map((line) => `${line.productName} ${line.size} ${line.color}`).join(' ')}`
        .toLowerCase()
        .includes(term)
    if (!matchesSearch) return false
    const remainder = purchase.total - purchase.paid - (purchase.sarrafAmount ?? 0)
    if (filter === 'debt') return remainder > 0
    if (filter === 'transit') return purchase.received === false
    return true
  })

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

  return (
    <div className="p-4">
      {(view === 'history' || view === 'candidates') && (
        <>
          <h1 className="mb-3 text-xl font-bold text-slate-800">خرید</h1>
          <div className="mb-3 grid grid-cols-3 gap-2">
            <button onClick={onBack} className="rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-700">
              موجودی
            </button>
            <button onClick={() => setView('history')} className="rounded-xl bg-teal-700 py-2.5 text-sm font-bold text-white">
              خرید
            </button>
            <button
              onClick={onOpenReorder}
              className={`rounded-xl py-2.5 text-sm font-bold ${reorderCount ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
            >
              خرید مجدد {reorderCount > 0 && `(${fmtNum(reorderCount)})`}
            </button>
          </div>
        </>
      )}

      {(view === 'suppliers' || view === 'sarrafs' || view === 'lenders') && (
        <>
          <div className="mb-3 flex items-center gap-2">
            {onBack && (
              <button onClick={onBack} className="rounded-full bg-slate-100 px-3 py-1 text-slate-600" aria-label="برگشت">
                برگشت
              </button>
            )}
            <h1 className="text-xl font-bold text-slate-800">حساب‌های خرید</h1>
          </div>
          <div className="mb-3 flex gap-2">
            <button onClick={() => setView('suppliers')} className={tabCls('suppliers')}>تأمین‌کنندگان</button>
            <button onClick={() => setView('sarrafs')} className={tabCls('sarrafs')}>صراف‌ها</button>
            <button onClick={() => setView('lenders')} className={tabCls('lenders')}>قرض‌دهنده‌ها</button>
          </div>
        </>
      )}

      {view === 'candidates' && (
        <>
          <button onClick={() => setView('history')} className="mb-3 text-sm font-bold text-teal-700">
            بازگشت به خریدهای اخیر
          </button>
          <CandidatesView />
        </>
      )}
      {view === 'lenders' && <LendersView />}

      {view === 'history' && (
        <>
          <button
            onClick={() => setShowNew(true)}
            className="mb-3 w-full rounded-2xl bg-teal-700 py-4 text-lg font-bold text-white shadow-sm active:bg-teal-800"
          >
            ثبت خرید جدید
          </button>

          {(vendorDebt > 0 || lenderDebt > 0) && (
            <button
              onClick={onOpenAccounts}
              className="mb-3 flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 text-right shadow-sm"
            >
              <span>
                <span className="block text-xs text-slate-500">قرض خرید</span>
                <span className="block text-xs font-bold text-teal-700">تأمین‌کنندگان و قرض‌دهندگان</span>
              </span>
              <span className="text-left">
                <span className="block text-xl font-bold text-red-600">{fmtMoney(vendorDebt + lenderDebt)}</span>
                <span className="text-xs text-slate-400">دیدن حساب‌ها</span>
              </span>
            </button>
          )}

          <button
            onClick={() => setShowLanding(true)}
            className="mb-3 w-full rounded-xl border border-dashed border-amber-400 py-2.5 text-sm font-bold text-amber-700"
          >
            ثبت مصارف رسیدن (کرایه، حمالی یا کمیشن)
          </button>

          <div className="mb-2 flex gap-2">
            <input
              className={inputCls}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجوی تأمین‌کننده یا جنس..."
            />
            <button
              onClick={() => setShowFilters((value) => !value)}
              aria-expanded={showFilters}
              className={`shrink-0 rounded-xl px-4 text-sm font-bold ${showFilters ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
            >
              فلتر
            </button>
          </div>
          {showFilters && (
            <div className="mb-3 flex gap-2">
              {([
                ['all', 'همه'],
                ['debt', 'قرض‌دار'],
                ['transit', 'در راه']
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setFilter(id)}
                  className={`rounded-full px-4 py-1.5 text-xs font-bold ${filter === id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <div className="mb-2 mt-4 flex items-center justify-between">
            <h2 className="font-bold text-slate-800">خریدهای اخیر</h2>
            <span className="text-xs text-slate-400">{fmtNum(shownPurchases.length)} خرید</span>
          </div>
          {shownPurchases.length === 0 && <Empty text={purchases?.length ? 'خریدی با این جستجو یا فلتر پیدا نشد.' : 'هنوز خریدی ثبت نشده.'} />}
          {shownPurchases.map((p) => {
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
                  <div className="mt-2 flex gap-4">
                    <button className="text-xs font-bold text-amber-700" onClick={() => setReturningPurchase(p)}>
                      مرجوعی به تأمین‌کننده
                    </button>
                    <button className="text-xs font-bold text-teal-700" onClick={() => setCorrectingPurchase(p)}>
                      اصلاح قیمت خرید
                    </button>
                  </div>
                )}
                {pending && (
                  <button className="mt-2 text-xs font-bold text-teal-700" onClick={() => setCorrectingPurchase(p)}>
                    اصلاح قیمت خرید
                  </button>
                )}
              </Card>
            )
          })}
          <div className="mt-3 grid grid-cols-2 gap-2 pb-2">
            <button
              onClick={() => {
                setSearch('')
                setFilter('all')
              }}
              className="rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-700"
            >
              همهٔ خریدها
            </button>
            <button onClick={() => setView('candidates')} className="rounded-xl bg-slate-100 py-2.5 text-sm font-bold text-slate-700">
              کاندیدهای خرید
            </button>
          </div>
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
      {correctingPurchase && <PurchasePriceCorrectionModal purchase={correctingPurchase} onClose={() => setCorrectingPurchase(null)} />}
      {detail && <SupplierDetailModal supplier={detail} onClose={() => setDetail(null)} />}
      {showLanding && <LandingCostModal onClose={() => setShowLanding(false)} />}
    </div>
  )
}
