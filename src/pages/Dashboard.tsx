import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type Customer, type Sale, type Variant } from '../db'
import { netWorth } from '../lib/networth'
import { addCalendarDays, fmtDayLabel, fmtMoney, fmtNum, startOfDay, startOfMonth } from '../lib/format'
import { daysLeftInMonth, expenseAlert, profitSummary } from '../lib/profit'
import MonthProfitModal from './dashboard/MonthProfitModal'
import DailyCloseModal from './dashboard/DailyCloseModal'
import { reorderProducts } from '../lib/reorder'
import { syncNow, useSyncStatus } from '../lib/sync'
import { syncStatusLabel } from '../lib/syncStatusLabel'
import DirectTradeWarning, { useDirectTradeReview } from '../components/DirectTradeWarning'
import { commercialSaleLines } from '../lib/commercialLines'
import { summarizeSales } from '../lib/salesFigures'
import { returnProfit } from '../lib/returns'
import { Icon, type IconName } from '../components/Icon'
import { RollingNumber } from '../components/RollingNumber'
import { celebrate } from '../lib/motion'
import CustomerGoodsReceiptWarning, { useCustomerGoodsReceiptReview } from '../components/CustomerGoodsReceiptWarning'
import ExplainModal, { type ExplainKind } from './dashboard/ExplainModal'
import TodaySalesModal from './dashboard/TodaySalesModal'
import FirstDayGuide from './dashboard/FirstDayGuide'
import HomeHero, { TimePrompt, type HeroState } from './dashboard/HomeHero'
import MoneyMap from './dashboard/MoneyMap'
import RecentSales from './dashboard/RecentSales'
import ReceivePicker from './dashboard/ReceivePicker'
import BackupNudgeCard from './dashboard/BackupNudgeCard'
import CustomerDetail from './customers/CustomerDetail'

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

const ACTIONS: { key: string; label: string; aria: string; icon: IconName; tint: string }[] = [
  { key: 'receive', label: 'دریافت پول', aria: 'دریافت پول از مشتری', icon: 'wallet', tint: 'bg-teal-50 text-teal-700' },
  { key: 'expense', label: 'مصرف', aria: 'مصرف جدید', icon: 'receipt', tint: 'bg-red-50 text-red-700' },
  { key: 'purchase', label: 'خرید', aria: 'خرید جدید', icon: 'stock', tint: 'bg-blue-50 text-blue-700' },
  { key: 'count', label: 'شمارش نقد', aria: 'شمارش نقد صندوق', icon: 'coins', tint: 'bg-amber-100 text-amber-800' }
]

export default function Dashboard({
  goTo,
  isStaff,
  pendingExpenseCount
}: {
  goTo: (tab: string) => void
  isStaff?: boolean
  pendingExpenseCount: number
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
  const suppliers = useLiveQuery(() => db.suppliers.filter((row) => !row.deleted).toArray(), [])
  // امروز صندوق شمرده شده؟ (برای کارت صبح)
  const countedToday = useLiveQuery(() => db.reconciliations.where('date').aboveOrEqual(dayStart).filter((row) => !row.deleted).count(), [dayStart])
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
  const { cash: todayCash, pairs: todayPairs } = summarizeSales(todaySales)
  const todayProfit = grossProfit(todaySales) - returnedProfit
  // Same numbers as todayProfit, split into steps for «از کجا آمد».
  const goodsValue = todaySales.reduce((sum, sale) => sum + commercialSaleLines(sale).reduce((s, line) => s + line.unitPrice * line.qty, 0), 0)
  const goodsCost = todaySales.reduce((sum, sale) => sum + commercialSaleLines(sale).reduce((s, line) => s + costOf(line) * line.qty, 0), 0)
  const discounts = todaySales.reduce((sum, sale) => sum + (sale.discount ?? 0), 0)
  const [explain, setExplain] = useState<ExplainKind | 'sales' | 'month' | null>(null)
  const [closingDay, setClosingDay] = useState<number | null>(null)
  const [picking, setPicking] = useState(false)
  const [receiving, setReceiving] = useState<Customer | null>(null)
  // تنظیمات همین دستگاه: آخرین روز بسته‌شده، هدف مفاد ماهانه و «بعداً»ی کارت صبح
  const prefs = useLiveQuery(async () => ({
    dayClosed: Number((await db.settings.get('dayClosed'))?.value ?? 0),
    target: Number((await db.settings.get('monthlyProfitTarget'))?.value ?? 0),
    celebrated: Number((await db.settings.get('targetCelebrated'))?.value ?? 0),
    morningSkip: Number((await db.settings.get('homeMorningSkip'))?.value ?? 0)
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

  const canAct = !accessFlags.readOnly
  // کدام خبر بالای صفحه بیاید: شب ← بستن روز، صبح ← شمارش صندوق، وگرنه حساب این ماه.
  // کارگر مفاد نمی‌بیند؛ تا حساب ماه نخوانده، جای خالیِ خاکستری می‌آید نه «۰».
  const evening = canAct && closeDay === dayStart
  const morning = canAct && !isStaff && !evening && hour < 12 && countedToday === 0 && Boolean(prefs) && (prefs?.morningSkip ?? 0) < dayStart && worth !== undefined
  const heroState: HeroState = isStaff ? 'today' : !month || !prefs ? 'loading' : 'month'
  const yesterdayPending = closeDay !== null && closeDay !== dayStart
  const debtors = (customers ?? []).filter((c) => c.balance > 0).length
  const owedSuppliers = (suppliers ?? []).filter((x) => x.kind !== 'partner' && x.kind !== 'lender' && x.balance > 0).length
  const owedLenders = (suppliers ?? []).filter((x) => x.kind === 'lender' && x.balance > 0).length
  const actionFor = (key: string) => () => {
    if (key === 'receive') setPicking(true)
    else if (key === 'expense') goTo('expenses-new')
    else if (key === 'purchase') goTo('purchases-new')
    else goTo('cash-count')
  }

  return (
    <div className="p-4">
      <header className="mb-4 flex items-center justify-between gap-3">
        <h1 className="sr-only">خانه</h1>
        <p className="text-[0.9375rem] font-bold text-slate-600">{fmtDayLabel(Date.now())}</p>
        <SyncChip />
      </header>
      {!isStaff && !accessFlags.readOnly && <FirstDayGuide goTo={goTo} />}
      <DirectTradeWarning review={directReview} />
      <CustomerGoodsReceiptWarning review={receiptReview} />

      {(morning || evening) && (
        <TimePrompt
          kind={morning ? 'morning' : 'evening'}
          cash={worth?.cash ?? 0}
          noSalesYet={todaySales.length === 0}
          yesterdayPending={yesterdayPending}
          onCount={() => goTo('cash-count')}
          onSkip={() => void db.settings.put({ key: 'homeMorningSkip', value: dayStart })}
          onCloseDay={() => { if (closeDay !== null) setClosingDay(closeDay) }}
          onOpenSales={() => setExplain('sales')}
          onYesterday={() => { if (closeDay !== null) setClosingDay(closeDay) }}
        />
      )}

      <HomeHero
        state={heroState}
        canAct={canAct}
        todayTotal={todayTotal}
        todayCount={todaySales.length}
        todayCash={todayCash}
        monthNet={thisMonth.netProfit}
        monthProfit={thisMonth.grossProfit}
        monthExpenses={thisMonth.businessExpenses}
        monthChange={monthChange}
        topCategory={thisMonth.expenseCategories[0]}
        alert={monthAlert}
        pendingExpenses={pendingExpenseCount}
        target={target}
        targetPct={targetPct}
        reached={reached}
        daysLeft={daysLeftInMonth()}
        monthRef={monthCard}
        onOpenMonth={() => setExplain('month')}
        onOpenSales={() => setExplain('sales')}
        goTo={goTo}
      />

      {canAct && (
        <div role="group" aria-label="کارهای سریع" className="mb-4 grid grid-cols-4 gap-2">
          {ACTIONS.map((a) => (
            <button key={a.key} type="button" aria-label={a.aria} onClick={actionFor(a.key)} className="flex min-h-[94px] flex-col items-center justify-center gap-2 rounded-[20px] border border-slate-200 bg-white px-1 py-2 text-[0.8125rem] font-extrabold text-slate-800">
              <span className={`flex h-[46px] w-[46px] items-center justify-center rounded-2xl ${a.tint}`}><Icon name={a.icon} /></span>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {canAct && !isStaff && <BackupNudgeCard />}

      {!isStaff && (
        <section aria-label="امروز تا حالا" className="mb-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-lg font-bold text-slate-800">امروز تا حالا</h2>
            {yesterdayPending && canAct && <button type="button" onClick={() => setClosingDay(closeDay)} className="min-h-[44px] px-1 text-sm font-bold text-[var(--action)]">خلاصهٔ دیروز را ببینید ‹</button>}
          </div>
          <button type="button" aria-label={`فروش امروز ${fmtMoney(todayTotal)} — از کجا آمد`} onClick={() => setExplain('sales')} className="surface explain-card grid w-full grid-cols-3 p-4 text-right">
            <span className="flex flex-col gap-0.5 border-l border-slate-200 pl-2.5">
              <span className="text-[0.8125rem] text-slate-500">فروش</span>
              <span className="text-[1.0625rem] font-extrabold text-slate-900"><RollingNumber value={todayTotal} /></span>
            </span>
            <span className="flex flex-col gap-0.5 border-l border-slate-200 px-2.5">
              <span className="text-[0.8125rem] text-slate-500">جوړه</span>
              <span className="text-[1.0625rem] font-extrabold text-slate-900">{fmtNum(todayPairs)}</span>
            </span>
            <span className="flex flex-col gap-0.5 pr-2.5">
              <span className="text-[0.8125rem] text-slate-500">نقد فروش</span>
              <span className="text-[1.0625rem] font-extrabold text-teal-700"><RollingNumber value={todayCash} /></span>
            </span>
            <span className="col-span-3 mt-3 border-t border-slate-200 pt-2 text-sm text-slate-600">مفاد: {fmtMoney(todayProfit)}</span>
          </button>
        </section>
      )}

      {sales !== undefined && variants !== undefined && sales.length === 0 && variants.length === 0 && (
        <div className="surface mb-4 p-4 text-sm text-slate-600">
          <p className="mb-2 font-bold text-slate-800">برای شروع فروشگاه:</p>
          <p>۱. اجناس و قیمت‌ها را در گدام ثبت کنید.</p>
          <p>۲. موجودی صندوق را در مصارف و صندوق تصفیه کنید.</p>
          <p>۳. حساب‌های قبلی مشتریان و تأمین‌کنندگان را ثبت کنید.</p>
        </div>
      )}

      <MoneyMap worth={worth} debtors={debtors} suppliers={owedSuppliers} lenders={owedLenders} onOpen={(kind) => setExplain(kind)} />

      <RecentSales sales={todaySales} goTo={goTo} />

      {lowStock.length > 0 && (
        <button type="button" onClick={() => goTo('inventory')} className="mb-4 flex min-h-[68px] w-full items-center gap-3 rounded-[20px] border border-slate-200 bg-white px-3.5 py-3 text-right">
          <span className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-700"><Icon name="stock" /></span>
          <span className="flex flex-1 flex-col">
            <span className="text-[0.9375rem] font-bold text-slate-800">{fmtNum(lowStock.length)} جنس برای خرید مجدد</span>
            <span className="text-[0.8125rem] text-slate-500">موجودی آن‌ها به حد تعیین‌شده رسیده است.</span>
          </span>
          <Icon name="chevron" className="text-slate-400" />
        </button>
      )}

      {!isStaff && (
        <button type="button" onClick={() => goTo('reports')} className="min-h-[44px] px-1 text-sm font-bold text-teal-700">راپور کامل ‹</button>
      )}

      {picking && <ReceivePicker onClose={() => setPicking(false)} onPick={(c) => { setPicking(false); setReceiving(c) }} />}
      {receiving && <CustomerDetail customer={receiving} startPay onClose={() => setReceiving(null)} />}
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
