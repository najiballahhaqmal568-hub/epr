import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Expense } from '../../db'
import { fmtMoney, fmtNum, startOfDay } from '../../lib/format'
import { setShopClosed } from '../../lib/dailyExpenses'
import { Modal, PrimaryBtn } from '../../components/ui'

const DAY = 86_400_000
const WEEKDAYS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'] // هفته از شنبه

type DayStatus = 'ok' | 'some' | 'none' | 'closed' | 'future' | 'neutral'

interface DayCell {
  day: number
  inMonth: boolean
  total: number
  count: number
  status: DayStatus
}

/**
 * تقویم ۳۰ روزهٔ مصارف: هر روز یک خانه — مجموع و تعداد مصارف، و وضعیت چک‌لیست
 * روزانه (سبز/زرد/سرخ/تعطیل). لمس هر روز، مصارفش و افزودن برای همان روز را باز می‌کند.
 * فقط نماست — هیچ قاعدهٔ حسابداری نو.
 */
export function ExpenseCalendar({ onAddForDay }: { onAddForDay: (day: number) => void }) {
  const [monthOffset, setMonthOffset] = useState(0)
  const [openDay, setOpenDay] = useState<number | null>(null)

  const base = new Date()
  base.setDate(1)
  base.setMonth(base.getMonth() + monthOffset)
  const year = base.getFullYear()
  const month = base.getMonth()
  const monthStart = startOfDay(new Date(year, month, 1).getTime())
  const monthEnd = startOfDay(new Date(year, month + 1, 0).getTime())
  const today = startOfDay(Date.now())
  const monthLabel = base.toLocaleDateString('fa-AF', { month: 'long', year: 'numeric' })

  const rows = useLiveQuery(
    () => db.expenses.where('date').between(monthStart, monthEnd + DAY, true, false).toArray(),
    [monthStart, monthEnd]
  )
  const required = useLiveQuery(
    () =>
      db.expenseCategories
        .filter((c) => !c.deleted && c.dailyEnabled === true && typeof c.dailyFrom === 'number')
        .toArray(),
    []
  )

  const live = (rows ?? []).filter((r) => !r.deleted)
  const byDay = new Map<number, { total: number; count: number; cats: Set<number>; closed: boolean }>()
  for (const r of live) {
    const d = startOfDay(r.date)
    const e = byDay.get(d) ?? { total: 0, count: 0, cats: new Set<number>(), closed: false }
    if (!r.shopClosed) {
      e.total += r.amount
      e.count += 1
      if (r.type === 'business' && typeof r.categoryId === 'number') e.cats.add(r.categoryId)
    }
    e.closed = e.closed || r.shopClosed === true
    byDay.set(d, e)
  }
  const closedDays = new Set(live.filter((r) => r.shopClosed).map((r) => startOfDay(r.date)))

  function statusOf(day: number): DayStatus {
    if (day > today) return 'future'
    const info = byDay.get(day)
    if (info?.closed || closedDays.has(day)) return 'closed'
    const req = (required ?? []).filter((c) => day >= startOfDay(c.dailyFrom!))
    if (req.length === 0) return 'neutral'
    const missing = req.filter((c) => !info?.cats.has(c.id!)).length
    if (missing === 0) return 'ok'
    if (missing === req.length && (info?.count ?? 0) === 0) return 'none'
    return 'some'
  }

  const cells: DayCell[] = []
  const lead = (new Date(year, month, 1).getDay() + 1) % 7 // شنبه‌اول
  for (let i = 0; i < lead; i++) cells.push({ day: monthStart - (lead - i) * DAY, inMonth: false, total: 0, count: 0, status: 'future' })
  for (let d = new Date(monthStart); d.getMonth() === month; d.setDate(d.getDate() + 1)) {
    const day = startOfDay(d.getTime())
    const info = byDay.get(day)
    cells.push({ day, inMonth: true, total: info?.total ?? 0, count: info?.count ?? 0, status: statusOf(day) })
  }

  const statusStyle: Record<DayStatus, string> = {
    ok: 'bg-teal-50 border-teal-200',
    some: 'bg-amber-50 border-amber-200',
    none: 'bg-red-50 border-red-200',
    closed: 'bg-slate-100 border-slate-200',
    future: 'bg-white border-slate-100 opacity-50',
    neutral: 'bg-white border-slate-200'
  }
  const statusIcon: Partial<Record<DayStatus, string>> = { ok: '✓', closed: '🔒', none: '!' }

  const dayExpenses = openDay != null ? live.filter((r) => startOfDay(r.date) === openDay) : []
  const dayClosed = openDay != null ? closedDays.has(openDay) : false

  return (
    <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => setMonthOffset((m) => m - 1)} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
          ←
        </button>
        <p className="font-bold text-slate-800">{monthLabel}</p>
        <button
          onClick={() => setMonthOffset((m) => m + 1)}
          disabled={monthOffset >= 0}
          className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600 disabled:opacity-40"
        >
          →
        </button>
      </div>
      <div className="mb-1 grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500">
        {WEEKDAYS.map((w) => (
          <span key={w}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          const isToday = c.day === today
          return (
            <button
              key={i}
              onClick={() => {
                if (!c.inMonth || c.status === 'future') return
                setOpenDay(c.day)
              }}
              disabled={!c.inMonth || c.status === 'future'}
              className={`rounded-lg border p-1 text-center active:opacity-70 disabled:cursor-default ${statusStyle[c.status]} ${
                isToday ? 'ring-2 ring-teal-600' : ''
              }`}
            >
              <span className="block text-xs font-bold text-slate-700">{fmtNum(new Date(c.day).getDate())}</span>
              {c.inMonth && c.total > 0 && <span className="block text-[10px] text-slate-600">{fmtMoney(c.total)}</span>}
              {c.inMonth && c.status !== 'future' && statusIcon[c.status] && (
                <span className={`block text-[10px] font-bold ${c.status === 'none' ? 'text-red-600' : c.status === 'ok' ? 'text-teal-700' : 'text-slate-500'}`}>
                  {statusIcon[c.status]}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-400">
        🟩 کامل · 🟨 ناقص · 🟥 خالی · 🔒 تعطیل — لمس کنید تا مصارف روز باز شود
      </p>

      {openDay != null && (
        <Modal title={`مصارف ${fmtNum(new Date(openDay).getDate())} ${new Date(openDay).toLocaleDateString('fa-AF', { month: 'long' })}`} onClose={() => setOpenDay(null)}>
          {dayClosed && <p className="mb-2 rounded-xl bg-slate-100 p-2 text-center text-sm font-bold text-slate-600">🔒 این روز تعطیل علامت خورده است.</p>}
          {dayExpenses.filter((e) => !e.shopClosed).length === 0 && !dayClosed && (
            <p className="mb-3 text-sm text-slate-400">این روز مصرفی ثبت نشده.</p>
          )}
          {dayExpenses
            .filter((e) => !e.shopClosed)
            .sort((a, b) => a.date - b.date)
            .map((e: Expense) => (
              <div key={e.id} className="mb-1 flex items-center justify-between rounded-xl bg-slate-50 p-2 text-sm">
                <div className="min-w-0">
                  <p className="font-bold text-slate-800">{e.type === 'withdrawal' ? 'برداشت مالک' : e.categoryName}</p>
                  <p className="text-xs text-slate-500">
                    {(e.creditAmount ?? 0) > 0 ? `نقد ${fmtMoney(e.cashPaid ?? 0)} · قرض ${fmtMoney(e.creditAmount ?? 0)}` : 'نقدی'}
                    {e.note ? ` · ${e.note}` : ''}
                  </p>
                </div>
                <span className="shrink-0 font-bold text-red-600">{fmtMoney(e.amount)}</span>
              </div>
            ))}
          <div className="mt-3 flex gap-2">
            <PrimaryBtn
              onClick={() => {
                const day = openDay
                setOpenDay(null)
                onAddForDay(day)
              }}
            >
              ＋ مصرف برای این روز
            </PrimaryBtn>
            <button
              className="flex-1 rounded-xl border border-slate-300 py-2.5 text-sm font-bold text-slate-700"
              onClick={async () => {
                await setShopClosed(openDay, !dayClosed)
                setOpenDay(null)
              }}
            >
              {dayClosed ? 'روز را باز کنم' : 'روز تعطیل بود'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400">اصلاح و حذف هر مصرف از «فهرست» همان‌جا که همیشه بود انجام می‌شود.</p>
        </Modal>
      )}
    </div>
  )
}

export default ExpenseCalendar
