import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { fmtNum, fmtMoney } from '../lib/format'
import { Card } from '../components/ui'

export default function Dashboard({ goTo }: { goTo: (tab: string) => void }) {
  const todayStart = new Date().setHours(0, 0, 0, 0)

  const todaySales = useLiveQuery(() => db.sales.where('date').aboveOrEqual(todayStart).toArray(), [todayStart])
  const variants = useLiveQuery(() => db.variants.toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const customers = useLiveQuery(() => db.customers.toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.toArray(), [])

  const todayTotal = todaySales?.reduce((s, x) => s + x.total, 0) ?? 0
  const todayCash = todaySales?.reduce((s, x) => s + x.paid, 0) ?? 0
  const todayProfit =
    todaySales?.reduce((sum, sale) => {
      return (
        sum +
        sale.lines.reduce((s, l) => {
          const v = variants?.find((v) => v.id === l.variantId)
          return s + (l.unitPrice - (v?.purchasePrice ?? 0)) * l.qty
        }, 0)
      )
    }, 0) ?? 0

  const stockCount = variants?.reduce((s, v) => s + v.stockQty, 0) ?? 0
  const stockValue = variants?.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0) ?? 0
  const receivable = customers?.reduce((s, c) => s + Math.max(0, c.balance), 0) ?? 0
  const payable = suppliers?.reduce((s, x) => s + Math.max(0, x.balance), 0) ?? 0

  const lowStock =
    variants?.filter((v) => v.stockQty <= v.lowStock).map((v) => ({
      v,
      p: products?.find((p) => p.id === v.productId)
    })) ?? []

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">داشبورد</h1>

      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white">
        <p className="text-sm opacity-80">فروش امروز</p>
        <p className="text-3xl font-bold">{fmtMoney(todayTotal)}</p>
        <div className="mt-2 flex gap-4 text-sm">
          <span>نقد: {fmtMoney(todayCash)}</span>
          <span>مفاد: {fmtMoney(todayProfit)}</span>
          <span>{fmtNum(todaySales?.length ?? 0)} فروش</span>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button onClick={() => goTo('inventory')} className="rounded-xl bg-white p-3 text-right shadow-sm">
          <p className="text-sm text-slate-500">موجودی گدام</p>
          <p className="text-lg font-bold text-slate-800">{fmtNum(stockCount)} جوړه</p>
          <p className="text-xs text-slate-400">ارزش: {fmtMoney(stockValue)}</p>
        </button>
        <button onClick={() => goTo('customers')} className="rounded-xl bg-white p-3 text-right shadow-sm">
          <p className="text-sm text-slate-500">طلب از مشتریان</p>
          <p className="text-lg font-bold text-red-600">{fmtMoney(receivable)}</p>
          <p className="text-xs text-slate-400">قرض ما به تأمین‌کنندگان: {fmtMoney(payable)}</p>
        </button>
      </div>

      {lowStock.length > 0 && (
        <Card>
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
