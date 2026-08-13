import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ExpenseType } from '../../db'
import { fmtNum, fmtMoney } from '../../lib/format'
import { Card } from '../../components/ui'
import { STATS_PERIODS, periodBounds, periodLabel, type StatsPeriod } from '../../lib/period'
import { TYPE_LABELS, TYPE_COLORS } from './labels'

/** آمار مصارف: مجموع دوره به تفکیک نوع + کتگوری */
export function ExpenseStats() {
  const [period, setPeriod] = useState<StatsPeriod>('today')

  const { from, to } = periodBounds(period)

  const expenses = useLiveQuery(
    () => db.expenses.where('date').between(from, to, true, true).filter((e) => !e.deleted && !e.shopClosed).toArray(),
    [from, to]
  )

  const total = expenses?.reduce((s, e) => s + e.amount, 0) ?? 0
  const ofType = (t: ExpenseType) => expenses?.filter((e) => e.type === t).reduce((s, e) => s + e.amount, 0) ?? 0

  const byCat = new Map<string, number>()
  expenses?.forEach((e) => {
    const key = e.type === 'withdrawal' ? 'برداشت مالک' : e.categoryName
    byCat.set(key, (byCat.get(key) ?? 0) + e.amount)
  })
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1])

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

      <div className="mb-3 rounded-2xl bg-red-700 p-4 text-white">
        <p className="text-sm opacity-80">مجموع مصارف {periodLabel(period)}</p>
        <p className="text-3xl font-bold">{fmtMoney(total)}</p>
        <p className="mt-2 text-sm">{fmtNum(expenses?.length ?? 0)} مصرف</p>
      </div>

      <Card>
        <p className="mb-2 font-bold text-slate-700">به تفکیک نوع</p>
        {(Object.keys(TYPE_LABELS) as ExpenseType[]).map((t) => (
          <div key={t} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-600">
              {TYPE_LABELS[t]}
              {t === 'business' && <span className="mr-1 text-xs text-slate-400">(از مفاد کم می‌شود)</span>}
            </span>
            <span className={`font-bold ${TYPE_COLORS[t]}`}>{fmtMoney(ofType(t))}</span>
          </div>
        ))}
      </Card>

      <Card>
        <p className="mb-2 font-bold text-slate-700">به تفکیک کتگوری</p>
        {catRows.length === 0 && <p className="text-sm text-slate-400">مصرفی در این دوره نیست.</p>}
        {catRows.map(([name, amt]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-600">{name}</span>
            <span className="font-bold text-slate-800">{fmtMoney(amt)}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

export default ExpenseStats
