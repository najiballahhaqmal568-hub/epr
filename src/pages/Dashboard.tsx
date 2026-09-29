import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, saleCashPaid, type Sale, type Variant } from '../db'
import { netWorth } from '../lib/networth'
import { addCalendarDays, fmtDateShort, fmtMoney, fmtNum, startOfDay, startOfMonth } from '../lib/format'
import { daysLeftInMonth, expenseAlert, profitSummary } from '../lib/profit'
import MonthProfitModal from './dashboard/MonthProfitModal'
import DailyCloseModal from './dashboard/DailyCloseModal'
import { reorderProducts } from '../lib/reorder'
import { syncNow, useSyncStatus } from '../lib/sync'
import { syncStatusLabel } from '../lib/syncStatusLabel'
import DirectTradeWarning, { useDirectTradeReview } from '../components/DirectTradeWarning'
import { commercialSaleLines } from '../lib/commercialLines'
import { returnProfit } from '../lib/returns'
import { Icon } from '../components/Icon'
import { RollingNumber } from '../components/RollingNumber'
import { celebrate } from '../lib/motion'
import CustomerGoodsReceiptWarning, { useCustomerGoodsReceiptReview } from '../components/CustomerGoodsReceiptWarning'
import ExplainModal, { type ExplainKind } from './dashboard/ExplainModal'
import TodaySalesModal from './dashboard/TodaySalesModal'
import FirstDayGuide from './dashboard/FirstDayGuide'

function SyncChip() {
  const status = useSyncStatus()
  if (status.state === 'off') return null

  const label = syncStatusLabel(status)

  return (
    <button
      onClick={() => {
        if (status.state === 'error' && status.message) window.alert(`خطای همگام‌سازی:\n${status.message}`)
        void syncNow()
      }}
      aria-label="وضعیت همگام‌سازی"
      title={status.message}
      className={`rounded-full px-3 py-1.5 text-xs font-bold ${
        status.state === 'ok' && status.pending === 0
          ? 'bg-teal-50 text-teal-700'
          : status.state === 'error'
            ? 'bg-red-50 text-red-600'
            : status.state === 'offline'
              ? 'bg-amber-50 text-amber-700'
              : 'bg-slate-100 text-slate-600'
      }`}
    >
      {label}
    </button>
  )
}

export default function Dashboard({
  goTo,
  isStaff,
  pendingExpenseCount,
  debtCount,
  debtTotal
}: {
  goTo: (tab: string) => void
  isStaff?: boolean
  pendingExpenseCount: number
  debtCount: number
  debtTotal: number
}) {
  const dayStart = startOfDay()
  const directReview = useDirectTradeReview()
  const receiptReview = useCustomerGoodsReceiptReview()
  const sales = useLiveQuery(
    () => db.sales.where('date').aboveOrEqual(dayStart).filter((row) => !row.deleted).toArray(),
    [dayStart]
  )
  const returns = useLiveQuery(
    () => db.returns.where('date').aboveOrEqual(dayStart).filter((row) => !row.deleted && row.kind === 'customer').toArray(),
    [dayStart]
  )
  const variants = useLiveQuery(() => db.variants.filter((row) => !row.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((row) => !row.deleted).toArray(), [])
  const customers = useLiveQuery(() => db.customers.filter((row) => !row.deleted).toArray(), [])
  const payments = useLiveQuery(() => db.payments.where('date').aboveOrEqual(dayStart).filter(row => !row.deleted).toArray(), [dayStart])
  const worth = useLiveQuery(() => netWorth(), [])
  // مفاد خالص این ماه و همین وقت ماه گذشته — همان فورمول راپورها (lib/profit.ts)
  const monthStart = startOfMonth()
  const prevStart = startOfMonth(monthStart - 1)
  const month = useLiveQuery(async () => {
    const [sales, returns, expenses] = await Promise.all([
      db.sales.where('date').aboveOrEqual(prevStart).toArray(),
      db.returns.where('date').aboveOrEqual(prevStart).toArray(),
      db.expenses.where('date').aboveOrEqual(prevStart).toArray()
    ])
    return { sales, returns, expenses }
  }, [prevStart])

  const variantMap = new Map<number, Variant>()
  variants?.forEach((variant) => variantMap.set(variant.id!, variant))
  const costOf = (line: { variantId?: number; unitCost?: number }) =>
    line.unitCost ?? (line.variantId === undefined ? 0 : variantMap.get(line.variantId)?.purchasePrice) ?? 0
  const grossProfit = (list: Sale[]) =>
    list.reduce(
      (sum, sale) =>
        sum + commercialSaleLines(sale).reduce((lineSum, line) => lineSum + (line.unitPrice - costOf(line)) * line.qty, 0) - (sale.discount ?? 0),
      0
    )
  const returnedProfit = (returns ?? []).reduce((sum, row) => sum + returnProfit(row), 0)

  const todaySales = (sales ?? []).filter(sale => (!sale.directTrade || directReview.readyTradeUuids.has(sale.directTrade.uuid)) && (!sale.goodsReceiptChild || receiptReview.readyReceiptUuids.has(sale.goodsReceiptChild.receiptUuid)))
  const todayTotal = todaySales.reduce((sum, row) => sum + row.total, 0)
  const todayCash = todaySales.filter(row => !row.directTrade).reduce((sum, row) => sum + saleCashPaid(row), 0)
  const todayDirectReceipts = payments?.filter(row => row.directPayment?.route === 'customerCash').reduce((sum, row) => sum + row.amount, 0) ?? 0
  const todayProfit = grossProfit(todaySales) - returnedProfit
  // Same numbers as todayProfit, split into steps for «از کجا آمد».
  const goodsValue = todaySales.reduce((sum, sale) => sum + commercialSaleLines(sale).reduce((s, line) => s + line.unitPrice * line.qty, 0), 0)
  const goodsCost = todaySales.reduce((sum, sale) => sum + commercialSaleLines(sale).reduce((s, line) => s + costOf(line) * line.qty, 0), 0)
  const discounts = todaySales.reduce((sum, sale) => sum + (sale.discount ?? 0), 0)
  const [explain, setExplain] = useState<ExplainKind | 'sales' | 'month' | null>(null)
  const [closingDay, setClosingDay] = useState<number | null>(null)
  // تنظیمات همین دستگاه: آخرین روز بسته‌شده و هدف مفاد ماهانه
  const prefs = useLiveQuery(async () => ({
    dayClosed: Number((await db.settings.get('dayClosed'))?.value ?? 0),
    target: Number((await db.settings.get('monthlyProfitTarget'))?.value ?? 0),
    celebrated: Number((await db.settings.get('targetCelebrated'))?.value ?? 0)
  }), [])
  const nowTs = Date.now()
  const prevEnd = Math.min(monthStart, prevStart + (nowTs - monthStart))
  const within = <T extends { date: number }>(rows: T[] | undefined, from: number, to: number) => (rows ?? []).filter(r => r.date >= from && r.date < to)
  const summaryFor = (from: number, to: number) => profitSummary({
    sales: within(month?.sales, from, to), returns: within(month?.returns, from, to), expenses: within(month?.expenses, from, to),
    variants: variants ?? [], readyTradeUuids: directReview.readyTradeUuids, readyReceiptUuids: receiptReview.readyReceiptUuids
  })
  const thisMonth = summaryFor(monthStart, Number.MAX_SAFE_INTEGER)
  const lastMonthSoFar = summaryFor(prevStart, prevEnd)
  const monthAlert = !isStaff && month ? expenseAlert(thisMonth, lastMonthSoFar, fmtMoney) : null
  const monthChange = thisMonth.netProfit - lastMonthSoFar.netProfit
  const lowStock = reorderProducts(products ?? [], variants ?? [])
  const overdueCount = (customers ?? []).filter(
    (row) => row.balance > 0 && Boolean(row.promiseDate) && row.promiseDate! < dayStart
  ).length
  // «بستن روز»: شب‌ها امروز؛ صبح‌ها اگر دیروز فروش داشت و بسته نشد، دیروز
  const hour = new Date().getHours()
  const yesterday = addCalendarDays(dayStart, -1)
  const yesterdaySold = within(month?.sales, yesterday, dayStart).some(sale => !sale.deleted)
  const closeDay = isStaff || !prefs ? null
    : hour >= 18 && prefs.dayClosed < dayStart ? dayStart
      : hour < 12 && prefs.dayClosed < yesterday && yesterdaySold ? yesterday : null
  const target = prefs?.target ?? 0
  const targetPct = target > 0 ? Math.max(0, Math.round((thisMonth.netProfit / target) * 100)) : 0
  const reached = !isStaff && target > 0 && thisMonth.netProfit >= target
  const monthCard = useRef<HTMLButtonElement>(null)
  // Target reached: one small celebration per month on this device, never again that month.
  useEffect(() => {
    if (!reached || !prefs || prefs.celebrated >= monthStart) return
    void db.settings.put({ key: 'targetCelebrated', value: monthStart })
    if (monthCard.current) celebrate(monthCard.current)
  }, [reached, prefs, monthStart])
  const hasTasks = pendingExpenseCount > 0 || lowStock.length > 0 || debtCount > 0 || overdueCount > 0 || Boolean(monthAlert) || closeDay !== null

  return (
    <div className="p-4">
      <div className="page-heading">
        <div><h1>خانه</h1><p>خلاصهٔ امروز دکان</p></div>
        <SyncChip />
      </div>
      {!isStaff && !accessFlags.readOnly && <FirstDayGuide goTo={goTo} />}
      <DirectTradeWarning review={directReview} />
      <CustomerGoodsReceiptWarning review={receiptReview} />

      <button type="button" aria-label={`فروش امروز ${fmtMoney(todayTotal)} — از کجا آمد`} onClick={() => setExplain('sales')} className="surface explain-card mb-4 block w-full p-5 text-right">
        <p className="text-sm text-slate-500">فروش امروز <span className="explain-hint">از کجا آمد ←</span></p>
        <p className="mt-2 text-4xl font-bold text-slate-900"><RollingNumber value={todayTotal} /></p>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-slate-600">
          <span>{fmtNum(todaySales.length)} فروش</span>
          <span>نقد فروش عادی: {fmtMoney(todayCash)}</span>
          <span>رسید مستقیم: {fmtMoney(todayDirectReceipts)}</span>
          {!isStaff && <span>مفاد: {fmtMoney(todayProfit)}</span>}
        </div>
      </button>

      {!isStaff && month && <button type="button" aria-label={`مفاد خالص این ماه ${fmtMoney(thisMonth.netProfit)} — از کجا آمد`} onClick={() => setExplain('month')} ref={monthCard} className="surface explain-card mb-4 block w-full p-5 text-right">
        <p className="text-sm text-slate-500">مفاد خالص این ماه <span className="text-xs">(از {fmtDateShort(monthStart)})</span> <span className="explain-hint">از کجا آمد ←</span></p>
        <p className={`mt-2 text-3xl font-bold ${thisMonth.netProfit >= 0 ? 'text-teal-700' : 'text-red-700'}`}><RollingNumber value={thisMonth.netProfit} /></p>
        <p className="mt-2 text-sm text-slate-600">مفاد فروش {fmtMoney(thisMonth.grossProfit)} − مصارف {fmtMoney(thisMonth.businessExpenses)}</p>
        <p className={`mt-1 text-sm font-bold ${monthChange >= 0 ? 'text-teal-700' : 'text-red-700'}`}>
          {monthChange >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(monthChange))} {monthChange >= 0 ? 'بیشتر' : 'کمتر'} از همین وقت ماه گذشته
        </p>
        {target > 0 && <span className="mt-3 block" aria-label="هدف ماه">
          <span className="profit-target-bar"><span style={{ width: `${Math.min(100, targetPct)}%` }} /></span>
          <span className="mt-1 block text-xs text-slate-600">هدف {fmtMoney(target)} — {fmtNum(targetPct)}٪ رسیده · {fmtNum(daysLeftInMonth())} روز مانده</span>
          {reached && <span className="target-reached">🎉 هدف این ماه رسید</span>}
        </span>}
      </button>}

      <button
        onClick={() => goTo('sales-new')}
        className="primary-button mb-3 flex items-center justify-center gap-2 py-4 text-lg"
      >
        <Icon name="plus" /> فروش جدید
      </button>
      <div className="mb-4 grid grid-cols-2 gap-2">
        <button onClick={() => goTo('purchases-new')} className="rounded-2xl border border-slate-200 bg-white py-3 font-bold text-slate-700">
          <Icon name="stock" className="mx-auto mb-1" /> خرید جدید
        </button>
        <button onClick={() => goTo('expenses-new')} className="rounded-2xl border border-slate-200 bg-white py-3 font-bold text-slate-700">
          <Icon name="wallet" className="mx-auto mb-1" /> مصرف جدید
        </button>
      </div>

      <section className="mb-4">
        {sales !== undefined && variants !== undefined && sales.length === 0 && variants.length === 0 && (
          <div className="surface mb-4 p-4 text-sm text-slate-600">
            <p className="mb-2 font-bold text-slate-800">برای شروع فروشگاه:</p>
            <p>۱. اجناس و قیمت‌ها را در گدام ثبت کنید.</p>
            <p>۲. موجودی صندوق را در مصارف و صندوق تصفیه کنید.</p>
            <p>۳. حساب‌های قبلی مشتریان و تأمین‌کنندگان را ثبت کنید.</p>
          </div>
        )}
        <h2 className="mb-2 text-lg font-bold text-slate-800">کارهای امروز</h2>
        {!hasTasks && <div className="rounded-2xl bg-teal-50 p-3 text-sm font-bold text-teal-700">کار ضروری ثبت‌نشده ندارید.</div>}
        <div className="space-y-2">
          {closeDay !== null && (
            <button onClick={() => setClosingDay(closeDay)} className="w-full rounded-2xl bg-[var(--action-tint)] p-3 text-right text-[var(--action)]">
              <span className="block font-bold">{closeDay === dayStart ? 'بستن امروز' : 'خلاصهٔ دیروز را ببینید'}</span>
              <span className="text-xs">فروش، مفاد، مصرف و صندوق روز — یک نگاه، بعد بسته کنید.</span>
            </button>
          )}
          {monthAlert && (
            <button onClick={() => setExplain('month')}
              className={`w-full rounded-2xl p-3 text-right ${monthAlert.level === 'danger' ? 'bg-red-50 text-red-800' : 'bg-amber-100 text-amber-900'}`}>
              <span className="block font-bold">{monthAlert.level === 'danger' ? 'مصرف از مفاد بیشتر شده' : 'مصرف این ماه بالا رفته'}</span>
              <span className="text-xs">{monthAlert.text}</span>
            </button>
          )}
          {pendingExpenseCount > 0 && (
            <button onClick={() => goTo('expenses')} className="w-full rounded-2xl bg-amber-100 p-3 text-right text-amber-900">
              <span className="block font-bold">{fmtNum(pendingExpenseCount)} مصرف روزانه ثبت نشده</span>
              <span className="text-xs">برای ثبت، اینجا بزنید.</span>
            </button>
          )}
          {lowStock.length > 0 && (
            <button onClick={() => goTo('inventory')} className="w-full rounded-2xl bg-red-50 p-3 text-right text-red-700">
              <span className="block font-bold">{fmtNum(lowStock.length)} جنس برای خرید مجدد</span>
              <span className="text-xs">موجودی آن‌ها به حد تعیین‌شده رسیده است.</span>
            </button>
          )}
          {debtCount > 0 && (
            <button onClick={() => goTo('accounts')} className="w-full rounded-2xl bg-blue-50 p-3 text-right text-blue-800">
              <span className="block font-bold">{fmtNum(debtCount)} مشتری قرضدار — {fmtMoney(debtTotal)}</span>
              <span className="text-xs">{overdueCount > 0 ? `${fmtNum(overdueCount)} وعده گذشته است.` : 'حساب‌های مشتریان را ببینید.'}</span>
            </button>
          )}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">خلاصهٔ حساب</h2>
          {!isStaff && (
            <button onClick={() => goTo('reports')} className="text-sm font-bold text-teal-700">
              راپور کامل
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => setExplain('receivables')} className="explain-card rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">طلب از مشتریان</span>
            <span className="block text-lg font-bold text-red-600"><RollingNumber value={worth?.receivables ?? 0} /></span>
          </button>
          <button onClick={() => setExplain('cash')} className="explain-card rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">صندوق</span>
            <span className="block text-lg font-bold text-slate-800"><RollingNumber value={worth?.cash ?? 0} /></span>
          </button>
          <button onClick={() => setExplain('stock')} className="explain-card rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">موجودی گدام</span>
            <span className="block text-lg font-bold text-teal-700">{fmtNum(worth?.pairs ?? 0)} جوړه</span>
          </button>
          <button onClick={() => setExplain('payables')} className="explain-card rounded-2xl bg-white p-3 text-right shadow-sm">
            <span className="block text-sm text-slate-500">قرض ما</span>
            <span className="block text-lg font-bold text-amber-700"><RollingNumber value={worth?.payables ?? 0} /></span>
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">هر عدد را بزنید تا ببینید از کدام حساب‌ها ساخته شده است.</p>
      </section>
      {explain === 'sales' && <TodaySalesModal sales={todaySales} isStaff={isStaff} goTo={goTo} onClose={() => setExplain(null)}
        parts={{ goods: goodsValue, cost: goodsCost, discount: discounts, returned: returnedProfit, profit: todayProfit }} />}
      {explain === 'month' && <MonthProfitModal current={thisMonth} previous={lastMonthSoFar} from={monthStart} goTo={goTo} onClose={() => setExplain(null)}
        target={target} onTarget={value => void db.settings.put({ key: 'monthlyProfitTarget', value })} />}
      {closingDay !== null && <DailyCloseModal day={closingDay} readyTradeUuids={directReview.readyTradeUuids} readyReceiptUuids={receiptReview.readyReceiptUuids}
        onClose={() => setClosingDay(null)}
        onClosed={() => { void db.settings.put({ key: 'dayClosed', value: Math.max(prefs?.dayClosed ?? 0, closingDay) }); setClosingDay(null) }} />}
      {explain && explain !== 'sales' && explain !== 'month' && <ExplainModal kind={explain} isStaff={isStaff} goTo={goTo} onClose={() => setExplain(null)} />}
    </div>
  )
}
