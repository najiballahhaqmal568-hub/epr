import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Purchase, type Supplier } from '../db'
import { receivePurchase, payLanding, landingUnpaidOf } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate } from '../lib/format'
import { inputCls, Empty } from '../components/ui'
import { Icon } from '../components/Icon'
import { reorderProducts } from '../lib/reorder'
import CandidatesView from './purchases/Candidates'
import LandingCostModal from './purchases/LandingCostModal'
import SupplierDetailModal from './purchases/SupplierDetailModal'
import { PurchaseReturnModal, SupplierReturnModal } from './purchases/ReturnModals'
import { NewSupplierModal, PaySupplierModal } from './purchases/SupplierModals'
import NewPurchaseModal from './purchases/NewPurchaseModal'
import LendersView from './purchases/LendersView'
import PurchasePriceCorrectionModal from './purchases/PurchasePriceCorrectionModal'
import PurchaseCancelModal from './purchases/PurchaseCancelModal'
import DirectTradeDetail from './sales/direct/DirectTradeDetail'
import { commercialPurchaseLines } from '../lib/commercialLines'
import { useDirectTradeReview } from '../components/DirectTradeWarning'

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
  const [directUuid, setDirectUuid] = useState<string | null>(null)
  const directReview = useDirectTradeReview()
  const [showNewSupplier, setShowNewSupplier] = useState<'supplier' | 'sarraf' | null>(null)
  const [payingSupplier, setPayingSupplier] = useState<number | null>(null)
  const [returningTo, setReturningTo] = useState<Supplier | null>(null)
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(null)
  const [correctingPurchase, setCorrectingPurchase] = useState<Purchase | null>(null)
  const [cancellingPurchase, setCancellingPurchase] = useState<Purchase | null>(null)
  const [detail, setDetail] = useState<Supplier | null>(null)
  const [showLanding, setShowLanding] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<PurchaseFilter>('all')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState('')
  const busyRef = useRef(false)

  // دکمهٔ «جنس رسید» و «پرداخت مصارف رسیدن» در وقت شلوغی دو بار زده می‌شود؛
  // خطای عملیات (مثلاً صندوق خالی) هم باید دیده شود، نه اینکه خاموش گم شود.
  async function runAction(id: number, action: () => Promise<void>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusyId(id)
    setActionError('')
    try {
      await action()
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error))
    } finally {
      busyRef.current = false
      setBusyId(null)
    }
  }

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
      `${purchase.supplierName} ${commercialPurchaseLines(purchase).map((line) => `${line.productName} ${line.size} ${line.color}`).join(' ')}`
        .toLowerCase()
        .includes(term)
    if (!matchesSearch) return false
    const remainder = purchase.directTrade ? directReview.states.find(s => s.purchase?.directTrade?.uuid === purchase.directTrade?.uuid)?.balances.supplierRemaining ?? 0 : purchase.total - purchase.paid - (purchase.sarrafAmount ?? 0)
    if (filter === 'debt') return remainder > 0
    if (filter === 'transit') return !purchase.directTrade && purchase.received === false
    return true
  })

  return (
    <div className="p-4">
      {(view === 'history' || view === 'candidates') && (
        <>
          <div className="page-heading"><div><h1>خرید</h1><p>خرید، رسیدن جنس و مصارف رسیدن</p></div></div>
          <section className="inventory-management" aria-label="مدیریت گدام">
            <div className="inventory-actions">
              <button onClick={onBack} disabled={!onBack} className="inventory-action">موجودی</button>
              <button onClick={() => setView('history')} className="inventory-active" aria-pressed="true">خرید</button>
              <button onClick={onOpenReorder} disabled={!onOpenReorder} className={`inventory-action ${reorderCount ? 'bg-amber-100 text-amber-800' : ''}`}>
                خرید مجدد {reorderCount > 0 && `(${fmtNum(reorderCount)})`}
              </button>
            </div>
          </section>
        </>
      )}

      {(view === 'suppliers' || view === 'sarrafs' || view === 'lenders') && (
        <>
          <div className="page-heading">
            <div><h1>حساب‌های خرید</h1><p>تأمین‌کنندگان، صراف‌ها و قرض‌دهنده‌ها</p></div>
            {onBack && <button onClick={onBack} className="customers-back" aria-label="برگشت">برگشت</button>}
          </div>
          <div className="segmented mb-4" role="group" aria-label="نوع حساب خرید">
            <button onClick={() => setView('suppliers')} aria-pressed={view === 'suppliers'}>تأمین‌کنندگان</button>
            <button onClick={() => setView('sarrafs')} aria-pressed={view === 'sarrafs'}>صراف‌ها</button>
            <button onClick={() => setView('lenders')} aria-pressed={view === 'lenders'}>قرض‌دهنده‌ها</button>
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
        <section aria-label="خریدها" className="purchase-history">
          <button onClick={() => setShowNew(true)} className="primary-button mb-3 flex items-center justify-center gap-2 py-4 text-lg">
            <Icon name="plus" /> ثبت خرید جدید
          </button>

          {(vendorDebt > 0 || lenderDebt > 0) && (
            <button onClick={onOpenAccounts} disabled={!onOpenAccounts} className="surface purchase-debt">
              <span>
                <span className="purchase-muted">قرض خرید</span>
                <span className="purchase-link">تأمین‌کنندگان و قرض‌دهندگان ←</span>
              </span>
              <strong className="inventory-money text-red-700">{fmtMoney(vendorDebt + lenderDebt)}</strong>
            </button>
          )}

          <button onClick={() => setShowLanding(true)} className="purchase-secondary" aria-label="ثبت مصارف رسیدن">
            ثبت مصارف رسیدن <span className="purchase-muted">کرایه، حمالی یا کمیشن</span>
          </button>

          <div className="surface purchase-filters">
            <input
              className={inputCls}
              type="search"
              aria-label="جستجوی خرید"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="تأمین‌کننده، جنس، سایز یا رنگ..."
            />
            <div className="segmented mt-3" role="group" aria-label="فلتر خرید">
              {([
                ['all', 'همه'],
                ['debt', 'قرض‌دار'],
                ['transit', 'در راه']
              ] as const).map(([id, label]) => (
                <button key={id} onClick={() => setFilter(id)} aria-pressed={filter === id}>{label}</button>
              ))}
            </div>
          </div>

          {actionError && (
            <div role="alert" className="mb-3 flex items-start justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
              <span>{actionError}</span>
              <button onClick={() => setActionError('')} aria-label="بستن پیام" className="shrink-0 font-bold">×</button>
            </div>
          )}

          <div className="purchase-list-heading">
            <h2>خریدهای اخیر</h2>
            <span>{fmtNum(shownPurchases.length)} خرید</span>
          </div>
          {shownPurchases.length === 0 && <Empty text={purchases?.length ? 'خریدی با این جستجو یا فلتر پیدا نشد.' : 'هنوز خریدی ثبت نشده.'} />}
          {shownPurchases.length > 0 && <div className="purchase-rows">
          {shownPurchases.map((p) => {
            if (p.directTrade) return (
              <article key={p.id} className="purchase-row">
                <button className="purchase-row-open" onClick={() => setDirectUuid(p.directTrade!.uuid)}>
                  <div className="purchase-row-heading">
                    <div className="min-w-0"><p className="font-bold">{p.supplierName}</p><p className="purchase-muted">خرید مستقیم · {fmtDate(p.date)} · بدون گدام</p></div>
                    <strong className="inventory-money">{fmtMoney(p.total)}</strong>
                  </div>
                  <p className="purchase-goods">{commercialPurchaseLines(p).map(l => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`).join('، ')}</p>
                  <span className="purchase-link">جزئیات معامله و باقی‌مانده ←</span>
                </button>
              </article>
            )
            const hawala = p.sarrafAmount ?? 0
            const remainder = p.total - p.paid - hawala
            const pending = p.received === false
            const landingDue = landingUnpaidOf(p)
            const busy = busyId === p.id
            return (
              <article key={p.id} className="purchase-row" aria-busy={busy}>
                <div className="purchase-row-heading">
                  <div className="min-w-0">
                    <p className="font-bold">{p.supplierName}</p>
                    <p className="purchase-muted">{fmtDate(p.date)}</p>
                  </div>
                  <div className="purchase-row-amount">
                    <strong className="inventory-money">{fmtMoney(p.total)}</strong>
                    {pending && <span className="purchase-badge purchase-badge-transit">در راه</span>}
                    {remainder > 0 ? <span className="purchase-badge purchase-badge-debt">باقی: {fmtMoney(remainder)}</span> : <span className="purchase-badge purchase-badge-paid">پرداخت شده</span>}
                  </div>
                </div>
                <p className="purchase-goods">{p.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}</p>
                {(hawala > 0 || (p.landingCost ?? 0) > 0) && (
                  <p className="purchase-meta">
                    {hawala > 0 && <span>حواله {p.sarrafName}: {fmtMoney(hawala)}</span>}
                    {(p.landingCost ?? 0) > 0 && <span>مصارف رسیدن: {fmtMoney(p.landingCost!)}</span>}
                  </p>
                )}
                {pending && (
                  <button disabled={busy} onClick={() => void runAction(p.id!, () => receivePurchase(p.id!))} className="primary-button mt-3">
                    {busy ? 'در حال ثبت…' : 'جنس رسید — به گدام اضافه شود'}
                  </button>
                )}
                {landingDue > 0 && (
                  <button disabled={busy} onClick={() => void runAction(p.id!, () => payLanding(p.id!))} className="purchase-landing-pay">
                    پرداخت مصارف رسیدن ({fmtMoney(landingDue)}) — نقد از صندوق
                  </button>
                )}
                <div className="purchase-row-actions">
                  {!pending && <button className="text-amber-800" onClick={() => setReturningPurchase(p)}>مرجوعی به تأمین‌کننده</button>}
                  <button onClick={() => setCorrectingPurchase(p)}>اصلاح خرید</button>
                  <button className="text-red-700" onClick={() => setCancellingPurchase(p)}>خرید اشتباهی</button>
                </div>
              </article>
            )
          })}
          </div>}
          <div className="mt-4 grid grid-cols-2 gap-2 pb-2">
            <button
              onClick={() => {
                setSearch('')
                setFilter('all')
              }}
              className="purchase-secondary"
            >
              همهٔ خریدها
            </button>
            <button onClick={() => setView('candidates')} className="purchase-secondary">
              کاندیدهای خرید
            </button>
          </div>
        </section>
      )}

      {view === 'suppliers' && (
        <>
          <button onClick={() => setShowNewSupplier('supplier')} className="primary-button mb-3">＋ تأمین‌کنندهٔ جدید</button>
          {vendors?.length === 0 && <Empty text="تأمین‌کننده‌ای ثبت نشده." />}
          {!!vendors?.length && <section className="surface customers-list" aria-label="فهرست تأمین‌کنندگان">
            {vendors.map((s) => (
              <div key={s.id} className="customer-row">
                <button className="customer-row-main text-start" onClick={() => setDetail(s)}>
                  <span className="customer-row-name">{s.name}</span>
                  {s.phone && <small dir="ltr" className="customer-row-phone">{s.phone}</small>}
                  <small className="purchase-link">جزئیات ←</small>
                </button>
                <span className="customer-row-amount">
                  <strong className={`inventory-money ${s.balance > 0 ? 'text-red-700' : s.balance < 0 ? 'text-teal-700' : ''}`}>{fmtMoney(Math.abs(s.balance))}</strong>
                  <small>{s.balance > 0 ? 'قرض ما' : s.balance < 0 ? 'طلب ما' : 'تصفیه'}</small>
                </span>
                <div className="purchase-row-actions w-full">
                  <button onClick={() => setPayingSupplier(s.id!)}>{s.balance > 0 ? 'پرداخت قرض' : 'پیشکی'}</button>
                  <button className="text-amber-800" onClick={() => setReturningTo(s)}>مرجوعی جنس</button>
                </div>
              </div>
            ))}
          </section>}
        </>
      )}

      {view === 'sarrafs' && (
        <>
          <button onClick={() => setShowNewSupplier('sarraf')} className="primary-button mb-3">＋ صراف جدید</button>
          {sarrafs?.length === 0 && <Empty text="صرافی ثبت نشده. صراف کسی است که برای شما حواله می‌کند." />}
          {!!sarrafs?.length && <section className="surface customers-list" aria-label="فهرست صراف‌ها">
            {sarrafs.map((s) => (
              <div key={s.id} className="customer-row">
                <button className="customer-row-main text-start" onClick={() => setDetail(s)}>
                  <span className="customer-row-name">{s.name}</span>
                  {s.phone && <small dir="ltr" className="customer-row-phone">{s.phone}</small>}
                  <small className="purchase-link">جزئیات ←</small>
                </button>
                <span className="customer-row-amount">
                  <strong className={`inventory-money ${s.balance > 0 ? 'text-red-700' : s.balance < 0 ? 'text-teal-700' : ''}`}>{fmtMoney(Math.abs(s.balance))}</strong>
                  <small>{s.balance > 0 ? 'قرض ما به صراف' : s.balance < 0 ? 'طلب ما از صراف' : 'تصفیه'}</small>
                </span>
                <div className="purchase-row-actions w-full">
                  <button onClick={() => setPayingSupplier(s.id!)}>{s.balance > 0 ? 'پرداخت به صراف' : 'پیشکی به صراف'}</button>
                </div>
              </div>
            ))}
          </section>}
        </>
      )}

      {showNew && <NewPurchaseModal onClose={() => setShowNew(false)} />}
      {showNewSupplier && <NewSupplierModal kind={showNewSupplier} onClose={() => setShowNewSupplier(null)} />}
      {payingSupplier != null && <PaySupplierModal supplierId={payingSupplier} onClose={() => setPayingSupplier(null)} />}
      {returningTo && <SupplierReturnModal supplier={returningTo} onClose={() => setReturningTo(null)} />}
      {returningPurchase && <PurchaseReturnModal purchase={returningPurchase} onClose={() => setReturningPurchase(null)} />}
      {directUuid && <DirectTradeDetail tradeUuid={directUuid} onClose={() => setDirectUuid(null)} />}
      {correctingPurchase && <PurchasePriceCorrectionModal purchase={correctingPurchase} onClose={() => setCorrectingPurchase(null)} />}
      {cancellingPurchase && <PurchaseCancelModal purchase={cancellingPurchase} onClose={() => setCancellingPurchase(null)} />}
      {detail && <SupplierDetailModal supplier={detail} onClose={() => setDetail(null)} />}
      {showLanding && <LandingCostModal onClose={() => setShowLanding(false)} />}
    </div>
  )
}
