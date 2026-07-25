import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Variant } from '../db'
import { fmtNum, fmtMoney, jalaliMonth, ageLabel, startOfDay, startOfMonth, startOfYear, toDateInput, fromDateInput } from '../lib/format'
import { inputCls, Card } from '../components/ui'
import Row from './reports/Row'
import PartnersCard from './reports/PartnersCard'

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
  // قیمت خرید ثبت‌شده در خود فاکتور — مفاد گذشته با تغییر قیمت عوض نمی‌شود
  const costOf = (l: { variantId: number; unitCost?: number }) => l.unitCost ?? variantMap.get(l.variantId)?.purchasePrice ?? 0
  const salesProfit =
    sales?.reduce((sum, sale) => sum + sale.lines.reduce((s, l) => s + (l.unitPrice - costOf(l)) * l.qty, 0) - (sale.discount ?? 0), 0) ?? 0
  // مرجوعی مشتری مفاد همان فروش را پس می‌گیرد
  const returnedProfit =
    returns?.filter((r) => r.kind === 'customer').reduce((s, r) => s + r.lines.reduce((a, l) => a + (l.unitPrice - (l.unitCost ?? 0)) * l.qty, 0), 0) ?? 0
  const grossProfit = salesProfit - returnedProfit
  // زیان فروش زیر قیمت: خطوطی که قیمت فروش‌شان از قیمت خرید کمتر بوده
  const belowCostLoss =
    sales?.reduce(
      (sum, sale) =>
        sum +
        sale.lines.reduce((s, l) => s + Math.max(0, (costOf(l) - l.unitPrice) * l.qty), 0),
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

  // آمار به تفکیک مدل: جوړه فروخته‌شده، فروش و مفاد (تخفیف فاکتور به نسبت خط پخش می‌شود)
  const byModel = new Map<string, { qty: number; revenue: number; profit: number }>()
  sales?.forEach((s) => {
    const disc = s.discount ?? 0
    const sub = s.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0)
    s.lines.forEach((l) => {
      const cost = costOf(l)
      const lineTotal = l.qty * l.unitPrice
      const lineDisc = sub > 0 ? (lineTotal / sub) * disc : 0
      const cur = byModel.get(l.productName) ?? { qty: 0, revenue: 0, profit: 0 }
      byModel.set(l.productName, {
        qty: cur.qty + l.qty,
        revenue: cur.revenue + lineTotal - lineDisc,
        profit: cur.profit + (l.unitPrice - cost) * l.qty - lineDisc
      })
    })
  })
  const modelRows = [...byModel.entries()].sort((a, b) => b[1].qty - a[1].qty)

  // خرید از هر تأمین‌کننده در دوره
  const bySupplier = new Map<string, { total: number; pairs: number; count: number }>()
  purchases?.forEach((p) => {
    const cur = bySupplier.get(p.supplierName) ?? { total: 0, pairs: 0, count: 0 }
    bySupplier.set(p.supplierName, {
      total: cur.total + p.total,
      pairs: cur.pairs + p.lines.reduce((a, l) => a + l.qty, 0),
      count: cur.count + 1
    })
  })
  const supplierRows = [...bySupplier.entries()].sort((a, b) => b[1].total - a[1].total)

  // فروش ماه‌به‌ماه در دوره
  const byMonth = new Map<string, { label: string; total: number; qty: number; profit: number }>()
  sales?.forEach((s) => {
    const { key, label } = jalaliMonth(s.date)
    const cur = byMonth.get(key) ?? { label, total: 0, qty: 0, profit: 0 }
    const prof = s.lines.reduce((a, l) => a + (l.unitPrice - costOf(l)) * l.qty, 0) - (s.discount ?? 0)
    byMonth.set(key, {
      label,
      total: cur.total + s.total,
      qty: cur.qty + s.lines.reduce((a, l) => a + l.qty, 0),
      profit: cur.profit + prof
    })
  })
  const monthRows = [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)

  // پرفروش‌ترین سایزها
  const bySize = new Map<string, number>()
  sales?.forEach((s) => s.lines.forEach((l) => bySize.set(l.size, (bySize.get(l.size) ?? 0) + l.qty)))
  const sizeRows = [...bySize.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)

  // جنس مرده: موجودی دارد ولی در ۶۰ روز اخیر فروش نداشته
  const cutoff = now - 60 * 86400000
  const soldRecently = new Set<number>()
  allSales?.filter((s) => s.date >= cutoff).forEach((s) => s.lines.forEach((l) => soldRecently.add(l.variantId)))
  const productMap = new Map(products?.map((p) => [p.id!, p]))
  // کهنه‌ترین اول: جنسی که مدت بیشتری خوابیده، فوری‌تر است
  const deadStock = (variants ?? [])
    .filter((v) => v.stockQty > 0 && !soldRecently.has(v.id!))
    .map((v) => ({ v, p: productMap.get(v.productId) }))
    .sort((a, b) => (a.v.lastPurchaseAt ?? Infinity) - (b.v.lastPurchaseAt ?? Infinity))
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
        <p className="mb-2 font-bold text-slate-700">👞 آمار هر جنس (مدل) — جوړه، فروش، مفاد</p>
        {modelRows.length === 0 && <p className="text-sm text-slate-400">فروشی در این دوره نیست.</p>}
        {modelRows.map(([name, d]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-700">
              {name}
              <span className="block text-xs text-slate-400">{fmtNum(d.qty)} جوړه فروخته شد</span>
            </span>
            <span className="text-left">
              <span className="block font-bold text-slate-800">{fmtMoney(d.revenue)}</span>
              <span className={`text-xs font-bold ${d.profit >= 0 ? 'text-teal-700' : 'text-red-600'}`}>مفاد: {fmtMoney(d.profit)}</span>
            </span>
          </div>
        ))}
        {modelRows.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">
            جمله: {fmtNum(modelRows.reduce((s, [, d]) => s + d.qty, 0))} جوړه · مفاد {fmtMoney(modelRows.reduce((s, [, d]) => s + d.profit, 0))}
          </p>
        )}
      </Card>

      <Card>
        <p className="mb-2 font-bold text-slate-700">📦 خرید از تأمین‌کنندگان در دوره</p>
        {supplierRows.length === 0 && <p className="text-sm text-slate-400">خریدی در این دوره نیست.</p>}
        {supplierRows.map(([name, d]) => (
          <div key={name} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
            <span className="text-slate-700">
              {name}
              <span className="block text-xs text-slate-400">
                {fmtNum(d.count)} خرید · {fmtNum(d.pairs)} جوړه
              </span>
            </span>
            <span className="font-bold text-slate-800">{fmtMoney(d.total)}</span>
          </div>
        ))}
        {supplierRows.length > 0 && (
          <p className="mt-2 text-xs text-slate-400">جمله خرید: {fmtMoney(supplierRows.reduce((s, [, d]) => s + d.total, 0))}</p>
        )}
      </Card>

      {monthRows.length > 1 && (
        <Card>
          <p className="mb-2 font-bold text-slate-700">📅 فروش ماه‌به‌ماه</p>
          {monthRows.map((r2) => (
            <div key={r2.label} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
              <span className="text-slate-600">
                {r2.label}
                <span className="block text-xs text-slate-400">{fmtNum(r2.qty)} جوړه</span>
              </span>
              <span className="text-left">
                <span className="block font-bold text-slate-800">{fmtMoney(r2.total)}</span>
                <span className={`text-xs ${r2.profit >= 0 ? 'text-teal-700' : 'text-red-600'}`}>مفاد: {fmtMoney(r2.profit)}</span>
              </span>
            </div>
          ))}
        </Card>
      )}

      {sizeRows.length > 0 && (
        <Card>
          <p className="mb-2 font-bold text-slate-700">📏 پرفروش‌ترین سایزها</p>
          {sizeRows.map(([size, qty]) => (
            <div key={size} className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
              <span className="text-slate-600">سایز {size}</span>
              <span className="font-bold text-slate-800">{fmtNum(qty)} جوړه</span>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <p className="mb-2 font-bold text-slate-700">پرفروش‌ترین اجناس دوره (سایز به سایز)</p>
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
        <p className="mb-2 font-bold text-slate-700">جنس مرده (۶۰ روز بدون فروش) — کهنه‌ترین اول</p>
        {deadStock.length === 0 && <p className="text-sm text-slate-400">جنس مرده‌ای نیست ✓</p>}
        {deadStock.map(({ v, p }) => (
          <Row
            key={v.id}
            label={`${p?.name ?? ''} ${v.size} ${v.color}`}
            value={`${fmtNum(v.stockQty)} جوړه`}
            sub={`در گدام: ${ageLabel(v.lastPurchaseAt)} · ارزش: ${fmtMoney(v.stockQty * v.purchasePrice)}`}
          />
        ))}
      </Card>
    </div>
  )
}
