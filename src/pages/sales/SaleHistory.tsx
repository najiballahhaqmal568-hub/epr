import { useMemo, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../../db'
import { addCalendarDays, fmtDateShort, fmtMoney, fmtNum, startOfDay } from '../../lib/format'
import { groupSaleHistory } from '../../lib/saleHistory'
import { Field, inputCls } from '../../components/ui'

export default function SaleHistory({ children }: { children: (sale: Sale) => ReactNode }) {
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  // Mount only on History: no 100-row cut-off that could truncate daily totals.
  const sales = useLiveQuery(() => db.sales.filter(s => !s.deleted && !s.lenderAction).toArray(), [])
  const groups = useMemo(() => groupSaleHistory(sales ?? [], search, from, to), [sales, search, from, to])
  const today = startOfDay()
  const yesterday = addCalendarDays(today, -1)
  const invalidRange = Boolean(from && to && from > to)
  const filtered = Boolean(search.trim() || from || to)
  return <section className="surface p-4" aria-label="تاریخچه فروش">
    <h2 className="mb-4 text-lg font-bold">تاریخچه فروش</h2>
    <Field label="جستجوی مشتری یا جنس"><input className={inputCls} value={search} onChange={e => setSearch(e.target.value)} placeholder="نام مشتری، جنس، سایز یا رنگ" /></Field>
    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
      <Field label="از تاریخ (میلادی)"><input className={`${inputCls} min-w-0`} type="date" value={from} onChange={e => setFrom(e.target.value)} /></Field>
      <Field label="تا تاریخ (میلادی)"><input className={`${inputCls} min-w-0`} type="date" value={to} onChange={e => setTo(e.target.value)} /></Field>
    </div>
    {filtered && <button className="mb-3 text-sm font-bold text-teal-700" onClick={() => { setSearch(''); setFrom(''); setTo('') }}>پاک‌کردن فیلترها</button>}
    {invalidRange ? <p role="alert" className="mb-3 text-sm text-red-700">تاریخ پایان باید برابر یا بعد از تاریخ آغاز باشد.</p> : <>
      {sales === undefined && <p role="status">در حال خواندن تاریخچه…</p>}
      {sales !== undefined && groups.length === 0 && <p role="status" className="py-8 text-center text-slate-500">{filtered ? 'فروشی مطابق این جستجو و تاریخ پیدا نشد.' : 'هنوز فروشی ثبت نشده.'}</p>}
      {filtered && groups.length > 0 && <p className="mb-3 text-xs text-slate-500">تعداد و مبلغ هر روز مربوط به فروش‌های مطابق فیلتر است.</p>}
      {groups.map(group => {
        const open = expanded[group.day] ?? group.day === today
        return <details key={group.day} className="border-t border-slate-200 py-2" open={open} onToggle={e => {
          const next = e.currentTarget.open
          setExpanded(previous => previous[group.day] === next ? previous : { ...previous, [group.day]: next })
        }}>
          <summary className="cursor-pointer py-3 text-slate-800">
            <span className="font-bold">{group.day === today ? 'امروز — ' : group.day === yesterday ? 'دیروز — ' : ''}{fmtDateShort(group.day)}</span>
            <span className="mt-1 block text-sm text-slate-600">{fmtNum(group.sales.length)} فروش · مجموع مبلغ فروش: <strong className="text-teal-700">{fmtMoney(group.total)}</strong></span>
          </summary>
          {open && <div className="pt-2">{group.sales.map(children)}</div>}
        </details>
      })}
    </>}
  </section>
}
