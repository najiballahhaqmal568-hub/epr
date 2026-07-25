import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type ExpenseType } from '../../db'
import { deleteExpense } from '../../lib/ops'
import { fmtMoney, fmtDate, startOfMonth } from '../../lib/format'
import { Fab, Empty, Card } from '../../components/ui'
import { TYPE_LABELS, TYPE_COLORS } from './labels'
import NewExpenseModal from './NewExpenseModal'
import CategoryManager from './CategoryManager'

export function ExpenseList() {
  const [showNew, setShowNew] = useState(false)
  const [showCats, setShowCats] = useState(false)
  const [filter, setFilter] = useState<number | 'all' | ExpenseType>('all')
  const monthStart = startOfMonth()

  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().filter((e) => !e.deleted).limit(300).toArray(), [])
  // برداشت‌های شریک به شکل حرکت صندوق ثبت می‌شوند — این‌ها را هم در لیست مصارف نشان بده
  const partnerDraws = useLiveQuery(
    () => db.cashMovements.filter((m) => !m.deleted && m.type === 'withdrawal' && Boolean(m.partnerName)).reverse().sortBy('date'),
    []
  )

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

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm text-slate-500">مصارف تجارت این ماه</p>
          <p className="text-lg font-bold text-red-600">{fmtMoney(monthBusiness)}</p>
          <p className="text-xs text-slate-400">از مفاد کم می‌شود</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm text-slate-500">خانه، شخصی و برداشت</p>
          <p className="text-lg font-bold text-amber-600">{fmtMoney(monthNonBusiness)}</p>
          <p className="text-xs text-slate-400">خانه {fmtMoney(monthOf('home'))} · شخصی {fmtMoney(monthOf('personal'))}</p>
        </div>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')} label="همه" />
        <FilterChip active={filter === 'business'} onClick={() => setFilter('business')} label="تجارت" />
        <FilterChip active={filter === 'home'} onClick={() => setFilter('home')} label="خانه" />
        <FilterChip active={filter === 'personal'} onClick={() => setFilter('personal')} label="شخصی" />
        <FilterChip active={filter === 'withdrawal'} onClick={() => setFilter('withdrawal')} label="برداشت" />
        {categories?.map((c) => (
          <FilterChip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id!)} label={c.name} />
        ))}
      </div>

      <button onClick={() => setShowCats(true)} className="mb-3 text-sm font-bold text-teal-700">
        ⚙ مدیریت کتگوری‌ها
      </button>

      {filtered.length === 0 && <Empty text="مصرفی ثبت نشده." />}
      {filtered.map((e) => (
        <Card key={e.id}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800">
                {e.partner ? e.categoryName : e.type === 'withdrawal' ? 'برداشت مالک' : e.categoryName}
                <span className={`mr-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal ${TYPE_COLORS[e.type]}`}>
                  {e.partner ? 'شریک' : TYPE_LABELS[e.type]}
                </span>
              </p>
              {e.note && <p className="text-sm text-slate-500">{e.note}</p>}
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
        </Card>
      ))}
      <Fab onClick={() => setShowNew(true)} label="مصرف جدید" />
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
