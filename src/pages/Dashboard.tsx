import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type Variant } from '../db'
import { fmtNum, fmtMoney, fmtDateShort, startOfDay, startOfMonth, startOfYear } from '../lib/format'
import { useSyncStatus, syncNow } from '../lib/sync'
import { Card } from '../components/ui'

function SyncChip() {
  const s = useSyncStatus()
  if (s.state === 'off') return null
  const label =
    s.state === 'syncing' ? '⏳ همگام‌سازی...' : s.state === 'offline' ? '📴 آفلاین' : s.state === 'error' ? '⚠️ خطای سرور' : '☁️ همگام'
  return (
    <button
      onClick={() => void syncNow()}
      aria-label="sync"
      title={s.message}
      className={`rounded-full px-2 py-1 text-xs font-bold ${
        s.state === 'ok' ? 'bg-teal-50 text-teal-700' : s.state === 'error' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500'
      }`}
    >
      {label}
    </button>
  )
}

export default function Dashboard({ goTo, isStaff }: { goTo: (tab: string) => void; isStaff?: boolean }) {
  const dayStart = startOfDay()
  const monthStart = startOfMonth()
  const yearStart = startOfYear()

  const sales = useLiveQuery(() => db.sales.where('date').aboveOrEqual(yearStart).filter((s) => !s.deleted).toArray(), [yearStart])
  const expenses = useLiveQuery(() => db.expenses.where('date').aboveOrEqual(yearStart).filter((e) => !e.deleted).toArray(), [yearStart])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deleted).toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted).toArray(), [])
  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])

  const variantMap = new Map<number, Variant>()
  variants?.forEach((v) => variantMap.set(v.id!, v))

  const grossProfit = (list: Sale[]) =>
    list.reduce(
      (sum, sale) =>
        sum +
        sale.lines.reduce((s, l) => s + (l.unitPrice - (variantMap.get(l.variantId)?.purchasePrice ?? 0)) * l.qty, 0) -
        (sale.discount ?? 0),
      0
    )

  const todaySales = sales?.filter((s) => s.date >= dayStart) ?? []
  const monthSales = sales?.filter((s) => s.date >= monthStart) ?? []

  const todayTotal = todaySales.reduce((s, x) => s + x.total, 0)
  const todayCash = todaySales.reduce((s, x) => s + x.paid, 0)
  const todayProfit = grossProfit(todaySales)

  const monthExpenses = expenses?.filter((e) => e.date >= monthStart && e.type === 'business').reduce((s, e) => s + e.amount, 0) ?? 0
  const yearExpenses = expenses?.filter((e) => e.type === 'business').reduce((s, e) => s + e.amount, 0) ?? 0
  const monthNet = grossProfit(monthSales) - monthExpenses
  const yearNet = grossProfit(sales ?? []) - yearExpenses

  const cashBalance = movements?.reduce((s, m) => s + m.amount, 0) ?? 0
  const stockCount = variants?.reduce((s, v) => s + v.stockQty, 0) ?? 0
  const stockValue = variants?.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0) ?? 0
  const receivable = customers?.reduce((s, c) => s + Math.max(0, c.balance), 0) ?? 0
  const payable = suppliers?.filter((x) => x.kind !== 'partner').reduce((s, x) => s + Math.max(0, x.balance), 0) ?? 0
  const suppCredit = suppliers?.filter((x) => x.kind !== 'partner').reduce((s, x) => s + Math.max(0, -x.balance), 0) ?? 0

  const overdue = (customers ?? [])
    .filter((c) => c.balance > 0 && c.promiseDate && c.promiseDate < dayStart)
    .sort((a, b) => (a.promiseDate ?? 0) - (b.promiseDate ?? 0))

  const lowStock =
    variants?.filter((v) => v.stockQty <= v.lowStock).map((v) => ({
      v,
      p: products?.find((p) => p.id === v.productId)
    })) ?? []

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">داشبورد</h1>
        <div className="flex items-center gap-2">
          <SyncChip />
          {!isStaff && (
            <button onClick={() => goTo('reports')} className="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-bold text-teal-800">
              📊 راپورها
            </button>
          )}
          <button onClick={() => goTo('settings')} className="rounded-full bg-slate-100 px-3 py-1.5 text-lg" aria-label="تنظیمات">
            ⚙️
          </button>
        </div>
      </div>

      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white">
        <p className="text-sm opacity-80">فروش امروز</p>
        <p className="text-3xl font-bold">{fmtMoney(todayTotal)}</p>
        <div className="mt-2 flex gap-4 text-sm">
          <span>نقد: {fmtMoney(todayCash)}</span>
          <span>مفاد: {fmtMoney(todayProfit)}</span>
          <span>{fmtNum(todaySales.length)} فروش</span>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm text-slate-500">مفاد خالص این ماه</p>
          <p className={`text-lg font-bold ${monthNet >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{fmtMoney(monthNet)}</p>
          <p className="text-xs text-slate-400">مصارف ماه: {fmtMoney(monthExpenses)}</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm text-slate-500">مفاد خالص امسال</p>
          <p className={`text-lg font-bold ${yearNet >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{fmtMoney(yearNet)}</p>
        </div>
        <button onClick={() => goTo('expenses')} className="rounded-xl bg-white p-3 text-right shadow-sm">
          <p className="text-sm text-slate-500">صندوق</p>
          <p className="text-lg font-bold text-slate-800">{fmtMoney(cashBalance)}</p>
        </button>
        <button onClick={() => goTo('inventory')} className="rounded-xl bg-white p-3 text-right shadow-sm">
          <p className="text-sm text-slate-500">موجودی گدام</p>
          <p className="text-lg font-bold text-slate-800">{fmtNum(stockCount)} جوړه</p>
          <p className="text-xs text-slate-400">ارزش: {fmtMoney(stockValue)}</p>
        </button>
        <button onClick={() => goTo('customers')} className="col-span-2 rounded-xl bg-white p-3 text-right shadow-sm">
          <div className="flex justify-between">
            <div>
              <p className="text-sm text-slate-500">طلب از مشتریان</p>
              <p className="text-lg font-bold text-red-600">{fmtMoney(receivable)}</p>
            </div>
            <div className="text-left">
              <p className="text-sm text-slate-500">قرض ما به تأمین‌کنندگان</p>
              <p className="text-lg font-bold text-amber-600">{fmtMoney(payable)}</p>
              {suppCredit > 0 && <p className="text-xs font-bold text-teal-700">طلب ما (پیشکی): {fmtMoney(suppCredit)}</p>}
            </div>
          </div>
        </button>
      </div>

      {overdue.length > 0 && (
        <Card onClick={() => goTo('customers')}>
          <p className="mb-2 font-bold text-red-600">⏰ وعده‌های گذشته ({fmtNum(overdue.length)})</p>
          {overdue.slice(0, 5).map((c) => (
            <div key={c.id} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
              <span>
                {c.name} <span className="text-slate-400">({fmtDateShort(c.promiseDate!)})</span>
              </span>
              <span className="font-bold text-red-600">{fmtMoney(c.balance)}</span>
            </div>
          ))}
        </Card>
      )}

      {lowStock.length > 0 && (
        <Card onClick={() => goTo('inventory')}>
          <p className="mb-2 font-bold text-red-600">⚠️ موجودی کم</p>
          {lowStock.slice(0, 8).map(({ v, p }) => (
            <div key={v.id} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
              <span>
                {p?.name} — {v.size} {v.color}
              </span>
              <span className="font-bold text-red-600">{fmtNum(v.stockQty)} باقی</span>
            </div>
          ))}
        </Card>
      )}

      <div className="mt-2 grid grid-cols-2 gap-2">
        <button onClick={() => goTo('sales')} className="rounded-xl bg-teal-50 p-4 text-center font-bold text-teal-800">
          🧾 فروش جدید
        </button>
        <button onClick={() => goTo('purchases')} className="rounded-xl bg-amber-50 p-4 text-center font-bold text-amber-800">
          📦 خرید جدید
        </button>
      </div>
    </div>
  )
}
