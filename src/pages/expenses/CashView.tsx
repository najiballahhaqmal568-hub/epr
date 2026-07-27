import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, accessFlags } from '../../db'
import { reconcile, transferCash, boxOf, SHOP_BOX } from '../../lib/ops'
import { fmtMoney, fmtDate, fmtDateShort, parseNum, startOfDay, startOfMonth } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Card } from '../../components/ui'
import { buildCashLedger } from '../../lib/ledger'
import CashForecastCard from '../../components/CashForecastCard'
import { MOVE_LABELS } from './labels'

/** دفتر صندوق: هر حرکت با موجودی بعد از آن، گروه‌شده به روز */
function CashLedgerModal({ onClose }: { onClose: () => void }) {
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [q, setQ] = useState('')
  const [boxFilter, setBoxFilter] = useState('')

  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])
  const boxNames = [...new Set((movements ?? []).map(boxOf))].sort()
  const scoped = (movements ?? []).filter((m) => !boxFilter || boxOf(m) === boxFilter)
  const all = buildCashLedger(scoped, (t) => MOVE_LABELS[t])

  const from =
    period === 'today' ? startOfDay() : period === 'week' ? startOfDay() - 6 * 86400000 : period === 'month' ? startOfMonth() : 0
  const inPeriod = all.filter((r) => r.date >= from)
  const rows = q.trim()
    ? inPeriod.filter((r) => `${r.label} ${r.note ?? ''} ${r.box ?? ''}`.includes(q.trim()))
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
    <Modal title={boxFilter ? `📒 دفتر ${boxFilter}` : '📒 دفتر پول (همهٔ جاها)'} onClose={onClose}>
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
          <span>{boxFilter ? 'موجودی فعلی' : 'پول کل'}</span>
          <span className="text-xl">{fmtMoney(balance)}</span>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {chip('today', 'امروز')}
        {chip('week', '۷ روز')}
        {chip('month', 'این ماه')}
        {chip('all', 'از اول')}
      </div>
      {boxNames.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            onClick={() => setBoxFilter('')}
            className={`rounded-full px-3 py-1.5 text-sm font-bold ${!boxFilter ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
          >
            همهٔ جاها
          </button>
          {boxNames.map((b) => (
            <button
              key={b}
              onClick={() => setBoxFilter(b)}
              className={`rounded-full px-3 py-1.5 text-sm font-bold ${boxFilter === b ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {b}
            </button>
          ))}
        </div>
      )}
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
                    <p className="font-bold text-slate-800">
                      {r.label}
                      {!boxFilter && <span className="mr-1 text-xs font-normal text-slate-400">({r.box})</span>}
                    </p>
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
  const [box, setBox] = useState(SHOP_BOX)
  const [showTransfer, setShowTransfer] = useState(false)
  const dayStart = startOfDay()

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])
  const reconciliations = useLiveQuery(() => db.reconciliations.orderBy('date').reverse().filter((r) => !r.deleted).limit(10).toArray(), [])

  // موجودی هر جای پول و مجموع کل
  const boxMap = new Map<string, number>()
  movements?.forEach((m) => boxMap.set(boxOf(m), (boxMap.get(boxOf(m)) ?? 0) + m.amount))
  if (!boxMap.has(SHOP_BOX)) boxMap.set(SHOP_BOX, 0)
  const boxes = [...boxMap.entries()]
    .map(([name, bal]) => ({ name, bal }))
    .sort((a, b) => (a.name === SHOP_BOX ? -1 : b.name === SHOP_BOX ? 1 : b.bal - a.bal))
  const totalCash = boxes.reduce((s, b) => s + b.bal, 0)

  // «صندوق» انتخاب‌شده
  const inBox = movements?.filter((m) => boxOf(m) === box) ?? []
  const balance = inBox.reduce((s, m) => s + m.amount, 0)
  const today = inBox.filter((m) => m.date >= dayStart).sort((a, b) => b.date - a.date)
  const todayIn = today.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0)
  const todayOut = today.filter((m) => m.amount < 0).reduce((s, m) => s - m.amount, 0)
  const opening = balance - todayIn + todayOut

  return (
    <>
      <button onClick={() => setShowLedger(true)} className="mb-3 w-full rounded-2xl bg-teal-700 p-4 text-right text-white">
        <p className="text-sm opacity-80">پول کل تجارت (همهٔ جاها)</p>
        <p className="text-3xl font-bold">{fmtMoney(totalCash)}</p>
        <p className="mt-1 text-xs opacity-80">👆 برای دیدن «این عدد از کجا آمد» ضربه بزنید</p>
      </button>

      <div className="mb-3 grid grid-cols-2 gap-2">
        {boxes.map((b) => (
          <button
            key={b.name}
            onClick={() => setBox(b.name)}
            className={`rounded-xl p-3 text-right ${box === b.name ? 'bg-teal-50 ring-2 ring-teal-600' : 'bg-white shadow-sm'}`}
          >
            <p className="text-sm text-slate-500">
              {b.name === SHOP_BOX ? '🏪' : b.name.includes('صراف') ? '💱' : b.name.includes('خانه') ? '🏠' : '💰'} {b.name}
            </p>
            <p className={`text-lg font-bold ${b.bal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtMoney(b.bal)}</p>
          </button>
        ))}
      </div>

      {!accessFlags.readOnly && (
        <button
          onClick={() => setShowTransfer(true)}
          className="mb-3 w-full rounded-xl border-2 border-dashed border-teal-400 py-2.5 text-sm font-bold text-teal-700"
        >
          ⇄ انتقال پول بین جاها (دکان ← خانه ← صراف)
        </button>
      )}

      <CashForecastCard />

      <Card>
        <p className="mb-2 font-bold text-slate-700">راپور امروز — {box}</p>
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
          تصفیه «{box}» (شمارش نقد)
        </button>
      )}

      <p className="mb-2 font-bold text-slate-700">حرکات امروز — {box}</p>
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
      {showTransfer && <TransferModal boxes={boxes.map((b) => b.name)} onClose={() => setShowTransfer(false)} />}

      {showReconcile && (
        <Modal title={`تصفیه ${box}`} onClose={() => setShowReconcile(false)}>
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
              await reconcile(c, note.trim() || undefined, shortage, box)
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

/** انتقال پول بین جاها — نه مصرف است و نه برداشت */
function TransferModal({ boxes, onClose }: { boxes: string[]; onClose: () => void }) {
  const [from, setFrom] = useState(SHOP_BOX)
  const [to, setTo] = useState('')
  const [newBox, setNewBox] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const target = to === '__new__' ? newBox.trim() : to
  const SUGGEST = ['خانه', 'صراف', SHOP_BOX].filter((x) => !boxes.includes(x))

  return (
    <Modal title="⇄ انتقال پول" onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}
      <p className="mb-3 text-sm text-slate-500">
        پول از یک جا به جای دیگر می‌رود. <b>نه مصرف است و نه برداشت</b> — پول کل تجارت و مفاد هیچ تغییری نمی‌کند.
      </p>

      <Field label="از کجا *">
        <select className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)}>
          {boxes.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </Field>

      <Field label="به کجا *">
        <select className={inputCls} value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">انتخاب کنید…</option>
          {boxes
            .filter((b) => b !== from)
            .map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          {SUGGEST.map((b) => (
            <option key={b} value={b}>
              {b} (جای نو)
            </option>
          ))}
          <option value="__new__">＋ جای نو با نام دلخواه…</option>
        </select>
      </Field>
      {to === '__new__' && (
        <Field label="نام جای نو *">
          <input className={inputCls} value={newBox} onChange={(e) => setNewBox(e.target.value)} placeholder="مثلاً صراف احمد" />
        </Field>
      )}

      <Field label="مبلغ *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً برای امانت شب" />
      </Field>

      <PrimaryBtn
        disabled={!target || parseNum(amount) <= 0}
        onClick={async () => {
          try {
            await transferCash(from, target, parseNum(amount), note)
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        ثبت انتقال
      </PrimaryBtn>
    </Modal>
  )
}
