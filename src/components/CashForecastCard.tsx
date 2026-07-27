import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { fmtNum, fmtMoney, fmtDateShort, startOfDay } from '../lib/format'
import { Card } from './ui'
import { buildForecast, type FlowItem } from '../lib/cashflow'

const RANGES = [
  { days: 7, label: '۷ روز' },
  { days: 15, label: '۱۵ روز' },
  { days: 30, label: 'یک ماه' }
]

/** پول آینده: آنچه می‌آید، آنچه باید داده شود، و تخمین پایان دوره */
export function CashForecastCard() {
  const [days, setDays] = useState(7)
  const [open, setOpen] = useState<'in' | 'out' | null>(null)

  const data = useLiveQuery(async () => {
    const [movements, customers, suppliers, purchases] = await Promise.all([
      db.cashMovements.filter((m) => !m.deleted).toArray(),
      db.customers.filter((c) => !c.deleted).toArray(),
      db.suppliers.filter((x) => !x.deleted).toArray(),
      db.purchases.filter((p) => !p.deleted && Boolean(p.landingCost)).toArray()
    ])
    return { cash: movements.reduce((s, m) => s + m.amount, 0), customers, suppliers, purchases }
  }, [])

  if (!data) return null
  const until = startOfDay() + days * 86400000
  const f = buildForecast(data.cash, data.customers, data.suppliers, data.purchases, until)

  if (f.incomingTotal === 0 && f.outgoingTotal === 0 && f.noPromise === 0) return null

  const short = f.projected < 0
  const tight = !short && f.projected < f.cashNow * 0.2

  const list = (items: FlowItem[], tone: 'teal' | 'red') => (
    <div className="mt-2">
      {items.length === 0 && <p className="text-sm text-slate-400">چیزی نیست.</p>}
      {items.map((i) => (
        <div key={i.key} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
          <span className="min-w-0 flex-1 truncate text-slate-700">
            {i.name}
            {i.due && (
              <span className={`block text-xs ${i.overdue ? 'font-bold text-red-600' : 'text-slate-400'}`}>
                {i.overdue ? '⏰ وعده گذشته: ' : 'وعده: '}
                {fmtDateShort(i.due)}
              </span>
            )}
            {i.kind === 'lender' && <span className="block text-xs text-purple-600">قرض از شخص</span>}
            {i.kind === 'landing' && <span className="block text-xs text-amber-600">مصارف رسیدن</span>}
          </span>
          <span className={`shrink-0 font-bold ${tone === 'teal' ? 'text-teal-700' : 'text-red-600'}`}>{fmtMoney(i.amount)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-slate-700">🔮 پول آینده</p>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.days}
              onClick={() => setDays(r.days)}
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${days === r.days ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between py-1">
          <span className="text-slate-600">پول امروز (همهٔ جاها)</span>
          <span className="font-bold text-slate-800">{fmtMoney(f.cashNow)}</span>
        </div>
        <button onClick={() => setOpen(open === 'in' ? null : 'in')} className="flex w-full justify-between py-1 text-right">
          <span className="text-slate-600">
            ＋ طلب با وعده ({fmtNum(f.incoming.length)}) <span className="text-xs text-slate-400">{open === 'in' ? '▲' : '▼'}</span>
          </span>
          <span className="font-bold text-teal-700">{fmtMoney(f.incomingTotal)}</span>
        </button>
        {open === 'in' && list(f.incoming, 'teal')}
        <button onClick={() => setOpen(open === 'out' ? null : 'out')} className="flex w-full justify-between py-1 text-right">
          <span className="text-slate-600">
            − قرض ما ({fmtNum(f.outgoing.length)}) <span className="text-xs text-slate-400">{open === 'out' ? '▲' : '▼'}</span>
          </span>
          <span className="font-bold text-red-600">{fmtMoney(f.outgoingTotal)}</span>
        </button>
        {open === 'out' && list(f.outgoing, 'red')}
        <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-2">
          <span className="font-bold text-slate-700">تخمین بعد از {RANGES.find((r) => r.days === days)?.label}</span>
          <span className={`text-xl font-bold ${short ? 'text-red-600' : tight ? 'text-amber-600' : 'text-teal-700'}`}>
            {fmtMoney(f.projected)}
          </span>
        </div>
      </div>

      {short && (
        <p className="mt-2 rounded-xl bg-red-50 p-2.5 text-xs font-bold text-red-700">
          ⚠️ اگر همهٔ قرض‌ها را بدهید، پول کم می‌آید. پیش از خرید نو، اول از قرضداران تقاضا کنید.
        </p>
      )}
      {tight && (
        <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs font-bold text-amber-800">
          ⚠️ پول تنگ می‌شود — برای خرید نو احتیاط کنید.
        </p>
      )}
      {f.overdueTotal > 0 && (
        <p className="mt-2 text-xs text-red-600">⏰ {fmtMoney(f.overdueTotal)} از وعده‌اش گذشته — امروز تقاضا کنید.</p>
      )}
      {f.noPromise > 0 && (
        <p className="mt-1 text-xs text-slate-400">
          {fmtMoney(f.noPromise)} طلب بدون وعده — در تخمین حساب نشده. برایشان وعده بگذارید تا اینجا بیاید.
        </p>
      )}
    </Card>
  )
}

export default CashForecastCard
