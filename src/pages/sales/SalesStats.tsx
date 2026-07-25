import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum, fmtMoney } from '../../lib/format'
import { Card } from '../../components/ui'
import { STATS_PERIODS, periodBounds, periodLabel, type StatsPeriod } from '../../lib/period'

/** آمار فروش: مجموع دوره + پرفروش‌ترین اجناس + بهترین مشتریان */
export function SalesStats() {
  const [period, setPeriod] = useState<StatsPeriod>('today')

  const { from, to } = periodBounds(period)

  const sales = useLiveQuery(() => db.sales.where('date').between(from, to, true, true).filter((s) => !s.deleted).toArray(), [from, to])

  const total = sales?.reduce((s, x) => s + x.total, 0) ?? 0
  const cash = sales?.reduce((s, x) => s + x.paid, 0) ?? 0
  const pairs = sales?.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty, 0), 0) ?? 0
  const credit = Math.max(0, total - cash)

  const soldBy = new Map<string, { qty: number; revenue: number }>()
  sales?.forEach((s) =>
    s.lines.forEach((l) => {
      const key = `${l.productName} ${l.size} ${l.color}`.trim()
      const cur = soldBy.get(key) ?? { qty: 0, revenue: 0 }
      soldBy.set(key, { qty: cur.qty + l.qty, revenue: cur.revenue + l.qty * l.unitPrice })
    })
  )
  const topProducts = [...soldBy.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 8)

  const custBy = new Map<string, number>()
  sales?.forEach((s) => {
    if (s.customerName) custBy.set(s.customerName, (custBy.get(s.customerName) ?? 0) + s.total)
  })
  const topCustomers = [...custBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  return (
    <>
      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {STATS_PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${period === p.id ? 'bg-teal-700 text-white' : 'bg-white text-slate-600'}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white">
        <p className="text-sm opacity-80">مجموع فروش {periodLabel(period)}</p>
        <p className="text-3xl font-bold">{fmtMoney(total)}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>نقد: {fmtMoney(cash)}</span>
          {credit > 0 && <span>قرضی: {fmtMoney(credit)}</span>}
          <span>{fmtNum(sales?.length ?? 0)} فروش</span>
          <span>{fmtNum(pairs)} جوړه</span>
        </div>
      </div>

      <Card>
        <p className="mb-2 font-bold text-slate-700">🔥 پرفروش‌ترین اجناس</p>
        {topProducts.length === 0 && <p className="text-sm text-slate-400">فروشی در این دوره نیست.</p>}
        {topProducts.map(([name, d]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-600">{name}</span>
            <span className="text-left">
              <span className="font-bold text-slate-800">{fmtNum(d.qty)} جوړه</span>
              <span className="block text-xs text-slate-400">{fmtMoney(d.revenue)}</span>
            </span>
          </div>
        ))}
      </Card>

      <Card>
        <p className="mb-2 font-bold text-slate-700">⭐ بهترین مشتریان</p>
        {topCustomers.length === 0 && <p className="text-sm text-slate-400">فروش با نام مشتری در این دوره ثبت نشده.</p>}
        {topCustomers.map(([name, t]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-600">{name}</span>
            <span className="font-bold text-slate-800">{fmtMoney(t)}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

export default SalesStats
