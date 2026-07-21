import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Variant } from '../db'
import { fmtNum, fmtMoney, startOfDay, startOfMonth, startOfYear, toDateInput, fromDateInput } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Card } from '../components/ui'
import { addCapital, addPartnerWithdrawal } from '../lib/ops'
import { parseNum } from '../lib/format'

type Period = 'today' | 'week' | 'month' | 'year' | 'custom'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'امروز' },
  { id: 'week', label: '۷ روز' },
  { id: 'month', label: 'این ماه' },
  { id: 'year', label: 'امسال' },
  { id: 'custom', label: 'دلخواه' }
]

export default function Reports({ onBack }: { onBack: () => void }) {
  const [period, setPeriod] = useState<Period>('month')
  const [fromStr, setFromStr] = useState(toDateInput(startOfMonth()))
  const [toStr, setToStr] = useState(toDateInput(Date.now()))

  // from/to باید بین رندرها ثابت باشند تا liveQuery درست کار کند
  let from: number
  let to = Number.MAX_SAFE_INTEGER
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
    case 'year':
      from = startOfYear()
      break
    case 'custom':
      from = fromDateInput(fromStr) - 12 * 3600000
      to = fromDateInput(toStr) + 12 * 3600000
      break
  }
  const now = Date.now()

  const sales = useLiveQuery(() => db.sales.where('date').between(from, to, true, true).filter((s) => !s.deleted).toArray(), [from, to])
  const purchases = useLiveQuery(() => db.purchases.where('date').between(from, to, true, true).filter((p) => !p.deleted).toArray(), [from, to])
  const expenses = useLiveQuery(() => db.expenses.where('date').between(from, to, true, true).filter((e) => !e.deleted).toArray(), [from, to])
  const payments = useLiveQuery(() => db.payments.where('date').between(from, to, true, true).filter((p) => !p.deleted).toArray(), [from, to])
  const returns = useLiveQuery(() => db.returns.where('date').between(from, to, true, true).filter((r) => !r.deleted).toArray(), [from, to])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const customers = useLiveQuery(() => db.customers.filter((c) => !c.deleted).toArray(), [])
  const allSales = useLiveQuery(() => db.sales.filter((s) => !s.deleted).toArray(), [])

  const variantMap = new Map<number, Variant>()
  variants?.forEach((v) => variantMap.set(v.id!, v))

  const salesTotal = sales?.reduce((s, x) => s + x.total, 0) ?? 0
  const salesCash = sales?.reduce((s, x) => s + x.paid, 0) ?? 0
  const pairsSold = sales?.reduce((s, x) => s + x.lines.reduce((a, l) => a + l.qty, 0), 0) ?? 0
  const grossProfit =
    sales?.reduce(
      (sum, sale) =>
        sum +
        sale.lines.reduce((s, l) => s + (l.unitPrice - (variantMap.get(l.variantId)?.purchasePrice ?? 0)) * l.qty, 0) -
        (sale.discount ?? 0),
      0
    ) ?? 0
  // زیان فروش زیر قیمت: خطوطی که قیمت فروش‌شان از قیمت خرید کمتر بوده
  const belowCostLoss =
    sales?.reduce(
      (sum, sale) =>
        sum +
        sale.lines.reduce((s, l) => {
          const cost = variantMap.get(l.variantId)?.purchasePrice ?? 0
          return s + Math.max(0, (cost - l.unitPrice) * l.qty)
        }, 0),
      0
    ) ?? 0
  const purchasesTotal = purchases?.reduce((s, x) => s + x.total, 0) ?? 0
  const businessExpenses = expenses?.filter((e) => e.type === 'business').reduce((s, e) => s + e.amount, 0) ?? 0
  const otherSpending = expenses?.filter((e) => e.type !== 'business').reduce((s, e) => s + e.amount, 0) ?? 0
  const netProfit = grossProfit - businessExpenses
  const collected = payments?.filter((p) => p.partyType === 'customer').reduce((s, p) => s + p.amount, 0) ?? 0
  const returnsTotal = returns?.filter((r) => r.kind === 'customer').reduce((s, r) => s + r.amount, 0) ?? 0

  // مصارف به تفکیک کتگوری
  const byCat = new Map<string, number>()
  expenses?.filter((e) => e.type === 'business').forEach((e) => byCat.set(e.categoryName, (byCat.get(e.categoryName) ?? 0) + e.amount))
  const catRows = [...byCat.entries()].sort((a, b) => b[1] - a[1])

  // پرفروش‌ترین‌ها در دوره
  const soldBy = new Map<string, { qty: number; revenue: number }>()
  sales?.forEach((s) =>
    s.lines.forEach((l) => {
      const key = `${l.productName} ${l.size} ${l.color}`.trim()
      const cur = soldBy.get(key) ?? { qty: 0, revenue: 0 }
      soldBy.set(key, { qty: cur.qty + l.qty, revenue: cur.revenue + l.qty * l.unitPrice })
    })
  )
  const topProducts = [...soldBy.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 8)

  // بهترین مشتریان در دوره
  const custBy = new Map<string, number>()
  sales?.forEach((s) => {
    if (s.customerName) custBy.set(s.customerName, (custBy.get(s.customerName) ?? 0) + s.total)
  })
  const topCustomers = [...custBy.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  // جنس مرده: موجودی دارد ولی در ۶۰ روز اخیر فروش نداشته
  const cutoff = now - 60 * 86400000
  const soldRecently = new Set<number>()
  allSales?.filter((s) => s.date >= cutoff).forEach((s) => s.lines.forEach((l) => soldRecently.add(l.variantId)))
  const productMap = new Map(products?.map((p) => [p.id!, p]))
  const deadStock = (variants ?? [])
    .filter((v) => v.stockQty > 0 && !soldRecently.has(v.id!))
    .map((v) => ({ v, p: productMap.get(v.productId) }))
    .sort((a, b) => b.v.stockQty * b.v.purchasePrice - a.v.stockQty * a.v.purchasePrice)
    .slice(0, 10)

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
          →
        </button>
        <h1 className="text-xl font-bold text-slate-800">راپورها</h1>
      </div>

      <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
        {PERIODS.map((p) => (
          <button
            key={p.id}
            onClick={() => setPeriod(p.id)}
            className={`whitespace-nowrap rounded-full px-3 py-1 text-sm ${period === p.id ? 'bg-teal-700 text-white' : 'bg-white text-slate-600'}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {period === 'custom' && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <label className="text-sm text-slate-600">
            از
            <input type="date" className={inputCls} value={fromStr} onChange={(e) => setFromStr(e.target.value)} />
          </label>
          <label className="text-sm text-slate-600">
            تا
            <input type="date" className={inputCls} value={toStr} onChange={(e) => setToStr(e.target.value)} />
          </label>
        </div>
      )}

      <Card>
        <p className="mb-2 font-bold text-slate-700">خلاصهٔ مالی</p>
        <Row label="فروش" value={fmtMoney(salesTotal)} sub={`${fmtNum(sales?.length ?? 0)} فروش · ${fmtNum(pairsSold)} جوړه`} />
        <Row label="نقد دریافتی از فروش" value={fmtMoney(salesCash)} />
        <Row label="وصول قرض مشتریان" value={fmtMoney(collected)} />
        <Row label="خرید جنس" value={fmtMoney(purchasesTotal)} red />
        <Row label="مصارف تجارت" value={fmtMoney(businessExpenses)} red />
        <Row label="مرجوعی مشتریان" value={fmtMoney(returnsTotal)} red />
        {belowCostLoss > 0 && <Row label="زیان فروش زیر قیمت (در مفاد کم شده)" value={fmtMoney(belowCostLoss)} red />}
        <Row label="مفاد ناخالص" value={fmtMoney(grossProfit)} bold />
        <Row label="مفاد خالص (بعد از مصارف)" value={fmtMoney(netProfit)} bold teal={netProfit >= 0} red={netProfit < 0} />
        {otherSpending > 0 && <Row label="خانه/شخصی/برداشت (خارج از مفاد)" value={fmtMoney(otherSpending)} />}
      </Card>

      <PartnersCard netProfit={netProfit} />

      {catRows.length > 0 && (
        <Card>
          <p className="mb-2 font-bold text-slate-700">مصارف به تفکیک کتگوری</p>
          {catRows.map(([name, amt]) => (
            <Row key={name} label={name} value={fmtMoney(amt)} />
          ))}
        </Card>
      )}

      <Card>
        <p className="mb-2 font-bold text-slate-700">پرفروش‌ترین اجناس دوره</p>
        {topProducts.length === 0 && <p className="text-sm text-slate-400">فروشی در این دوره نیست.</p>}
        {topProducts.map(([name, d]) => (
          <Row key={name} label={name} value={`${fmtNum(d.qty)} جوړه`} sub={fmtMoney(d.revenue)} />
        ))}
      </Card>

      <Card>
        <p className="mb-2 font-bold text-slate-700">بهترین مشتریان دوره</p>
        {topCustomers.length === 0 && <p className="text-sm text-slate-400">فروش با نام مشتری ثبت نشده.</p>}
        {topCustomers.map(([name, total]) => (
          <Row key={name} label={name} value={fmtMoney(total)} />
        ))}
        {customers && customers.filter((c) => c.flag === 'bad').length > 0 && (
          <p className="mt-2 text-xs text-red-600">
            ⚠️ قرض بد: {customers.filter((c) => c.flag === 'bad').map((c) => c.name).join('، ')}
          </p>
        )}
      </Card>

      <Card>
        <p className="mb-2 font-bold text-slate-700">جنس مرده (۶۰ روز بدون فروش)</p>
        {deadStock.length === 0 && <p className="text-sm text-slate-400">جنس مرده‌ای نیست ✓</p>}
        {deadStock.map(({ v, p }) => (
          <Row
            key={v.id}
            label={`${p?.name ?? ''} ${v.size} ${v.color}`}
            value={`${fmtNum(v.stockQty)} جوړه`}
            sub={`ارزش: ${fmtMoney(v.stockQty * v.purchasePrice)}`}
          />
        ))}
      </Card>
    </div>
  )
}

function Row({ label, value, sub, bold, red, teal }: { label: string; value: string; sub?: string; bold?: boolean; red?: boolean; teal?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className={`${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{label}</span>
      <span className="text-left">
        <span className={`font-bold ${teal ? 'text-teal-700' : red ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
        {sub && <span className="block text-xs font-normal text-slate-400">{sub}</span>}
      </span>
    </div>
  )
}

/** شرکا و سرمایه: سرمایه‌گذاری نقدی، برداشت هر شریک و تقسیم مفاد طبق فیصدی دستی */
function PartnersCard({ netProfit }: { netProfit: number }) {
  const [showAdd, setShowAdd] = useState(false)
  const [action, setAction] = useState<{ kind: 'capital' | 'withdraw'; id: number; name: string } | null>(null)
  const [name, setName] = useState('')
  const [share, setShare] = useState('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const partners = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted && x.kind === 'partner').toArray(), [])
  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted && Boolean(m.partnerName)).toArray(), [])

  const invested = (n: string) => movements?.filter((m) => m.partnerName === n && m.type === 'capitalIn').reduce((s, m) => s + m.amount, 0) ?? 0
  const withdrawn = (n: string) => movements?.filter((m) => m.partnerName === n && m.type === 'withdrawal').reduce((s, m) => s - m.amount, 0) ?? 0
  const shareSum = partners?.reduce((s, p) => s + (p.share ?? 0), 0) ?? 0

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-700">🤝 شرکا و سرمایه</p>
      <p className="mb-2 text-xs text-slate-400">سرمایه‌گذاری وارد صندوق می‌شود ولی در فروش و مفاد حساب نمی‌شود.</p>
      {partners?.length === 0 && <p className="mb-2 text-sm text-slate-400">شریکی ثبت نشده.</p>}
      {partners?.map((p) => (
        <div key={p.id} className="mb-2 rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="font-bold text-slate-800">
              {p.name} <span className="text-xs font-normal text-teal-700">({fmtNum(p.share ?? 0)}٪ مفاد)</span>
            </p>
            <p className="text-sm font-bold text-teal-700">سرمایه: {fmtMoney(invested(p.name))}</p>
          </div>
          <div className="mt-1 flex items-center justify-between text-xs text-slate-500">
            <span>برداشت: {fmtMoney(withdrawn(p.name))}</span>
            <span>
              سهم مفاد دوره: <b className={netProfit >= 0 ? 'text-teal-700' : 'text-red-600'}>{fmtMoney(Math.round((netProfit * (p.share ?? 0)) / 100))}</b>
            </span>
          </div>
          <div className="mt-2 flex gap-4">
            <button
              className="text-xs font-bold text-teal-700"
              onClick={() => {
                setAction({ kind: 'capital', id: p.id!, name: p.name })
                setAmount('')
                setNote('')
                setError('')
              }}
            >
              ＋ سرمایه‌گذاری
            </button>
            <button
              className="text-xs font-bold text-amber-700"
              onClick={() => {
                setAction({ kind: 'withdraw', id: p.id!, name: p.name })
                setAmount('')
                setError('')
              }}
            >
              برداشت
            </button>
          </div>
        </div>
      ))}
      {(partners?.length ?? 0) > 0 && shareSum !== 100 && (
        <p className="mb-2 text-xs font-bold text-red-600">⚠️ مجموع فیصدی‌ها {fmtNum(shareSum)}٪ است — باید ۱۰۰٪ شود.</p>
      )}
      <button onClick={() => setShowAdd(true)} className="w-full rounded-xl border border-dashed border-teal-600 py-2 text-sm font-bold text-teal-700">
        ＋ شریک جدید
      </button>

      {showAdd && (
        <Modal title="شریک جدید" onClose={() => setShowAdd(false)}>
          <Field label="نام شریک *">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="فیصدی سهم از مفاد *">
            <input className={inputCls} inputMode="numeric" value={share} onChange={(e) => setShare(e.target.value)} placeholder="مثلاً ۴۰" />
          </Field>
          <p className="mb-3 text-xs text-slate-400">خودتان را هم به عنوان شریک با فیصدی خودتان ثبت کنید تا مجموع ۱۰۰٪ شود.</p>
          <PrimaryBtn
            disabled={!name.trim() || parseNum(share) <= 0}
            onClick={async () => {
              await db.suppliers.add({ name: name.trim(), balance: 0, kind: 'partner', share: parseNum(share) })
              setName('')
              setShare('')
              setShowAdd(false)
            }}
          >
            ذخیره
          </PrimaryBtn>
        </Modal>
      )}

      {action && (
        <Modal title={action.kind === 'capital' ? `سرمایه‌گذاری — ${action.name}` : `برداشت — ${action.name}`} onClose={() => setAction(null)}>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          {action.kind === 'capital' && (
            <Field label="یادداشت (اختیاری)">
              <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          )}
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                if (action.kind === 'capital') await addCapital(action.name, parseNum(amount), note)
                else await addPartnerWithdrawal(action.name, parseNum(amount))
                setAction(null)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {action.kind === 'capital' ? 'ثبت سرمایه‌گذاری' : 'ثبت برداشت'}
          </PrimaryBtn>
        </Modal>
      )}
    </Card>
  )
}
