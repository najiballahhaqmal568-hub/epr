import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type SaleLine, type Variant, type Product } from '../db'
import { addSale, deleteSale, addCustomerReturn, addExchange } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum, fromDateInput, startOfDay, startOfMonth } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

export default function Sales() {
  const [view, setView] = useState<'list' | 'stats'>('list')
  const [showNew, setShowNew] = useState(false)
  const [returning, setReturning] = useState<Sale | null>(null)
  const [exchanging, setExchanging] = useState<Sale | null>(null)
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().filter((s) => !s.deleted).limit(100).toArray(), [])

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">فروش</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('list')} className={tabCls('list')}>
          فروش‌ها
        </button>
        <button onClick={() => setView('stats')} className={tabCls('stats')}>
          آمار
        </button>
      </div>
      {view === 'stats' && <SalesStats />}
      {view === 'list' && (
        <>
      {sales?.length === 0 && <Empty text="هنوز فروشی ثبت نشده." />}
      {sales?.map((s) => {
        const remainder = s.total - s.paid
        return (
          <Card key={s.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-800">
                  {s.customerName || 'مشتری نقدی'}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({s.saleType === 'retail' ? 'پرچون' : 'عمده'})
                  </span>
                </p>
                <p className="text-xs text-slate-500">{fmtDate(s.date)}</p>
              </div>
              <div className="text-left">
                <p className="font-bold text-teal-700">{fmtMoney(s.total)}</p>
                {(s.discount ?? 0) > 0 && <p className="text-xs text-amber-600">تخفیف: {fmtMoney(s.discount!)}</p>}
                {remainder > 0 && <p className="text-xs text-red-600">باقی: {fmtMoney(remainder)}</p>}
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {s.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
            </p>
            <div className="mt-1 flex gap-4">
              <button className="text-xs font-bold text-teal-700" onClick={() => setReturning(s)}>
                مرجوعی
              </button>
              <button className="text-xs font-bold text-amber-700" onClick={() => setExchanging(s)}>
                تبادله
              </button>
              <button
                className="text-xs text-red-500"
                onClick={async () => {
                  if (confirm('این فروش حذف شود؟ اجناس به گدام برمی‌گردد.')) await deleteSale(s.id!)
                }}
              >
                حذف فروش
              </button>
            </div>
          </Card>
        )
      })}
      <Fab onClick={() => setShowNew(true)} label="فروش جدید" />
        </>
      )}
      {showNew && <NewSaleModal onClose={() => setShowNew(false)} />}
      {returning && <ReturnModal sale={returning} onClose={() => setReturning(null)} />}
      {exchanging && <ExchangeModal sale={exchanging} onClose={() => setExchanging(null)} />}
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

/** آمار فروش: مجموع دوره + پرفروش‌ترین اجناس + بهترین مشتریان */
function SalesStats() {
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

  const sales = useLiveQuery(() => db.sales.where('date').between(from, to, true, true).filter((s) => !s.deleted).toArray(), [from, to])

  const total = sales?.reduce((s, x) => s + x.total, 0) ?? 0
  const cash = sales?.reduce((s, x) => s + x.paid, 0) ?? 0
  const pairs = sales?.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty, 0), 0) ?? 0
  const credit = Math.max(0, total - cash)

  const soldBy = new Map<string, { qty: number; revenue: number }>()
  sales?.forEach((s) =>
    s.lines.forEach((l) => {
      const key = `${l.productName} ${l.size} ${l.color}`.trim()
      const cur = soldBy.get(key) ?? { qty: 0, revenue: 0 }
      soldBy.set(key, { qty: cur.qty + l.qty, revenue: cur.revenue + l.qty * l.unitPrice })
    })
  )
  const topProducts = [...soldBy.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 8)

  const custBy = new Map<string, number>()
  sales?.forEach((s) => {
    if (s.customerName) custBy.set(s.customerName, (custBy.get(s.customerName) ?? 0) + s.total)
  })
  const topCustomers = [...custBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

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

      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white">
        <p className="text-sm opacity-80">مجموع فروش {STATS_PERIODS.find((p) => p.id === period)?.label}</p>
        <p className="text-3xl font-bold">{fmtMoney(total)}</p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>نقد: {fmtMoney(cash)}</span>
          {credit > 0 && <span>قرضی: {fmtMoney(credit)}</span>}
          <span>{fmtNum(sales?.length ?? 0)} فروش</span>
          <span>{fmtNum(pairs)} جوړه</span>
        </div>
      </div>

      <Card>
        <p className="mb-2 font-bold text-slate-700">🔥 پرفروش‌ترین اجناس</p>
        {topProducts.length === 0 && <p className="text-sm text-slate-400">فروشی در این دوره نیست.</p>}
        {topProducts.map(([name, d]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-600">{name}</span>
            <span className="text-left">
              <span className="font-bold text-slate-800">{fmtNum(d.qty)} جوړه</span>
              <span className="block text-xs text-slate-400">{fmtMoney(d.revenue)}</span>
            </span>
          </div>
        ))}
      </Card>

      <Card>
        <p className="mb-2 font-bold text-slate-700">⭐ بهترین مشتریان</p>
        {topCustomers.length === 0 && <p className="text-sm text-slate-400">فروش با نام مشتری در این دوره ثبت نشده.</p>}
        {topCustomers.map(([name, t]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-600">{name}</span>
            <span className="font-bold text-slate-800">{fmtMoney(t)}</span>
          </div>
        ))}
      </Card>
    </>
  )
}

function ReturnModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('سایز غلط')
  const [settlement, setSettlement] = useState<'cashRefund' | 'reduceDebt'>(sale.customerId ? 'reduceDebt' : 'cashRefund')
  const [error, setError] = useState('')

  const customer = useLiveQuery(
    async () => (sale.customerId ? await db.customers.get(sale.customerId) : undefined),
    [sale.customerId]
  )

  const amount = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)

  async function save() {
    const lines = sale.lines
      .map((l, i) => ({ ...l, qty: qtys[i] ?? 0, restock }))
      .filter((l) => l.qty > 0)
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    if (settlement === 'reduceDebt' && !sale.customerId) return setError('این فروش مشتری ندارد — بازپرداخت نقدی را انتخاب کنید')
    try {
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: sale.customerId,
        partyName: sale.customerName ?? 'مشتری نقدی',
        refId: sale.id,
        lines,
        reason,
        settlement,
        amount
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="مرجوعی فروش" onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">
        {sale.customerName || 'مشتری نقدی'} — {fmtDate(sale.date)}
      </p>
      {sale.lines.map((l, i) => (
        <div key={i} className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-2">
          <div className="text-sm">
            <p className="font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <p className="text-slate-500">
              فروخته: {fmtNum(l.qty)} × {fmtMoney(l.unitPrice)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQtys((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1) }))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={qtys[i] ?? 0}
              onChange={(e) => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, Math.max(0, parseNum(e.target.value) || 0)) }))}
            />
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1) }))}>
              ＋
            </button>
          </div>
        </div>
      ))}

      <Field label="دلیل مرجوعی">
        <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>سایز غلط</option>
          <option>خرابی جنس</option>
          <option>تبدیلی</option>
          <option>پشیمانی مشتری</option>
          <option>دیگر</option>
        </select>
      </Field>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4" />
        جنس سالم است — به گدام برگردد (اگر داغمه است تیک را بردارید)
      </label>

      <Field label="تصفیه پول">
        <select className={inputCls} value={settlement} onChange={(e) => setSettlement(e.target.value as 'cashRefund' | 'reduceDebt')}>
          <option value="cashRefund">بازپرداخت نقدی از صندوق</option>
          {sale.customerId && <option value="reduceDebt">کم شدن از قرض مشتری{customer ? ` (قرض فعلی: ${fmtMoney(customer.balance)})` : ''}</option>}
        </select>
      </Field>

      <p className="mb-3 font-bold text-slate-800">مبلغ مرجوعی: {fmtMoney(amount)}</p>
      <p className="mb-3 text-xs text-slate-400">اگر مشتری جنس دیگری می‌خواهد، به جای مرجوعی از دکمهٔ «تبادله» استفاده کنید.</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={amount <= 0}>
        ثبت مرجوعی
      </PrimaryBtn>
    </Modal>
  )
}

/** تبادله: جنس برگشتی + جنس جدید؛ صندوق فقط تفاوت را می‌بیند */
function ExchangeModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [newLines, setNewLines] = useState<SaleLine[]>([])
  const [search, setSearch] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [cashTouched, setCashTouched] = useState(false)
  const [error, setError] = useState('')

  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  const returnAmount = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)
  const newTotal = newLines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const diff = newTotal - returnAmount
  const cashIn = cashTouched ? parseNum(cashStr) : Math.max(0, diff)
  // اگر جنس جدید ارزان‌تر است، تفاوت نقد به مشتری برمی‌گردد (اثر خالص صندوق = تفاوت)
  const paid = diff >= 0 ? returnAmount + cashIn : newTotal
  const remainder = newTotal - paid

  function addLine(v: Variant) {
    const p = productMap.get(v.productId)!
    const price = sale.saleType === 'retail' ? v.retailPrice : v.wholesalePrice
    setNewLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: price }]
    })
    setSearch('')
  }

  async function save() {
    const retLines = sale.lines
      .map((l, i) => ({ ...l, qty: qtys[i] ?? 0, restock }))
      .filter((l) => l.qty > 0)
    if (!retLines.length) return setError('جنس برگشتی را انتخاب کنید')
    if (!newLines.length) return setError('جنس جدید را انتخاب کنید')
    if (remainder > 0 && !sale.customerId) return setError('این فروش مشتری ندارد — تفاوت باید نقد گرفته شود')
    try {
      await addExchange(
        {
          date: Date.now(),
          kind: 'customer',
          partyId: sale.customerId,
          partyName: sale.customerName ?? 'مشتری نقدی',
          refId: sale.id,
          lines: retLines,
          reason: 'تبادله',
          settlement: 'cashRefund',
          amount: returnAmount
        },
        {
          date: Date.now(),
          customerId: sale.customerId,
          customerName: sale.customerName,
          saleType: sale.saleType,
          lines: newLines,
          total: newTotal,
          paid
        }
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="تبادلهٔ جنس" onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">
        {sale.customerName || 'مشتری نقدی'} — {fmtDate(sale.date)}
      </p>

      <p className="mb-1 text-sm font-bold text-slate-700">۱) جنس برگشتی</p>
      {sale.lines.map((l, i) => (
        <div key={i} className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-2">
          <div className="text-sm">
            <p className="font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <p className="text-slate-500">
              فروخته: {fmtNum(l.qty)} × {fmtMoney(l.unitPrice)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQtys((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1) }))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={qtys[i] ?? 0}
              onChange={(e) => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, Math.max(0, parseNum(e.target.value) || 0)) }))}
            />
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1) }))}>
              ＋
            </button>
          </div>
        </div>
      ))}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4" />
        جنس برگشتی سالم است — به گدام برگردد
      </label>

      <p className="mb-1 text-sm font-bold text-slate-700">۲) جنس جدید</p>
      <Field label="جستجوی جنس">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((v) => {
            const p = productMap.get(v.productId)!
            return (
              <button
                key={v.id}
                onClick={() => addLine(v)}
                disabled={v.stockQty <= 0 && !sale.lines.some((l) => l.variantId === v.id)}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50 disabled:opacity-40"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">
                  {fmtNum(v.stockQty)} عدد · {fmtMoney(sale.saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {newLines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1">
            <p className="text-sm font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              value={l.unitPrice}
              onChange={(e) => setNewLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت فی جوړه</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={l.qty}
              onChange={(e) => setNewLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseNum(e.target.value) || 1) } : x)))}
            />
            <button className="mr-1 text-red-500" onClick={() => setNewLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="mt-3 rounded-xl bg-amber-50 p-3">
        <div className="flex justify-between text-slate-600">
          <span>ارزش جنس برگشتی</span>
          <span>{fmtMoney(returnAmount)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>ارزش جنس جدید</span>
          <span>{fmtMoney(newTotal)}</span>
        </div>
        {diff > 0 && (
          <>
            <div className="flex justify-between font-bold text-slate-800">
              <span>تفاوت — از مشتری بگیرید</span>
              <span>{fmtMoney(diff)}</span>
            </div>
            <Field label="دریافتی نقدی">
              <input
                className={inputCls}
                inputMode="numeric"
                value={cashTouched ? cashStr : String(diff)}
                onFocus={() => {
                  if (!cashTouched) {
                    setCashTouched(true)
                    setCashStr(String(diff))
                  }
                }}
                onChange={(e) => setCashStr(e.target.value)}
              />
            </Field>
            {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض مشتری): {fmtMoney(remainder)}</p>}
          </>
        )}
        {diff < 0 && <p className="font-bold text-amber-700">بازگشت نقدی به مشتری: {fmtMoney(-diff)}</p>}
        {diff === 0 && newTotal > 0 && <p className="font-bold text-teal-700">برابر — بدون پرداخت ✓</p>}
      </div>

      {error && <p className="my-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3">
        <PrimaryBtn onClick={save} disabled={returnAmount <= 0 || !newLines.length}>
          ثبت تبادله
        </PrimaryBtn>
      </div>
    </Modal>
  )
}

function NewSaleModal({ onClose }: { onClose: () => void }) {
  const [saleType, setSaleType] = useState<'retail' | 'wholesale'>('retail')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [custSearch, setCustSearch] = useState('')
  const [lines, setLines] = useState<SaleLine[]>([])
  const [paidStr, setPaidStr] = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  const [discountStr, setDiscountStr] = useState('')
  const [promise, setPromise] = useState('')
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  // فروش‌های ۳۰ روز اخیر برای کاشی‌های «پرفروش‌ها»
  const recentSales = useLiveQuery(
    () => db.sales.where('date').aboveOrEqual(Date.now() - 30 * 86400000).filter((s) => !s.deleted).toArray(),
    []
  )

  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  // پرفروش‌ترین‌های ۳۰ روز اخیر؛ اگر فروشی نبود، اجناس با موجودی بیشتر
  const soldCount = new Map<number, number>()
  recentSales?.forEach((s) => s.lines.forEach((l) => soldCount.set(l.variantId, (soldCount.get(l.variantId) ?? 0) + l.qty)))
  const quickTiles = (variants ?? [])
    .filter((v) => v.stockQty > 0 && productMap.has(v.productId))
    .sort((a, b) => {
      const d = (soldCount.get(b.id!) ?? 0) - (soldCount.get(a.id!) ?? 0)
      return d !== 0 ? d : b.stockQty - a.stockQty
    })
    .slice(0, 6)

  const matches =
    search.trim() && variants && products
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color} ${v.sku ?? ''}`
            return search
              .trim()
              .split(/\s+/)
              .every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  // جنس‌های کارتن‌دارِ مطابق جستجو — برای فروش کارتنی
  const cartonProducts = [
    ...new Map(
      matches
        .map((v) => productMap.get(v.productId)!)
        .filter((p) => (p.carton?.items.length ?? 0) > 0)
        .map((p) => [p.id!, p])
    ).values()
  ]

  /** چند کارتن کامل از این جنس در گدام موجود است؟ */
  function cartonsInStock(p: Product): number {
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    return Math.min(
      ...p.carton!.items.map((it) => {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        return v ? Math.floor(v.stockQty / it.qty) : 0
      })
    )
  }

  function addCartonSale(p: Product) {
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    setLines((ls) => {
      let out = [...ls]
      for (const it of p.carton!.items) {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        if (!v) continue
        const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
        const i = out.findIndex((l) => l.variantId === v.id)
        if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + it.qty } : l))
        else out.push({ variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: it.qty, unitPrice: price })
      }
      return out
    })
    // قیمت کارتنی: تفاوت با مجموع فی‌جوړه به شکل تخفیف ثبت می‌شود تا مجموع دقیقاً قیمت کارتن شود
    if (saleType === 'wholesale' && p.carton?.price) {
      const vs2 = variants?.filter((v) => v.productId === p.id) ?? []
      const pairSum = p.carton.items.reduce((s, it) => {
        const v = vs2.find((x) => x.size === it.size && x.color === it.color)
        return s + it.qty * (v?.wholesalePrice ?? 0)
      }, 0)
      const diff = pairSum - p.carton.price
      if (diff > 0) setDiscountStr((prev) => String(parseNum(prev) + diff))
    }
  }

  const selectedCustomer = customers?.find((c) => c.id === customerId)
  const custMatches =
    custSearch.trim() && customers
      ? customers.filter((c) => `${c.name} ${c.phone ?? ''}`.includes(custSearch.trim())).slice(0, 8)
      : []

  async function quickAddCustomer() {
    const name = custSearch.trim()
    if (!name) return
    const id = (await db.customers.add({ name, type: saleType, balance: 0 })) as number
    setCustomerId(id)
    setCustSearch('')
  }

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const discount = Math.min(parseNum(discountStr), subtotal)
  const total = subtotal - discount
  const paid = paidTouched ? parseNum(paidStr) : total
  const remainder = total - paid

  function addLine(v: Variant) {
    const p = productMap.get(v.productId)!
    const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: price }]
    })
    setSearch('')
  }

  async function save() {
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    if (remainder > 0 && !customerId) return setError('برای فروش قرضی باید مشتری انتخاب شود')
    const customer = customers?.find((c) => c.id === customerId)
    try {
      await addSale({
        date: Date.now(),
        customerId: customerId || undefined,
        customerName: customer?.name,
        saleType,
        lines,
        total,
        paid,
        discount: discount > 0 ? discount : undefined,
        promiseDate: remainder > 0 && promise ? fromDateInput(promise) : undefined
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="فروش جدید" onClose={onClose}>
      <div className="mb-3 flex gap-2">
        {(['retail', 'wholesale'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setSaleType(t)
              setLines((ls) =>
                ls.map((l) => {
                  const v = variants?.find((v) => v.id === l.variantId)
                  return v ? { ...l, unitPrice: t === 'retail' ? v.retailPrice : v.wholesalePrice } : l
                })
              )
            }}
            className={`flex-1 rounded-xl py-2 font-bold ${
              saleType === t ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t === 'retail' ? 'پرچون' : 'عمده'}
          </button>
        ))}
      </div>

      {selectedCustomer ? (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-teal-50 p-2.5">
          <div>
            <p className="font-bold text-teal-800">👤 {selectedCustomer.name}</p>
            {selectedCustomer.balance > 0 && (
              <p className="text-xs text-red-600">قرض فعلی: {fmtMoney(selectedCustomer.balance)}</p>
            )}
          </div>
          <button
            className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-500"
            onClick={() => setCustomerId('')}
            aria-label="حذف مشتری"
          >
            ✕
          </button>
        </div>
      ) : (
        <Field label="مشتری (خالی = نقدی؛ برای قرضی لازمی)">
          <input
            className={inputCls}
            value={custSearch}
            onChange={(e) => setCustSearch(e.target.value)}
            placeholder="جستجوی نام یا تلفن مشتری..."
          />
        </Field>
      )}
      {!selectedCustomer && custSearch.trim() && (
        <div className="-mt-2 mb-3 overflow-hidden rounded-xl border border-slate-200">
          {custMatches.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCustomerId(c.id!)
                setCustSearch('')
              }}
              className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50"
            >
              <span>{c.name}</span>
              {c.balance > 0 ? (
                <span className="text-xs text-red-600">قرض: {fmtMoney(c.balance)}</span>
              ) : (
                <span className="text-xs text-slate-400">{c.phone}</span>
              )}
            </button>
          ))}
          <button onClick={() => void quickAddCustomer()} className="w-full bg-teal-50 px-3 py-2 text-right font-bold text-teal-800">
            ＋ مشتری جدید: «{custSearch.trim()}»
          </button>
        </div>
      )}

      {quickTiles.length > 0 && !search.trim() && (
        <>
          <p className="mb-1 text-sm font-bold text-slate-700">🔥 پرفروش‌ها — با یک ضربه اضافه کنید</p>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {quickTiles.map((v) => {
              const p = productMap.get(v.productId)!
              return (
                <button
                  key={v.id}
                  onClick={() => addLine(v)}
                  className="rounded-xl border border-slate-200 bg-white p-2 text-center active:bg-teal-50"
                >
                  {p.photo ? (
                    <img src={p.photo} alt="" className="mx-auto mb-1 h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <span className="mb-1 block text-2xl">👞</span>
                  )}
                  <p className="truncate text-xs font-bold text-slate-800">{p.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {v.size} {v.color}
                  </p>
                  <p className="text-xs font-bold text-teal-700">{fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}</p>
                </button>
              )
            })}
          </div>
        </>
      )}

      <Field label="جستجوی جنس">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز، رنگ یا کود..." />
      </Field>
      {cartonProducts.map((p) => {
        const pairs = p.carton!.items.reduce((s, it) => s + it.qty, 0)
        const avail = cartonsInStock(p)
        return (
          <button
            key={`c${p.id}`}
            onClick={() => addCartonSale(p)}
            disabled={avail <= 0}
            className="mb-2 flex w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-right font-bold text-amber-800 active:bg-amber-100 disabled:opacity-40"
          >
            <span>
              📦 {p.name} — ＋ یک کارتن ({fmtNum(pairs)} جوړه)
              {saleType === 'wholesale' && p.carton!.price ? <span className="block text-xs font-normal">قیمت کارتنی: {fmtMoney(p.carton!.price)}</span> : null}
            </span>
            <span className="text-sm font-normal">{avail > 0 ? `${fmtNum(avail)} کارتن موجود` : 'کارتن کامل نیست'}</span>
          </button>
        )
      })}
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((v) => {
            const p = productMap.get(v.productId)!
            return (
              <button
                key={v.id}
                onClick={() => addLine(v)}
                disabled={v.stockQty <= 0}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50 disabled:opacity-40"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">
                  {v.stockQty <= 0 ? 'ناموجود' : `${fmtNum(v.stockQty)} عدد · ${fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}`}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {lines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1">
            <p className="text-sm font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              value={l.unitPrice}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت فی جوړه</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseNum(e.target.value) || 1) } : x)))}
            />
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              ＋
            </button>
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="mt-3 rounded-xl bg-teal-50 p-3">
        <div className="flex justify-between text-slate-600">
          <span>مجموع اجناس</span>
          <span>{fmtMoney(subtotal)}</span>
        </div>
        <Field label="تخفیف (اختیاری)">
          <input className={inputCls} inputMode="numeric" value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} placeholder="۰" />
        </Field>
        <div className="flex justify-between font-bold text-slate-800">
          <span>قابل پرداخت{discount > 0 ? ` (با ${fmtMoney(discount)} تخفیف)` : ''}</span>
          <span>{fmtMoney(total)}</span>
        </div>
        <Field label="مبلغ دریافتی (نقد)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={paidTouched ? paidStr : String(total)}
            onFocus={() => {
              if (!paidTouched) {
                setPaidTouched(true)
                setPaidStr(String(total))
              }
            }}
            onChange={(e) => setPaidStr(e.target.value)}
          />
        </Field>
        {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض مشتری): {fmtMoney(remainder)}</p>}
        {remainder > 0 && (
          <Field label="وعدهٔ پرداخت (اختیاری)">
            <input type="date" className={inputCls} value={promise} onChange={(e) => setPromise(e.target.value)} />
          </Field>
        )}
        {remainder < 0 && <p className="text-sm font-bold text-amber-600">بازگشت به مشتری: {fmtMoney(-remainder)}</p>}
      </div>

      {error && <p className="my-2 text-sm text-red-600">{error}</p>}
      {/* نوار چسپان: مجموع و ثبت همیشه دیده شوند */}
      <div className="sticky bottom-0 -mx-4 -mb-8 mt-3 flex items-center gap-3 border-t border-slate-200 bg-white p-3 pb-4">
        <div className="flex-1">
          <p className="text-xs text-slate-500">قابل پرداخت</p>
          <p className="text-xl font-bold text-teal-700">{fmtMoney(total)}</p>
        </div>
        <button
          onClick={save}
          disabled={!lines.length}
          className="rounded-xl bg-teal-700 px-8 py-3 text-lg font-bold text-white active:bg-teal-800 disabled:opacity-40"
        >
          ثبت فروش
        </button>
      </div>
    </Modal>
  )
}
