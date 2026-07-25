import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, accessFlags } from '../../db'
import { reconcile } from '../../lib/ops'
import { fmtMoney, fmtDate, fmtDateShort, parseNum, startOfDay, startOfMonth } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Card } from '../../components/ui'
import { buildCashLedger } from '../../lib/ledger'
import { MOVE_LABELS } from './labels'

/** دفتر صندوق: هر حرکت با موجودی بعد از آن، گروه‌شده به روز */
function CashLedgerModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [q, setQ] = useState('')

  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])
  const all = buildCashLedger(movements ?? [], (t) => MOVE_LABELS[t])

  const from =
    period === 'today' ? startOfDay() : period === 'week' ? startOfDay() - 6 * 86400000 : period === 'month' ? startOfMonth() : 0
  const inPeriod = all.filter((r) => r.date >= from)
  const rows = q.trim()
    ? inPeriod.filter((r) => `${r.label} ${r.note ?? ''}`.includes(q.trim()))
    : inPeriod

  const balance = all.length ? all[all.length - 1].balance : 0
  // موجودی پیش از شروع دوره = موجودی بعد از آخرین حرکت قبل از آن
  const before = all.filter((r) => r.date < from)
  const opening = before.length ? before[before.length - 1].balance : 0
  const periodIn = inPeriod.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0)
  const periodOut = inPeriod.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0)

  // گروه‌بندی به روز، تازه‌ترین اول
  const days = new Map<number, typeof rows>()
  for (const r of [...rows].reverse()) {
    const d = startOfDay(r.date)
    days.set(d, [...(days.get(d) ?? []), r])
  }

  const chip = (id: typeof period, label: string) => (
    <button
      key={id}
      onClick={() => setPeriod(id)}
      className={`rounded-full px-3 py-1.5 text-sm font-bold ${period === id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
    >
      {label}
    </button>
  )

  return (
    <Modal title="📒 دفتر صندوق" onClose={onClose}>
      <div className="mb-3 rounded-xl bg-teal-50 p-3">
        <div className="flex justify-between text-sm text-slate-600">
          <span>موجودی اول دوره</span>
          <span className="font-bold">{fmtMoney(opening)}</span>
        </div>
        <div className="flex justify-between text-sm text-teal-700">
          <span>مجموع ورود</span>
          <span className="font-bold">＋{fmtMoney(periodIn)}</span>
        </div>
        <div className="flex justify-between text-sm text-red-600">
          <span>مجموع خروج</span>
          <span className="font-bold">−{fmtMoney(periodOut)}</span>
        </div>
        <div className="mt-1 flex justify-between border-t border-teal-200 pt-1 font-bold text-slate-800">
          <span>موجودی فعلی</span>
          <span className="text-xl">{fmtMoney(balance)}</span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {chip('today', 'امروز')}
        {chip('week', '۷ روز')}
        {chip('month', 'این ماه')}
        {chip('all', 'از اول')}
      </div>
      <input className={inputCls} placeholder="جستجو در شرح…" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="mt-3">
        {rows.length === 0 && <p className="text-sm text-slate-400">در این دوره حرکتی نیست.</p>}
        {[...days.entries()].map(([day, list]) => {
          const dayIn = list.filter((r) => r.delta > 0).reduce((s, r) => s + r.delta, 0)
          const dayOut = list.filter((r) => r.delta < 0).reduce((s, r) => s - r.delta, 0)
          return (
            <div key={day} className="mb-3">
              <div className="mb-1 flex items-baseline justify-between rounded-lg bg-slate-100 px-2 py-1">
                <span className="text-sm font-bold text-slate-700">{fmtDateShort(day)}</span>
                <span className="text-xs text-slate-500">
                  ＋{fmtMoney(dayIn)} · −{fmtMoney(dayOut)}
                </span>
              </div>
              {list.map((r) => (
                <div key={r.key} className="mb-1 flex items-start justify-between gap-2 rounded-lg bg-white p-2 text-sm shadow-sm">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-800">{r.label}</p>
                    {r.note && <p className="truncate text-xs text-slate-500">{r.note}</p>}
                    <p className="text-xs text-slate-400">{fmtDate(r.date)}</p>
                  </div>
                  <div className="shrink-0 text-left">
                    <p className={`font-bold ${r.delta >= 0 ? 'text-teal-700' : 'text-red-600'}`}>
                      {r.delta >= 0 ? '＋' : '−'}
                      {fmtMoney(Math.abs(r.delta))}
                    </p>
                    <p className="text-xs text-slate-500">صندوق شد: {fmtMoney(r.balance)}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

export function CashView() {
  const [showReconcile, setShowReconcile] = useState(false)
  const [showLedger, setShowLedger] = useState(false)
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
      <button onClick={() => setShowLedger(true)} className="mb-3 w-full rounded-2xl bg-teal-700 p-4 text-right text-white">
        <p className="text-sm opacity-80">موجودی صندوق</p>
        <p className="text-3xl font-bold">{fmtMoney(balance)}</p>
        <p className="mt-1 text-xs opacity-80">👆 برای دیدن «این عدد از کجا آمد» ضربه بزنید</p>
      </button>

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

      {showLedger && <CashLedgerModal onClose={() => setShowLedger(false)} />}

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

export default CashView
