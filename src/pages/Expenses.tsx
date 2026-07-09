import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Expense, type CashMovementType } from '../db'
import { addExpense, deleteExpense, reconcile } from '../lib/ops'
import { fmtMoney, fmtDate, fmtDateShort, parseNum, startOfDay, startOfMonth } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

const MOVE_LABELS: Record<CashMovementType, string> = {
  sale: 'فروش',
  purchase: 'خرید',
  expense: 'مصرف',
  withdrawal: 'برداشت مالک',
  customerPayment: 'دریافت از مشتری',
  supplierPayment: 'پرداخت به تأمین‌کننده',
  refund: 'مرجوعی',
  openingSet: 'تصفیه صندوق'
}

export default function Expenses() {
  const [view, setView] = useState<'expenses' | 'cash'>('expenses')
  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">مصارف و صندوق</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('expenses')} className={`flex-1 rounded-xl py-2 font-bold ${view === 'expenses' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
          مصارف
        </button>
        <button onClick={() => setView('cash')} className={`flex-1 rounded-xl py-2 font-bold ${view === 'cash' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
          صندوق
        </button>
      </div>
      {view === 'expenses' ? <ExpenseList /> : <CashView />}
    </div>
  )
}

function ExpenseList() {
  const [showNew, setShowNew] = useState(false)
  const [filterCat, setFilterCat] = useState<number | 'all' | 'withdrawal'>('all')
  const monthStart = startOfMonth()

  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').toArray(), [])
  const expenses = useLiveQuery(() => db.expenses.orderBy('date').reverse().limit(300).toArray(), [])

  const filtered = expenses?.filter((e) =>
    filterCat === 'all' ? true : filterCat === 'withdrawal' ? e.type === 'withdrawal' : e.categoryId === filterCat
  )
  const monthTotal = expenses?.filter((e) => e.date >= monthStart && e.type === 'business').reduce((s, e) => s + e.amount, 0) ?? 0
  const monthWithdrawals = expenses?.filter((e) => e.date >= monthStart && e.type === 'withdrawal').reduce((s, e) => s + e.amount, 0) ?? 0

  return (
    <>
      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm text-slate-500">مصارف این ماه</p>
          <p className="text-lg font-bold text-red-600">{fmtMoney(monthTotal)}</p>
        </div>
        <div className="rounded-xl bg-white p-3 shadow-sm">
          <p className="text-sm text-slate-500">برداشت مالک این ماه</p>
          <p className="text-lg font-bold text-amber-600">{fmtMoney(monthWithdrawals)}</p>
        </div>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        <FilterChip active={filterCat === 'all'} onClick={() => setFilterCat('all')} label="همه" />
        <FilterChip active={filterCat === 'withdrawal'} onClick={() => setFilterCat('withdrawal')} label="برداشت مالک" />
        {categories?.map((c) => (
          <FilterChip key={c.id} active={filterCat === c.id} onClick={() => setFilterCat(c.id!)} label={c.name} />
        ))}
      </div>

      {filtered?.length === 0 && <Empty text="مصرفی ثبت نشده." />}
      {filtered?.map((e) => (
        <Card key={e.id}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800">
                {e.type === 'withdrawal' ? 'برداشت مالک' : e.categoryName}
                {e.note && <span className="mr-1 text-sm font-normal text-slate-500">— {e.note}</span>}
              </p>
              <p className="text-xs text-slate-500">{fmtDate(e.date)}</p>
            </div>
            <div className="text-left">
              <p className={`font-bold ${e.type === 'withdrawal' ? 'text-amber-600' : 'text-red-600'}`}>{fmtMoney(e.amount)}</p>
              <button
                className="text-xs text-red-400"
                onClick={async () => {
                  if (confirm('این مصرف حذف شود؟')) await deleteExpense(e.id!)
                }}
              >
                حذف
              </button>
            </div>
          </div>
        </Card>
      ))}
      <Fab onClick={() => setShowNew(true)} label="مصرف جدید" />
      {showNew && <NewExpenseModal onClose={() => setShowNew(false)} />}
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

function NewExpenseModal({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<'business' | 'withdrawal'>('business')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [newCat, setNewCat] = useState('')
  const [showNewCat, setShowNewCat] = useState(false)
  const [error, setError] = useState('')

  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').toArray(), [])

  async function save() {
    const amt = parseNum(amount)
    if (amt <= 0) return setError('مبلغ را وارد کنید')
    let catId = categoryId as number | undefined
    let catName = 'برداشت مالک'
    if (type === 'business') {
      if (!categoryId) return setError('کتگوری را انتخاب کنید')
      catName = categories?.find((c) => c.id === categoryId)?.name ?? ''
    } else {
      catId = undefined
    }
    const e: Expense = { date: Date.now(), categoryId: catId, categoryName: catName, amount: amt, note: note.trim() || undefined, type }
    await addExpense(e)
    onClose()
  }

  return (
    <Modal title="ثبت مصرف" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setType('business')} className={`flex-1 rounded-xl py-2 font-bold ${type === 'business' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
          مصرف تجارت
        </button>
        <button onClick={() => setType('withdrawal')} className={`flex-1 rounded-xl py-2 font-bold ${type === 'withdrawal' ? 'bg-amber-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
          برداشت مالک
        </button>
      </div>

      {type === 'business' && (
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
  const dayStart = startOfDay()

  const movements = useLiveQuery(() => db.cashMovements.toArray(), [])
  const reconciliations = useLiveQuery(() => db.reconciliations.orderBy('date').reverse().limit(10).toArray(), [])

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

      <button onClick={() => setShowReconcile(true)} className="mb-3 w-full rounded-xl bg-teal-700 py-3 font-bold text-white">
        تصفیه صندوق (شمارش نقد)
      </button>

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
          {result && <p className="mb-2 text-sm font-bold">{result}</p>}
          <PrimaryBtn
            onClick={async () => {
              const c = parseNum(counted)
              const diff = c - balance
              await reconcile(c, note.trim() || undefined)
              setResult(diff === 0 ? '✅ صندوق برابر است.' : diff > 0 ? `اضافه: ${fmtMoney(diff)} — موجودی اصلاح شد.` : `کمبود: ${fmtMoney(-diff)} — موجودی اصلاح شد.`)
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
