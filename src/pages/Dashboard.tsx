import { useLiveQuery } from 'dexie-react-hooks'
import { db, saleCashPaid, type Sale, type Variant } from '../db'
import { netWorth } from '../lib/networth'
import { fmtMoney, fmtNum, startOfDay } from '../lib/format'
import { reorderProducts } from '../lib/reorder'
import { syncNow, useSyncStatus } from '../lib/sync'

function SyncChip() {
  const status = useSyncStatus()
  if (status.state === 'off') return null

  const label =
    status.state === 'syncing'
      ? 'در حال همگام‌سازی'
      : status.state === 'offline'
        ? 'آفلاین'
        : status.state === 'error'
          ? 'خطای همگام‌سازی'
          : 'همگام است'

  return (
    <button
      onClick={() => {
        if (status.state === 'error' && status.message) window.alert(`خطای همگام‌سازی:\n${status.message}`)
        void syncNow()
      }}
      aria-label="وضعیت همگام‌سازی"
      title={status.message}
      className={`rounded-full px-3 py-1.5 text-xs font-bold ${
        status.state === 'ok'
          ? 'bg-teal-50 text-teal-700'
          : status.state === 'error'
            ? 'bg-red-50 text-red-600'
            : status.state === 'offline'
              ? 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-600'
      }`}
    >
      {label}
    </button>
  )
}

export default function Dashboard({
  goTo,
  isStaff,
  pendingExpenseCount,
  debtCount,
  debtTotal
}: {
  goTo: (tab: string) => void
  isStaff?: boolean
  pendingExpenseCount: number
  debtCount: number
  debtTotal: number
}) {
  const dayStart = startOfDay()
  const sales = useLiveQuery(
    () => db.sales.where('date').aboveOrEqual(dayStart).filter((row) => !row.deleted).toArray(),
    [dayStart]
  )
  const returns = useLiveQuery(
    () => db.returns.where('date').aboveOrEqual(dayStart).filter((row) => !row.deleted && row.kind === 'customer').toArray(),
    [dayStart]
  )
  const variants = useLiveQuery(() => db.variants.filter((row) => !row.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((row) => !row.deleted).toArray(), [])
  const customers = useLiveQuery(() => db.customers.filter((row) => !row.deleted).toArray(), [])
  const worth = useLiveQuery(() => netWorth(), [])

  const variantMap = new Map<number, Variant>()
  variants?.forEach((variant) => variantMap.set(variant.id!, variant))
  const costOf = (line: { variantId: number; unitCost?: number }) =>
    line.unitCost ?? variantMap.get(line.variantId)?.purchasePrice ?? 0
  const grossProfit = (list: Sale[]) =>
    list.reduce(
      (sum, sale) =>
        sum + sale.lines.reduce((lineSum, line) => lineSum + (line.unitPrice - costOf(line)) * line.qty, 0) - (sale.discount ?? 0),
      0
    )
  const returnedProfit = (returns ?? []).reduce(
    (sum, row) => sum + row.lines.reduce((lineSum, line) => lineSum + (line.unitPrice - (line.unitCost ?? 0)) * line.qty, 0),
    0
  )

  const todaySales = sales ?? []
  const todayTotal = todaySales.reduce((sum, row) => sum + row.total, 0)
  const todayCash = todaySales.reduce((sum, row) => sum + saleCashPaid(row), 0)
  const todayProfit = grossProfit(todaySales) - returnedProfit
  const lowStock = reorderProducts(products ?? [], variants ?? [])
  const overdueCount = (customers ?? []).filter(
    (row) => row.balance > 0 && Boolean(row.promiseDate) && row.promiseDate! < dayStart
  ).length
  const hasTasks = pendingExpenseCount > 0 || lowStock.length > 0 || debtCount > 0 || overdueCount > 0

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">خانه</h1>
        <SyncChip />
      </div>

      {sales !== undefined && variants !== undefined && sales.length === 0 && variants.length === 0 && (
        <div className="mb-3 rounded-2xl border-2 border-dashed border-teal-300 bg-teal-50 p-4 text-sm text-slate-700">
          <p className="mb-2 font-bold text-teal-800">برای شروع فروشگاه:</p>
          <p>۱. اجناس و قیمت‌ها را در گدام ثبت کنید.</p>
          <p>۲. موجودی صندوق را در مصارف و صندوق تصفیه کنید.</p>
          <p>۳. حساب‌های قبلی مشتریان و تأمین‌کنندگان را ثبت کنید.</p>
        </div>
      )}

      <button
        onClick={() => goTo('sales-new')}
        className="mb-2 w-full rounded-2xl bg-teal-700 py-4 text-lg font-bold text-white shadow-sm active:bg-teal-800"
      >
        فروش جدید
      </button>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button onClick={() => goTo('purchases-new')} className="rounded-2xl border border-slate-200 bg-white py-3 font-bold text-slate-700">
          خرید جدید
        </button>
        <button onClick={() => goTo('expenses-new')} className="rounded-2xl border border-slate-200 bg-white py-3 font-bold text-slate-700">
          مصرف جدید
        </button>
      </div>

      <div className="mb-4 rounded-2xl bg-teal-800 p-4 text-white shadow-sm">
        <p className="text-sm text-teal-100">فروش امروز</p>
        <p className="mt-1 text-3xl font-bold">{fmtMoney(todayTotal)}</p>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-teal-50">
          <span>{fmtNum(todaySales.length)} فروش</span>
          <span>نقد: {fmtMoney(todayCash)}</span>
          {!isStaff && <span>مفاد: {fmtMoney(todayProfit)}</span>}
        </div>
      </div>

      <section className="mb-4">
        <h2 className="mb-2 text-lg font-bold text-slate-800">کارهای امروز</h2>
        {!hasTasks && <div className="rounded-2xl bg-teal-50 p-3 text-sm font-bold text-teal-700">کار ضروری ثبت‌نشده ندارید.</div>}
        <div className="space-y-2">
          {pendingExpenseCount > 0 && (
            <button onClick={() => goTo('expenses')} className="w-full rounded-2xl bg-amber-100 p-3 text-right text-amber-900">
              <span className="block font-bold">{fmtNum(pendingExpenseCount)} مصرف روزانه ثبت نشده</span>
              <span className="text-xs">برای ثبت، اینجا بزنید.</span>
            </button>
          )}
          {lowStock.length > 0 && (
            <button onClick={() => goTo('inventory')} className="w-full rounded-2xl bg-red-50 p-3 text-right text-red-700">
              <span className="block font-bold">{fmtNum(lowStock.length)} جنس برای خرید مجدد</span>
              <span className="text-xs">موجودی آن‌ها به حد تعیین‌شده رسیده است.</span>
            </button>
          )}
          {debtCount > 0 && (
            <button onClick={() => goTo('accounts')} className="w-full rounded-2xl bg-blue-50 p-3 text-right text-blue-800">
              <span className="block font-bold">{fmtNum(debtCount)} مشتری قرضدار — {fmtMoney(debtTotal)}</span>
              <span className="text-xs">{overdueCount > 0 ? `${fmtNum(overdueCount)} وعده گذشته است.` : 'حساب‌های مشتریان را ببینید.'}</span>
            </button>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">خلاصهٔ حساب</h2>
          {!isStaff && (
            <button onClick={() => goTo('reports')} className="text-sm font-bold text-teal-700">
              راپور کامل
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => goTo('accounts')} className="rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">طلب از مشتریان</span>
            <span className="block text-lg font-bold text-red-600">{fmtMoney(worth?.receivables ?? 0)}</span>
          </button>
          <button onClick={() => goTo('expenses')} className="rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">صندوق</span>
            <span className="block text-lg font-bold text-slate-800">{fmtMoney(worth?.cash ?? 0)}</span>
          </button>
          <button onClick={() => goTo('inventory')} className="rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">موجودی گدام</span>
            <span className="block text-lg font-bold text-teal-700">{fmtNum(worth?.pairs ?? 0)} جوړه</span>
          </button>
          <button onClick={() => goTo('accounts')} className="rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">قرض ما</span>
            <span className="block text-lg font-bold text-amber-700">{fmtMoney(worth?.payables ?? 0)}</span>
          </button>
        </div>
      </section>
    </div>
  )
}
