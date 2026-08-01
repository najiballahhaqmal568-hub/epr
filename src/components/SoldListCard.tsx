import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type ReturnDoc } from '../db'
import { fmtNum, fmtMoney, fmtDateShort } from '../lib/format'
import { soldInPeriod } from '../lib/sold'
import { Card } from './ui'

/**
 * لیست کامل اجناسی که در دوره فروخته شده — نه فقط پرفروش‌ترین‌ها.
 * برای حساب ماهانه: فقط همین‌ها را از سر بشمارید.
 */
export default function SoldListCard({
  sales,
  returns,
  showProfit
}: {
  sales: Sale[]
  returns: ReturnDoc[]
  showProfit?: boolean
}) {
  const [open, setOpen] = useState(false)
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const rows = soldInPeriod(sales, returns)
  const stockOf = (id: number) => variants?.find((v) => v.id === id)?.stockQty

  const totalQty = rows.reduce((s, r) => s + r.qty, 0)
  const totalRev = rows.reduce((s, r) => s + r.revenue, 0)
  const totalProfit = rows.reduce((s, r) => s + (r.revenue - r.cost), 0)

  return (
    <Card>
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-right">
        <span>
          <span className="font-bold text-slate-700">📋 اجناس فروخته‌شدهٔ این دوره</span>
          <span className="block text-xs text-slate-400">
            {rows.length === 0
              ? 'فروشی در این دوره نیست'
              : `${fmtNum(rows.length)} سایز · ${fmtNum(totalQty)} جوړه — برای حساب ماهانه فقط همین‌ها را بشمارید`}
          </span>
        </span>
        <span className="text-sm font-bold text-teal-700">{open ? '▲' : '▼'}</span>
      </button>

      {open && rows.length > 0 && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between border-b border-slate-200 pb-1 text-xs font-bold text-slate-500">
            <span>جنس</span>
            <span>فروخته‌شده · حالا در گدام</span>
          </div>
          {rows.map((r) => {
            const stock = stockOf(r.variantId)
            return (
              <div key={r.variantId} className="flex items-start justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
                <span className="text-slate-600">
                  {r.name} {r.size} {r.color}
                  <span className="block text-xs text-slate-400">آخرین فروش: {fmtDateShort(r.lastDate)}</span>
                </span>
                <span className="shrink-0 text-left">
                  <span className="font-bold text-slate-800">{fmtNum(r.qty)} جوړه</span>
                  <span className="block text-xs text-slate-400">
                    {fmtMoney(r.revenue)}
                    {stock !== undefined && ` · گدام: ${fmtNum(stock)}`}
                  </span>
                </span>
              </div>
            )
          })}
          <div className="mt-2 flex justify-between rounded-xl bg-slate-50 p-2 text-sm font-bold">
            <span className="text-slate-600">مجموع</span>
            <span className="text-slate-800">
              {fmtNum(totalQty)} جوړه · {fmtMoney(totalRev)}
              {showProfit && <span className="block text-xs text-teal-700">مفاد: {fmtMoney(totalProfit)}</span>}
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            اجناسی که در این لیست نیستند، در این دوره حرکت نکرده‌اند — موجودی‌شان همان است که بود.
          </p>
        </div>
      )}
    </Card>
  )
}
