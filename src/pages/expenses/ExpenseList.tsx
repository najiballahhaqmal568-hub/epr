import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type ExpenseType } from '../../db'
import { deleteExpense } from '../../lib/ops'
import { fmtMoney, fmtDate, startOfDay, startOfMonth } from '../../lib/format'
import { Empty } from '../../components/ui'
import { TYPE_LABELS, TYPE_COLORS } from './labels'
import NewExpenseModal from './NewExpenseModal'
import CategoryManager from './CategoryManager'
import ExpenseCreditors from './ExpenseCreditors'
import DailyExpenseChecklist from './DailyExpenseChecklist'

export function ExpenseList({
  openNew = false,
  onOpenCash,
  onOpenStats
}: {
  openNew?: boolean
  onOpenCash?: () => void
  onOpenStats?: () => void
}) {
  const [showNew, setShowNew] = useState(openNew)
  const [showCats, setShowCats] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [filter, setFilter] = useState<number | 'all' | ExpenseType>('all')
  const monthStart = startOfMonth()
  const dayStart = startOfDay()

  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().filter((e) => !e.deleted && !e.shopClosed).limit(300).toArray(), [])
  // برداشت‌های شریک به شکل حرکت صندوق ثبت می‌شوند — این‌ها را هم در لیست مصارف نشان بده
  const partnerDraws = useLiveQuery(
    () => db.cashMovements.filter((m) => !m.deleted && m.type === 'withdrawal' && Boolean(m.partnerName)).reverse().sortBy('date'),
    []
  )
  const cashMovements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])

  // برداشت‌های شریک را به شکل ردیف مصرف نمایشی درمی‌آوریم
  const drawRows = (partnerDraws ?? []).map((m) => ({
    id: -m.id!,
    date: m.date,
    categoryName: `برداشت ${m.partnerName}`,
    amount: -m.amount,
    note: m.note && m.note !== `برداشت ${m.partnerName}` ? m.note : undefined,
    type: 'withdrawal' as ExpenseType,
    partner: true
  }))
  const merged = [...(expenses ?? []).map((e) => ({ ...e, partner: false })), ...drawRows].sort((a, b) => b.date - a.date)

  const filtered = merged.filter((e) => {
    if (filter === 'all') return true
    if (typeof filter === 'number') return 'categoryId' in e && e.categoryId === filter
    return e.type === filter
  })

  const monthOf = (t: ExpenseType) =>
    merged.filter((e) => e.date >= monthStart && e.type === t).reduce((s, e) => s + e.amount, 0)
  const monthBusiness = monthOf('business')
  const monthNonBusiness = monthOf('home') + monthOf('personal') + monthOf('withdrawal')
  const todayBusiness = merged
    .filter((e) => e.date >= dayStart && e.type === 'business')
    .reduce((sum, e) => sum + e.amount, 0)
  const totalCash = cashMovements?.reduce((sum, movement) => sum + movement.amount, 0) ?? 0
  const visibleRows = showAll ? filtered : filtered.slice(0, 8)
  const commonCategories = categories?.slice(0, 6) ?? []

  return (
    <>
      {!accessFlags.readOnly && (
        <button onClick={() => setShowNew(true)} className="mb-3 w-full rounded-2xl bg-teal-700 py-3.5 text-base font-bold text-white shadow-sm active:bg-teal-800">
          ثبت مصرف جدید
        </button>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button onClick={onOpenStats} className="rounded-2xl border border-slate-100 bg-white p-3 text-right shadow-sm">
          <p className="text-xs text-slate-500">مصارف تجارت امروز</p>
          <p className="mt-1 text-lg font-bold text-red-600">{fmtMoney(todayBusiness)}</p>
          <p className="text-[11px] text-slate-400">این ماه {fmtMoney(monthBusiness)}</p>
        </button>
        <button onClick={onOpenCash} className="rounded-2xl border border-slate-100 bg-white p-3 text-right shadow-sm">
          <p className="text-xs text-slate-500">پول کل تجارت</p>
          <p className={`mt-1 text-lg font-bold ${totalCash < 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(totalCash)}</p>
          <p className="text-[11px] text-slate-400">دیدن صندوق و حرکت‌ها</p>
        </button>
      </div>

      <DailyExpenseChecklist />
      <ExpenseCreditors />

      <div className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-slate-800">کتگوری‌های پرکاربرد</p>
          <button onClick={() => setShowCats(true)} className="text-xs font-bold text-teal-700">مدیریت</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="همه" />
          {commonCategories.map((category) => (
            <FilterChip key={category.id} active={filter === category.id} onClick={() => setFilter(category.id!)} label={category.name} />
          ))}
        </div>
      </div>

      <button onClick={() => setShowTools((value) => !value)} className="mb-3 flex w-full items-center justify-between rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-bold text-slate-600">
        <span>فیلتر و گزینه‌های دیگر</span>
        <span>{showTools ? '▲' : '▼'}</span>
      </button>
      {showTools && (
        <div className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
          <div className="mb-2 flex flex-wrap gap-2">
            <FilterChip active={filter === 'business'} onClick={() => setFilter('business')} label="تجارت" />
            <FilterChip active={filter === 'home'} onClick={() => setFilter('home')} label="خانه" />
            <FilterChip active={filter === 'personal'} onClick={() => setFilter('personal')} label="شخصی" />
            <FilterChip active={filter === 'withdrawal'} onClick={() => setFilter('withdrawal')} label="برداشت" />
            {categories?.slice(6).map((category) => (
              <FilterChip key={category.id} active={filter === category.id} onClick={() => setFilter(category.id!)} label={category.name} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs">
            <button onClick={onOpenCash} className="rounded-lg bg-slate-50 py-2 font-bold text-slate-700">صندوق و انتقال پول</button>
            <button onClick={onOpenStats} className="rounded-lg bg-slate-50 py-2 font-bold text-slate-700">راپور کامل مصارف</button>
          </div>
          <p className="mt-2 text-xs text-slate-400">خانه، شخصی و برداشت این ماه: {fmtMoney(monthNonBusiness)}</p>
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-slate-800">مصارف اخیر</p>
        {filtered.length > 8 && (
          <button onClick={() => setShowAll((value) => !value)} className="text-xs font-bold text-teal-700">
            {showAll ? 'نمایش کمتر' : 'دیدن همه'}
          </button>
        )}
      </div>
      {filtered.length === 0 && <Empty text="مصرفی ثبت نشده." />}
      {visibleRows.map((e) => (
        <div key={e.id} className="mb-2 rounded-xl border border-slate-100 bg-white p-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800">
                {e.partner ? e.categoryName : e.type === 'withdrawal' ? 'برداشت مالک' : e.categoryName}
                <span className={`mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal ${TYPE_COLORS[e.type]}`}>
                  {e.partner ? 'شریک' : TYPE_LABELS[e.type]}
                </span>
              </p>
              {e.note && <p className="text-sm text-slate-500">{e.note}</p>}
              {!e.partner && 'creditAmount' in e && (e.creditAmount ?? 0) > 0 && (
                <p className="text-xs font-bold text-amber-700">
                  نقد {fmtMoney(e.cashPaid ?? 0)} · قرض به {e.creditorName}: {fmtMoney(e.creditAmount ?? 0)}
                </p>
              )}
              <p className="text-xs text-slate-500">{fmtDate(e.date)}</p>
            </div>
            <div className="text-left">
              <p className={`font-bold ${TYPE_COLORS[e.type]}`}>{fmtMoney(e.amount)}</p>
              {!e.partner && (
                <button
                  className="text-xs text-red-400"
                  onClick={async () => {
                    if (confirm('این مصرف حذف شود؟')) await deleteExpense(e.id!)
                  }}
                >
                  حذف
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {showNew && <NewExpenseModal onClose={() => setShowNew(false)} />}
      {showCats && <CategoryManager onClose={() => setShowCats(false)} />}
    </>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${active ? 'bg-teal-700 text-white' : 'bg-white text-slate-600'}`}
    >
      {label}
    </button>
  )
}

export default ExpenseList
