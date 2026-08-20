import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saleCashPaid, type Variant } from '../db'
import { fmtNum, fmtMoney, ageLabel, startOfDay, startOfMonth, startOfYear, toDateInput, fromDateInput } from '../lib/format'
import { inputCls, Card } from '../components/ui'
import { ColumnChart } from '../components/charts'
import Row from './reports/Row'
import PartnersCard from './reports/PartnersCard'
import {
  RetailWholesaleCard,
  ModelsCard,
  CustomersCard,
  MonthsCard,
  PeriodCompareCard
} from '../components/AnalyticsCards'

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
  const [showDetails, setShowDetails] = useState(false)
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
  const expenses = useLiveQuery(() => db.expenses.where('date').between(from, to, true, true).filter((e) => !e.deleted && !e.shopClosed).toArray(), [from, to])
  const payments = useLiveQuery(() => db.payments.where('date').between(from, to, true, true).filter((p) => !p.deleted).toArray(), [from, to])
  const returns = useLiveQuery(() => db.returns.where('date').between(from, to, true, true).filter((r) => !r.deleted).toArray(), [from, to])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const allSales = useLiveQuery(() => db.sales.filter((s) => !s.deleted).toArray(), [])
  // دورهٔ قبلی با همان طول — برای کارت مقایسه
  const prevSales = useLiveQuery(() => {
    const span = Math.min(to, Date.now()) - from
    return db.sales.where('date').between(from - span, from, true, false).filter((s) => !s.deleted).toArray()
  }, [from, to])

  const variantMap = new Map<number, Variant>()
  variants?.forEach((v) => variantMap.set(v.id!, v))

  const salesTotal = sales?.reduce((s, x) => s + x.total, 0) ?? 0
  const salesCash = sales?.reduce((s, x) => s + saleCashPaid(x), 0) ?? 0
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
  const soldBy = new Map<string, { qty: number; revenue: number; profit: number }>()
  sales?.forEach((s) =>
    s.lines.forEach((l) => {
      const key = `${l.productName} ${l.size} ${l.color}`.trim()
      const cur = soldBy.get(key) ?? { qty: 0, revenue: 0, profit: 0 }
      soldBy.set(key, {
        qty: cur.qty + l.qty,
        revenue: cur.revenue + l.qty * l.unitPrice,
        profit: cur.profit + (l.unitPrice - costOf(l)) * l.qty
      })
    })
  )
  const topProducts = [...soldBy.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 8)
  const topProfitProduct = [...soldBy.entries()].sort((a, b) => b[1].profit - a[1].profit)[0]

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

  const trendEnd = Math.max(from + 1, Math.min(to, Date.now() + 1))
  const trendCount = period === 'week' ? 7 : 4
  const trendSpan = Math.max(1, trendEnd - from)
  const trendLabels =
    period === 'today'
      ? ['صبح', 'چاشت', 'عصر', 'شب']
      : period === 'week'
        ? ['۱', '۲', '۳', '۴', '۵', '۶', '۷']
        : period === 'month'
          ? ['هفتهٔ اول', 'هفتهٔ دوم', 'هفتهٔ سوم', 'این هفته']
          : period === 'year'
            ? ['بهار', 'تابستان', 'خزان', 'زمستان']
            : ['بخش ۱', 'بخش ۲', 'بخش ۳', 'بخش ۴']
  const trendRows = Array.from({ length: trendCount }, (_, index) => ({
    label: trendLabels[index] ?? String(index + 1),
    value: 0,
    second: 0
  }))
  const trendIndex = (date: number) => Math.min(trendCount - 1, Math.max(0, Math.floor(((date - from) / trendSpan) * trendCount)))
  sales?.forEach((sale) => {
    const row = trendRows[trendIndex(sale.date)]
    row.value += sale.total
    row.second += sale.lines.reduce((sum, line) => sum + (line.unitPrice - costOf(line)) * line.qty, 0) - (sale.discount ?? 0)
  })
  returns?.filter((row) => row.kind === 'customer').forEach((returned) => {
    const row = trendRows[trendIndex(returned.date)]
    row.value -= returned.amount
    row.second -= returned.lines.reduce((sum, line) => sum + (line.unitPrice - (line.unitCost ?? 0)) * line.qty, 0)
  })
  const shortMoney = (amount: number) => (Math.abs(amount) >= 1000 ? `${fmtNum(Math.round(amount / 1000))}هـ` : fmtNum(Math.round(amount)))

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        <button onClick={onBack} className="rounded-full bg-slate-100 px-3 py-1.5 text-sm text-slate-600">برگشت</button>
        <div>
          <h1 className="text-xl font-bold text-slate-800">راپورها</h1>
          <p className="text-xs text-slate-500">نتیجه‌های مهم تجارت در یک نگاه</p>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-white p-1 shadow-sm">
        {PERIODS.filter((item) => item.id !== 'custom').map((item) => (
          <button
            key={item.id}
            onClick={() => setPeriod(item.id)}
            className={`rounded-xl px-1 py-2 text-xs font-bold ${period === item.id ? 'bg-teal-100 text-teal-800' : 'text-slate-500'}`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <button onClick={() => setPeriod('custom')} className={`mb-3 text-xs font-bold ${period === 'custom' ? 'text-teal-800' : 'text-slate-500'}`}>
        انتخاب تاریخ دلخواه
      </button>
      {period === 'custom' && (
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-white p-3 shadow-sm">
          <label className="text-sm text-slate-600">از<input type="date" className={inputCls} value={fromStr} onChange={(e) => setFromStr(e.target.value)} /></label>
          <label className="text-sm text-slate-600">تا<input type="date" className={inputCls} value={toStr} onChange={(e) => setToStr(e.target.value)} /></label>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-slate-500">فروش</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{fmtMoney(salesTotal)}</p>
          <p className="text-[11px] text-slate-400">{fmtNum(sales?.length ?? 0)} فروش</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-slate-500">مفاد خالص</p>
          <p className={`mt-1 text-lg font-bold ${netProfit >= 0 ? 'text-teal-700' : 'text-red-600'}`}>{fmtMoney(netProfit)}</p>
          <p className="text-[11px] text-slate-400">بعد از مصارف تجارت</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-slate-500">مصارف تجارت</p>
          <p className="mt-1 text-lg font-bold text-red-600">{fmtMoney(businessExpenses)}</p>
          <p className="text-[11px] text-slate-400">در همین دوره</p>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-white p-3 shadow-sm">
          <p className="text-xs text-slate-500">جوړهٔ فروخته</p>
          <p className="mt-1 text-lg font-bold text-slate-800">{fmtNum(pairsSold)}</p>
          <p className="text-[11px] text-slate-400">مجموع تعداد</p>
        </div>
      </div>

      <Card>
        <p className="mb-1 font-bold text-slate-800">روند فروش و مفاد</p>
        <p className="mb-2 text-xs text-slate-400">سبز: فروش · بنفش: مفاد</p>
        <div dir="ltr" className="overflow-hidden">
          <ColumnChart rows={[...trendRows].reverse()} fmt={shortMoney} compact />
        </div>
      </Card>

      <div className="mb-2 flex items-center justify-between">
        <p className="font-bold text-slate-800">مهم‌ترین نتیجه‌ها</p>
      </div>
      <div className="mb-3 rounded-2xl bg-white px-3 shadow-sm">
        {topProducts[0] && <ResultRow label="پرفروش‌ترین جنس" name={topProducts[0][0]} value={`${fmtNum(topProducts[0][1].qty)} جوړه`} />}
        {topProfitProduct && <ResultRow label="بیشترین مفاد فروش" name={topProfitProduct[0]} value={fmtMoney(topProfitProduct[1].profit)} />}
        {belowCostLoss > 0 && <ResultRow label="فروش زیر قیمت" name="نیاز به بررسی" value={fmtMoney(belowCostLoss)} danger />}
        {deadStock[0] && <ResultRow label="جنس کم‌حرکت" name={`${deadStock[0].p?.name ?? ''} ${deadStock[0].v.size}`.trim()} value={`${fmtNum(deadStock[0].v.stockQty)} جوړه`} />}
        {!topProducts[0] && !deadStock[0] && <p className="py-5 text-center text-sm text-slate-400">برای این دوره هنوز نتیجه‌ای نیست.</p>}
      </div>

      <button onClick={() => setShowDetails((value) => !value)} className="mb-3 flex w-full items-center justify-between rounded-xl bg-slate-100 px-3 py-2.5 text-sm font-bold text-slate-600">
        <span>جزئیات و تحلیل کامل</span>
        <span>{showDetails ? 'بستن' : 'بازکردن'}</span>
      </button>

      {showDetails && (
        <>
          <Card>
            <p className="mb-2 font-bold text-slate-700">خلاصهٔ مالی کامل</p>
            <Row label="فروش" value={fmtMoney(salesTotal)} sub={`${fmtNum(sales?.length ?? 0)} فروش · ${fmtNum(pairsSold)} جوړه`} />
            <Row label="نقد دریافتی از فروش" value={fmtMoney(salesCash)} />
            <Row label="وصول قرض مشتریان" value={fmtMoney(collected)} />
            <Row label="خرید جنس" value={fmtMoney(purchasesTotal)} red />
            <Row label="مصارف تجارت" value={fmtMoney(businessExpenses)} red />
            <Row label="مرجوعی مشتریان" value={fmtMoney(returnsTotal)} red />
            {belowCostLoss > 0 && <Row label="زیان فروش زیر قیمت" value={fmtMoney(belowCostLoss)} red />}
            <Row label="مفاد ناخالص" value={fmtMoney(grossProfit)} bold />
            <Row label="مفاد خالص" value={fmtMoney(netProfit)} bold teal={netProfit >= 0} red={netProfit < 0} />
            {otherSpending > 0 && <Row label="خانه/شخصی/برداشت (خارج از مفاد)" value={fmtMoney(otherSpending)} />}
          </Card>

          <PartnersCard netProfit={netProfit} />
          {catRows.length > 0 && <Card><p className="mb-2 font-bold text-slate-700">مصارف به تفکیک کتگوری</p>{catRows.map(([name, amount]) => <Row key={name} label={name} value={fmtMoney(amount)} />)}</Card>}
          <PeriodCompareCard label="دورهٔ قبلی" now={sales ?? []} before={prevSales ?? []} returnsNow={returns ?? []} />
          <RetailWholesaleCard sales={sales ?? []} returns={returns ?? []} />
          <ModelsCard sales={sales ?? []} />
          <CustomersCard sales={sales ?? []} />
          <MonthsCard sales={sales ?? []} />

          <Card>
            <p className="mb-2 font-bold text-slate-700">خرید از تأمین‌کنندگان در دوره</p>
            {supplierRows.length === 0 && <p className="text-sm text-slate-400">خریدی در این دوره نیست.</p>}
            {supplierRows.map(([name, data]) => <Row key={name} label={name} value={fmtMoney(data.total)} sub={`${fmtNum(data.count)} خرید · ${fmtNum(data.pairs)} جوړه`} />)}
          </Card>

          {sizeRows.length > 0 && <Card><p className="mb-2 font-bold text-slate-700">پرفروش‌ترین سایزها</p>{sizeRows.map(([size, qty]) => <Row key={size} label={`سایز ${size}`} value={`${fmtNum(qty)} جوړه`} />)}</Card>}
          <Card><p className="mb-2 font-bold text-slate-700">پرفروش‌ترین اجناس دوره</p>{topProducts.length === 0 && <p className="text-sm text-slate-400">فروشی در این دوره نیست.</p>}{topProducts.map(([name, data]) => <Row key={name} label={name} value={`${fmtNum(data.qty)} جوړه`} sub={fmtMoney(data.revenue)} />)}</Card>
          <Card><p className="mb-2 font-bold text-slate-700">جنس مرده — ۶۰ روز بدون فروش</p>{deadStock.length === 0 && <p className="text-sm text-slate-400">جنس مرده‌ای نیست.</p>}{deadStock.map(({ v, p }) => <Row key={v.id} label={`${p?.name ?? ''} ${v.size} ${v.color}`} value={`${fmtNum(v.stockQty)} جوړه`} sub={`در گدام: ${ageLabel(v.lastPurchaseAt)} · ارزش: ${fmtMoney(v.stockQty * v.purchasePrice)}`} />)}</Card>
        </>
      )}
    </div>
  )
}

function ResultRow({ label, name, value, danger = false }: { label: string; name: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-3 last:border-0">
      <span className="min-w-0">
        <span className="block text-xs text-slate-500">{label}</span>
        <span className="block truncate text-sm font-bold text-slate-800">{name}</span>
      </span>
      <span className={`shrink-0 text-sm font-bold ${danger ? 'text-red-600' : 'text-teal-700'}`}>{value}</span>
    </div>
  )
}
