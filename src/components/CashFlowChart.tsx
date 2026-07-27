import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { fmtNum, fmtMoney, fmtDateShort, startOfDay } from '../lib/format'
import { boxOf, SHOP_BOX } from '../lib/ops'
import { Card } from './ui'
import { dailyFlow } from '../lib/cashflow'

const short = (n: number) => (Math.abs(n) >= 1000 ? `${fmtNum(Math.round(n / 1000))}هـ` : fmtNum(Math.round(n)))

const RANGES = [
  { days: 7, label: '۷ روز' },
  { days: 14, label: '۱۴ روز' },
  { days: 30, label: 'یک ماه' }
]

/** نمودار روزانهٔ جریان پول: ستون آمد و رفت هر روز + خط موجودی */
export function CashFlowChart({ box }: { box?: string }) {
  const [days, setDays] = useState(7)

  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])
  if (!movements) return null

  const scoped = box ? movements.filter((m) => boxOf(m) === box) : movements
  if (scoped.length === 0) return null

  const rows = dailyFlow(scoped, days, (ts) => fmtDateShort(ts).split(' ')[0], startOfDay)
  const maxBar = Math.max(1, ...rows.map((r) => Math.max(r.inflow, r.outflow)))
  const maxBal = Math.max(1, ...rows.map((r) => Math.abs(r.balance)))
  const totalIn = rows.reduce((s, r) => s + r.inflow, 0)
  const totalOut = rows.reduce((s, r) => s + r.outflow, 0)

  return (
    <Card>
      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-slate-700">📊 جریان پول {box ? `— ${box}` : '(همهٔ جاها)'}</p>
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

      <div className="mb-2 flex justify-between text-sm">
        <span className="font-bold text-teal-700">＋{fmtMoney(totalIn)}</span>
        <span className="font-bold text-red-600">−{fmtMoney(totalOut)}</span>
        <span className={`font-bold ${totalIn - totalOut >= 0 ? 'text-teal-700' : 'text-red-600'}`}>
          خالص: {fmtMoney(totalIn - totalOut)}
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="flex min-w-full items-end gap-1" style={{ minWidth: days > 14 ? days * 26 : undefined }}>
          {rows.map((r) => (
            <div key={r.day} className="flex flex-1 flex-col items-center gap-0.5">
              {/* موجودی پایان روز */}
              <div className="flex w-full items-end justify-center" style={{ height: 34 }}>
                <div
                  className={`w-full rounded-t ${r.balance < 0 ? 'bg-red-200' : 'bg-slate-200'}`}
                  style={{ height: `${Math.max(3, (Math.abs(r.balance) / maxBal) * 100)}%` }}
                  title={`موجودی: ${fmtMoney(r.balance)}`}
                />
              </div>
              {/* آمد و رفت */}
              <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 60 }}>
                <div
                  className="w-2 rounded-t bg-teal-600"
                  style={{ height: `${r.inflow > 0 ? Math.max(3, (r.inflow / maxBar) * 100) : 0}%` }}
                  title={`آمد: ${fmtMoney(r.inflow)}`}
                />
                <div
                  className="w-2 rounded-t bg-red-500"
                  style={{ height: `${r.outflow > 0 ? Math.max(3, (r.outflow / maxBar) * 100) : 0}%` }}
                  title={`رفت: ${fmtMoney(r.outflow)}`}
                />
              </div>
              <span className="text-[10px] text-slate-500">{r.label}</span>
              {days <= 7 && <span className="text-[10px] text-slate-400">{short(r.balance)}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap justify-center gap-3 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-teal-600" /> آمد
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-red-500" /> رفت
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-slate-300" /> موجودی پایان روز
        </span>
      </div>
    </Card>
  )
}

/** هشدار وقتی پول دکان از حد پایین کمتر شود */
export function LowCashBanner({ onGo }: { onGo?: () => void }) {
  const data = useLiveQuery(async () => {
    const limit = Number((await db.settings.get('lowCashLimit'))?.value ?? 0)
    if (limit <= 0) return null
    const all = await db.cashMovements.filter((m) => !m.deleted && boxOf(m) === SHOP_BOX).toArray()
    return { limit, balance: all.reduce((s, m) => s + m.amount, 0) }
  }, [])

  if (!data || data.balance >= data.limit) return null
  return (
    <button
      onClick={onGo}
      className="mb-3 w-full rounded-xl bg-amber-500 p-3 text-right font-bold text-white"
    >
      ⚠️ پول دکان کم شده: {fmtMoney(data.balance)} — حد پایین شما {fmtMoney(data.limit)} است
    </button>
  )
}

export default CashFlowChart
