import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, accessFlags, type ExpenseType, type Expense, type CashMovementType } from '../db'
import { addExpense, deleteExpense, renameCategory, reconcile, addPartnerWithdrawal } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate, fmtDateShort, parseNum, startOfDay, startOfMonth } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

const MOVE_LABELS: Record<CashMovementType, string> = {
  sale: 'فروش',
  purchase: 'خرید',
  expense: 'مصرف تجارت',
  homeExpense: 'مصرف خانه',
  personalExpense: 'مصرف شخصی',
  withdrawal: 'برداشت مالک',
  customerPayment: 'دریافت از مشتری',
  supplierPayment: 'پرداخت به تأمین‌کننده',
  refund: 'مرجوعی',
  openingSet: 'تصفیه صندوق',
  capitalIn: 'سرمایه‌گذاری شریک',
  landing: 'مصارف رسیدن جنس'
}

export const TYPE_LABELS: Record<ExpenseType, string> = {
  business: 'تجارت',
  home: 'خانه',
  personal: 'شخصی',
  withdrawal: 'برداشت مالک'
}

const TYPE_COLORS: Record<ExpenseType, string> = {
  business: 'text-red-600',
  home: 'text-amber-600',
  personal: 'text-purple-600',
  withdrawal: 'text-amber-700'
}

export default function Expenses() {
  const [view, setView] = useState<'expenses' | 'cash' | 'stats'>('expenses')
  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`
  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">مصارف و صندوق</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('expenses')} className={tabCls('expenses')}>
          مصارف
        </button>
        <button onClick={() => setView('cash')} className={tabCls('cash')}>
          صندوق
        </button>
        <button onClick={() => setView('stats')} className={tabCls('stats')}>
          آمار
        </button>
      </div>
      {view === 'expenses' ? <ExpenseList /> : view === 'cash' ? <CashView /> : <ExpenseStats />}
    </div>
  )
}

type StatsPeriod = 'today' | 'week' | 'month' | 'prevMonth'

const STATS_PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'today', label: 'امروز' },
  { id: 'week', label: '۷ روز' },
  { id: 'month', label: 'این ماه' },
  { id: 'prevMonth', label: 'ماه گذشته' }
]

/** آمار مصارف: مجموع دوره به تفکیک نوع + کتگوری */
function ExpenseStats() {
  const [period, setPeriod] = useState<StatsPeriod>('today')

  // from/to باید بین رندرها ثابت باشند تا liveQuery درست کار کند
  let from: number
  let to = Number.MAX_SAFE_INTEGER
  const now = new Date()
  switch (period) {
    case 'today':
      from = startOfDay()
      break
    case 'week':
      from = startOfDay() - 6 * 86400000
      break
    case 'month':
      from = startOfMonth()
      break
    case 'prevMonth':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime()
      to = new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1
      break
  }

  const expenses = useLiveQuery(
    () => db.expenses.where('date').between(from, to, true, true).filter((e) => !e.deleted).toArray(),
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
        <p className="text-sm opacity-80">مجموع مصارف {STATS_PERIODS.find((p) => p.id === period)?.label}</p>
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

function ExpenseList() {
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

function CategoryManager({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [newCat, setNewCat] = useState('')
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  return (
    <Modal title="مدیریت کتگوری‌ها" onClose={onClose}>
      <div className="mb-4 flex gap-2">
        <input className={inputCls} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="کتگوری جدید..." />
        <button
          className="whitespace-nowrap rounded-xl bg-teal-700 px-4 font-bold text-white disabled:opacity-40"
          disabled={!newCat.trim()}
          onClick={async () => {
            await db.expenseCategories.add({ name: newCat.trim() })
            setNewCat('')
          }}
        >
          افزودن
        </button>
      </div>

      {categories?.map((c) => (
        <div key={c.id} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          {editingId === c.id ? (
            <>
              <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <button
                className="whitespace-nowrap rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-bold text-white"
                onClick={async () => {
                  if (editName.trim()) await renameCategory(c.id!, editName.trim())
                  setEditingId(null)
                }}
              >
                ذخیره
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 font-bold text-slate-700">{c.name}</span>
              <button
                className="text-sm text-teal-700"
                onClick={() => {
                  setEditingId(c.id!)
                  setEditName(c.name)
                }}
              >
                تغییر نام
              </button>
              {confirmingId === c.id ? (
                <button
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white"
                  onClick={async () => {
                    await db.expenseCategories.update(c.id!, { deleted: true })
                    setConfirmingId(null)
                  }}
                >
                  تأیید حذف؟
                </button>
              ) : (
                <button
                  className="text-sm text-red-500"
                  onClick={() => {
                    setConfirmingId(c.id!)
                    setTimeout(() => setConfirmingId((id) => (id === c.id ? null : id)), 4000)
                  }}
                >
                  حذف
                </button>
              )}
            </>
          )}
        </div>
      ))}
    </Modal>
  )
}

type ExpenseMode = ExpenseType | 'partner'

function NewExpenseModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<ExpenseMode>('business')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [partnerId, setPartnerId] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [newCat, setNewCat] = useState('')
  const [showNewCat, setShowNewCat] = useState(false)
  const [error, setError] = useState('')

  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const partners = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted && x.kind === 'partner').toArray(), [])

  const type = mode === 'partner' ? 'withdrawal' : mode
  const modeLabels: Record<ExpenseMode, string> = { ...TYPE_LABELS, partner: 'شریک' }
  const modes: ExpenseMode[] = [...(Object.keys(TYPE_LABELS) as ExpenseType[]), ...((partners?.length ?? 0) > 0 ? (['partner'] as const) : [])]

  async function save() {
    const amt = parseNum(amount)
    if (amt <= 0) return setError('مبلغ را وارد کنید')
    try {
      if (mode === 'partner') {
        if (!partnerId) return setError('شریک را انتخاب کنید')
        const p = partners?.find((x) => x.id === partnerId)
        await addPartnerWithdrawal(p!.name, amt, note.trim() || undefined)
        onClose()
        return
      }
      let catId = categoryId as number | undefined
      let catName = 'برداشت مالک'
      if (mode !== 'withdrawal') {
        if (!categoryId) return setError('کتگوری را انتخاب کنید')
        catName = categories?.find((c) => c.id === categoryId)?.name ?? ''
      } else {
        catId = undefined
      }
      const e: Expense = { date: Date.now(), categoryId: catId, categoryName: catName, amount: amt, note: note.trim() || undefined, type }
      await addExpense(e)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title="ثبت مصرف" onClose={onClose}>
      <div className={`mb-1 grid gap-1 ${modes.length > 4 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-2 text-sm font-bold ${mode === m ? (m === 'business' ? 'bg-teal-700 text-white' : m === 'partner' ? 'bg-purple-600 text-white' : 'bg-amber-600 text-white') : 'bg-slate-100 text-slate-600'}`}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-slate-400">
        {mode === 'business'
          ? 'از مفاد تجارت کم می‌شود.'
          : mode === 'partner'
            ? 'برداشت/مصرف شریک — آخر سال از سهم فایدهٔ همان شریک کم می‌شود.'
            : 'از صندوق کم می‌شود اما در مفاد تجارت حساب نمی‌شود.'}
      </p>

      {mode === 'partner' && (
        <Field label="کدام شریک؟ *">
          <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">انتخاب کنید...</option>
            {partners?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {mode !== 'withdrawal' && mode !== 'partner' && (
        <>
          <Field label="کتگوری *">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {!showNewCat ? (
            <button className="mb-3 text-sm text-teal-700" onClick={() => setShowNewCat(true)}>
              ＋ کتگوری جدید
            </button>
          ) : (
            <div className="mb-3 flex gap-2">
              <input className={inputCls} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="نام کتگوری" />
              <button
                className="whitespace-nowrap rounded-xl bg-teal-700 px-4 font-bold text-white"
                onClick={async () => {
                  if (!newCat.trim()) return
                  const id = (await db.expenseCategories.add({ name: newCat.trim() })) as number
                  setCategoryId(id)
                  setNewCat('')
                  setShowNewCat(false)
                }}
              >
                افزودن
              </button>
            </div>
          )}
        </>
      )}

      <Field label="مبلغ *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save}>ذخیره</PrimaryBtn>
    </Modal>
  )
}

function CashView() {
  const [showReconcile, setShowReconcile] = useState(false)
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [result, setResult] = useState<string>('')
  const [shortMode, setShortMode] = useState<'expense' | 'debt' | 'adjust'>('expense')
  const [debtCustomer, setDebtCustomer] = useState<number | ''>('')
  const dayStart = startOfDay()

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])
  const reconciliations = useLiveQuery(() => db.reconciliations.orderBy('date').reverse().filter((r) => !r.deleted).limit(10).toArray(), [])

  const balance = movements?.reduce((s, m) => s + m.amount, 0) ?? 0
  const today = movements?.filter((m) => m.date >= dayStart).sort((a, b) => b.date - a.date) ?? []
  const todayIn = today.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const todayOut = today.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0)
  const opening = balance - todayIn + todayOut

  return (
    <>
      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white">
        <p className="text-sm opacity-80">موجودی صندوق</p>
        <p className="text-3xl font-bold">{fmtMoney(balance)}</p>
      </div>

      <Card>
        <p className="mb-2 font-bold text-slate-700">راپور امروز</p>
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">موجودی اول روز</span>
            <span className="font-bold">{fmtMoney(opening)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">ورود امروز</span>
            <span className="font-bold text-teal-700">{fmtMoney(todayIn)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500">خروج امروز</span>
            <span className="font-bold text-red-600">{fmtMoney(todayOut)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-100 pt-1">
            <span className="text-slate-500">موجودی فعلی</span>
            <span className="font-bold">{fmtMoney(balance)}</span>
          </div>
        </div>
      </Card>

      {!accessFlags.readOnly && (
        <button onClick={() => setShowReconcile(true)} className="mb-3 w-full rounded-xl bg-teal-700 py-3 font-bold text-white">
          تصفیه صندوق (شمارش نقد)
        </button>
      )}

      <p className="mb-2 font-bold text-slate-700">حرکات امروز</p>
      {today.length === 0 && <p className="mb-3 text-sm text-slate-400">امروز حرکتی نبوده.</p>}
      {today.map((m) => (
        <div key={m.id} className="mb-1 flex justify-between rounded-lg bg-white p-2 text-sm shadow-sm">
          <span>
            {MOVE_LABELS[m.type]}
            {m.note && <span className="text-slate-400"> — {m.note}</span>}
          </span>
          <span className={`font-bold ${m.amount >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{fmtMoney(m.amount)}</span>
        </div>
      ))}

      {reconciliations && reconciliations.length > 0 && (
        <>
          <p className="mt-4 mb-2 font-bold text-slate-700">تصفیه‌های قبلی</p>
          {reconciliations.map((r) => (
            <div key={r.id} className="mb-1 flex justify-between rounded-lg bg-white p-2 text-sm shadow-sm">
              <span>{fmtDateShort(r.date)}</span>
              <span className={r.difference === 0 ? 'text-teal-700' : 'text-red-600'}>
                {r.difference === 0 ? 'برابر ✓' : `تفاوت: ${fmtMoney(r.difference)}`}
              </span>
            </div>
          ))}
        </>
      )}

      {showReconcile && (
        <Modal title="تصفیه صندوق" onClose={() => setShowReconcile(false)}>
          <p className="mb-2 text-sm text-slate-600">
            موجودی مورد انتظار: <b>{fmtMoney(balance)}</b>
          </p>
          <Field label="نقد شمارش‌شده *">
            <input className={inputCls} inputMode="numeric" value={counted} onChange={(e) => setCounted(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {counted.trim() !== '' && parseNum(counted) - balance < 0 && (
            <div className="mb-3 rounded-xl border border-red-200 bg-red-50/50 p-3">
              <p className="mb-2 text-sm font-bold text-red-600">کمبود: {fmtMoney(balance - parseNum(counted))} — با آن چه شود؟</p>
              <label className="mb-1 flex items-center gap-2 text-sm">
                <input type="radio" name="short" checked={shortMode === 'expense'} onChange={() => setShortMode('expense')} />
                ثبت به عنوان مصرف «کسر صندوق» (از مفاد کم می‌شود — پیشنهادی)
              </label>
              <label className="mb-1 flex items-center gap-2 text-sm">
                <input type="radio" name="short" checked={shortMode === 'debt'} onChange={() => setShortMode('debt')} />
                به حساب شخص مسئول (قرض او ثبت می‌شود)
              </label>
              {shortMode === 'debt' && (
                <select className={inputCls} value={debtCustomer} onChange={(e) => setDebtCustomer(e.target.value ? Number(e.target.value) : '')}>
                  <option value="">شخص را انتخاب کنید... (اگر نیست، اول در مشتریان ثبتش کنید)</option>
                  {customers?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="short" checked={shortMode === 'adjust'} onChange={() => setShortMode('adjust')} />
                فقط تنظیم موجودی (اشتباه ثبت خودم بود)
              </label>
            </div>
          )}
          {result && <p className="mb-2 text-sm font-bold">{result}</p>}
          <PrimaryBtn
            disabled={counted.trim() !== '' && parseNum(counted) - balance < 0 && shortMode === 'debt' && !debtCustomer}
            onClick={async () => {
              const c = parseNum(counted)
              const diff = c - balance
              const cust = customers?.find((x) => x.id === debtCustomer)
              const shortage =
                diff < 0
                  ? shortMode === 'expense'
                    ? ({ mode: 'expense' } as const)
                    : shortMode === 'debt' && cust
                      ? ({ mode: 'debt', customerId: cust.id!, customerName: cust.name } as const)
                      : ({ mode: 'adjust' } as const)
                  : undefined
              await reconcile(c, note.trim() || undefined, shortage)
              setResult(
                diff === 0
                  ? '✅ صندوق برابر است.'
                  : diff > 0
                    ? `اضافه: ${fmtMoney(diff)} — موجودی اصلاح شد.`
                    : shortMode === 'expense'
                      ? `کمبود ${fmtMoney(-diff)} به عنوان مصرف «کسر صندوق» ثبت شد.`
                      : shortMode === 'debt'
                        ? `کمبود ${fmtMoney(-diff)} به حساب ${cust?.name} ثبت شد.`
                        : `کمبود: ${fmtMoney(-diff)} — موجودی اصلاح شد.`
              )
              setCounted('')
              setNote('')
            }}
          >
            ثبت تصفیه
          </PrimaryBtn>
        </Modal>
      )}
    </>
  )
}
