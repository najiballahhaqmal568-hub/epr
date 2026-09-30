import type { ReactNode, RefObject } from 'react'
import { RollingNumber, type RollFlash } from '../../components/RollingNumber'
import { Skeleton } from '../../components/ui'
import { fmtMoney, fmtNum } from '../../lib/format'
import type { ExpenseAlert } from '../../lib/profit'

/**
 * بالای صفحهٔ خانه دو چیز می‌آید:
 *  • TimePrompt — یک کارت روشن که فقط صبح (صندوق را بشمارید) و شام (روز را ببندید) می‌آید.
 *  • HomeHero — کارت تیره که همیشه سر جایش است: اول مفاد یا زیان «امسال» (از ۱ حمل تا امروز) — یک ماه
 *    با مصرف‌های سنگین ممکن است زیان نشان دهد در حالی که سال در مفاد است؛ مالک اول سال را می‌بیند —
 *    بعد «این ماه» با مقایسه، هشدار و هدف ماه.
 * کارگر مفاد نمی‌بیند؛ برایش فقط فروش امروز می‌آید.
 * هر عددی که اینجا دیده می‌شود از همان حساب‌های صفحه می‌آید؛ هیچ جمله‌ای حدس نیست.
 */
export type HeroState = 'loading' | 'today' | 'month'

export interface HeroProps {
  state: HeroState
  /** شریکِ فقط‌مشاهده دکمهٔ ثبت نمی‌بیند */
  canAct: boolean
  todayTotal: number
  todayCount: number
  todayCash: number
  /** از ۱ حمل تا امروز — همان profitSummary و همان مرز «امسال» در راپورها */
  yearNet: number
  yearProfit: number
  yearExpenses: number
  onOpenYear: () => void
  monthNet: number
  monthProfit: number
  monthExpenses: number
  monthChange: number
  topCategory?: { name: string; amount: number }
  /** همان هشدار سنجیدهٔ lib/profit: مصرف از مفاد بیشتر (سرخ) یا از ماه گذشته خیلی بیشتر (زرد) */
  alert?: ExpenseAlert | null
  pendingExpenses: number
  target: number
  targetPct: number
  reached: boolean
  daysLeft: number
  monthRef?: RefObject<HTMLButtonElement>
  onOpenMonth: () => void
  onOpenSales: () => void
  goTo: (target: string) => void
}

// چشمکِ عدد روی لاجورد باید روشن بماند (رنگ‌های تیرهٔ پیش‌فرض وسط چشمک ناخوانا می‌شوند)
const ON_DARK: RollFlash = { up: '#B6F0D6', down: '#FFD0C8' }

const GOLD = 'flex-1 min-h-[52px] rounded-2xl bg-[#E0A43A] px-4 text-base font-extrabold text-[#151A28]'
const GHOST = 'min-h-[52px] rounded-2xl border border-white/30 px-4 text-[0.9375rem] font-bold text-white'

function Girih() {
  return (
    <svg aria-hidden="true" width="240" height="240" viewBox="0 0 240 240" className="pointer-events-none absolute -left-16 -top-[74px] opacity-20">
      <defs>
        <pattern id="home-girih" width="48" height="48" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="#E0A43A" strokeWidth="1.3">
            <rect x="12" y="12" width="24" height="24" />
            <rect x="12" y="12" width="24" height="24" transform="rotate(45 24 24)" />
            <path d="M0 24h7M41 24h7M24 0v7M24 41v7" />
          </g>
        </pattern>
      </defs>
      <rect width="240" height="240" fill="url(#home-girih)" />
    </svg>
  )
}

function Shell({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <section aria-label="سرخط امروز" className="relative mb-4 overflow-hidden rounded-[26px] bg-[#10214D] p-[18px] text-white">
      <Girih />
      <div className="relative flex flex-col gap-3.5">
        <span className="self-start rounded-full bg-[#E0A43A]/20 px-3 py-1 text-[0.8125rem] font-extrabold text-[#F3C46B]">{tag}</span>
        {children}
      </div>
    </section>
  )
}

export default function HomeHero(p: HeroProps) {
  if (p.state === 'loading') {
    return <Shell tag="امسال تا امروز"><Skeleton rows={3} label="در حال خواندن حساب سال…" /></Shell>
  }

  if (p.state === 'today') {
    return (
      <Shell tag="امروز">
        <button type="button" aria-label={`فروش امروز ${fmtMoney(p.todayTotal)} — از کجا آمد`} onClick={p.onOpenSales} className="flex flex-col gap-2 text-right">
          <span className="text-[0.9375rem] text-[#C9D6E6]">فروش امروز <span className="text-xs text-[#F3C46B]">از کجا آمد ←</span></span>
          <span className="text-[2.375rem] font-extrabold leading-tight"><RollingNumber value={p.todayTotal} flash={ON_DARK} /></span>
          <span className="flex flex-wrap gap-2 text-sm text-[#E1E9F3]">
            <span className="rounded-full bg-white/10 px-3 py-1">{fmtNum(p.todayCount)} فروش</span>
            <span className="rounded-full bg-white/10 px-3 py-1">نقد {fmtMoney(p.todayCash)}</span>
          </span>
        </button>
      </Shell>
    )
  }

  // month
  const loss = p.monthNet < 0
  const yearLoss = p.yearNet < 0
  const top = Math.max(p.yearProfit, p.yearExpenses, 1)
  const bar = (v: number) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`
  const facts: string[] = []
  // وقتی هشدار هست، متنش خودش «بیشترین مصرف» را می‌گوید؛ جملهٔ جدا نمی‌آید تا حرف دوبار نیاید
  if (!p.alert && p.topCategory) facts.push(`بزرگ‌ترین مصرف این ماه «${p.topCategory.name}» است (${fmtMoney(p.topCategory.amount)}).`)
  if (p.pendingExpenses > 0) facts.push(`${fmtNum(p.pendingExpenses)} روز مصرف ثبت نشده.`)
  // فقط یک قاعدهٔ اپ را می‌گوید، نه حدس دربارهٔ دلیل عدد این ماه
  if (p.topCategory?.name === 'کسر صندوق' && p.pendingExpenses > 0) facts.push('مصرفی که ثبت نشود، هنگام شمارش نقد «کسر صندوق» دیده می‌شود.')
  return (
    <Shell tag="امسال تا امروز · از ۱ حمل">
      <button
        type="button"
        aria-label={`مفاد خالص امسال ${fmtMoney(p.yearNet)} — از کجا آمد`}
        onClick={p.onOpenYear}
        className="flex flex-col gap-3.5 text-right"
      >
        <span className="text-[1.9375rem] font-extrabold leading-snug">
          <span className={yearLoss ? 'text-[#FFB0A3]' : 'text-[#7FD8B0]'}>{yearLoss ? '▼' : '▲'} <RollingNumber value={Math.abs(p.yearNet)} flash={ON_DARK} /></span>{' '}{yearLoss ? 'زیان' : 'مفاد'}
        </span>
        <span className="flex flex-col gap-2.5">
          <span className="flex flex-col gap-1.5">
            <span className="flex justify-between text-sm text-[#DCE3F3]"><span>مفاد فروش امسال</span><b>{fmtMoney(p.yearProfit)}</b></span>
            <span className="block h-2.5 rounded-full bg-white/10"><span className="block h-2.5 rounded-full bg-[#7FD8B0]" style={{ width: bar(p.yearProfit) }} /></span>
          </span>
          <span className="flex flex-col gap-1.5">
            <span className="flex justify-between text-sm text-[#DCE3F3]"><span>مصرف امسال</span><b>{fmtMoney(p.yearExpenses)}</b></span>
            <span className="block h-2.5 rounded-full bg-white/10"><span className="block h-2.5 rounded-full bg-[#FF9C8C]" style={{ width: bar(p.yearExpenses) }} /></span>
          </span>
        </span>
      </button>
      <button
        type="button"
        ref={p.monthRef}
        aria-label={`مفاد خالص این ماه ${fmtMoney(p.monthNet)} — از کجا آمد`}
        onClick={p.onOpenMonth}
        className="flex flex-col gap-3 border-t border-white/15 pt-3.5 text-right"
      >
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[0.9375rem] font-bold text-[#DCE3F3]">این ماه تا امروز</span>
          <span className="text-xl font-extrabold">
            <span className={loss ? 'text-[#FFB0A3]' : 'text-[#7FD8B0]'}>{loss ? '▼' : '▲'} <RollingNumber value={Math.abs(p.monthNet)} flash={ON_DARK} /></span>{' '}{loss ? 'زیان' : 'مفاد'}
          </span>
        </span>
        <span className="text-sm text-[#DCE3F3]">مفاد فروش {fmtMoney(p.monthProfit)} · مصرف {fmtMoney(p.monthExpenses)}</span>
        {p.alert && (
          <span className="block rounded-2xl bg-white/10 px-3.5 py-3 text-[0.9375rem] leading-8 text-[#DCE3F3]">
            <b className={`block ${p.alert.level === 'danger' ? 'text-[#FFB0A3]' : 'text-[#F3C46B]'}`}>{p.alert.level === 'danger' ? 'مصرف این ماه از مفاد بیشتر شده' : 'مصرف این ماه بالا رفته'}</b>
            {p.alert.text}
          </span>
        )}
        {facts.length > 0 && <span className="text-[0.9375rem] leading-8 text-[#DCE3F3]">{facts.join(' ')}</span>}
        <span className={`text-sm font-bold ${p.monthChange >= 0 ? 'text-[#7FD8B0]' : 'text-[#FFB0A3]'}`}>
          {p.monthChange >= 0 ? '▲' : '▼'} {fmtMoney(Math.abs(p.monthChange))} {p.monthChange >= 0 ? 'بیشتر' : 'کمتر'} از همین وقت ماه گذشته
        </span>
        {p.target > 0 && (
          <span aria-label="هدف ماه" className="block">
            <span className="block h-2.5 rounded-full bg-white/10"><span className="block h-2.5 rounded-full bg-[#E0A43A]" style={{ width: `${Math.min(100, p.targetPct)}%` }} /></span>
            <span className="mt-1 block text-xs text-[#DCE3F3]">هدف {fmtMoney(p.target)} — {fmtNum(p.targetPct)}٪ رسیده · {fmtNum(p.daysLeft)} روز مانده</span>
            {p.reached && <span className="target-reached">🎉 هدف این ماه رسید</span>}
          </span>
        )}
      </button>
      {p.canAct && (
        <div className="flex gap-2.5">
          {p.pendingExpenses > 0
            ? <button type="button" onClick={() => p.goTo('expenses')} className={GOLD}>ثبت مصرف {fmtNum(p.pendingExpenses)} روز</button>
            : <button type="button" onClick={p.onOpenMonth} className={GOLD}>مصارف این ماه</button>}
          {p.pendingExpenses > 0 && <button type="button" onClick={p.onOpenMonth} className={GHOST}>مصارف ماه</button>}
        </div>
      )}
    </Shell>
  )
}

export interface PromptProps {
  kind: 'morning' | 'evening'
  cash: number
  /** امروز هنوز فروشی نشده؟ — «پیش از اولین فروش» فقط وقتی راست است */
  noSalesYet: boolean
  yesterdayPending: boolean
  onCount: () => void
  onSkip: () => void
  onCloseDay: () => void
  onOpenSales: () => void
  onYesterday: () => void
}

const PROMPT_GOLD = 'flex-1 min-h-[52px] rounded-2xl bg-[#E0A43A] px-4 text-base font-extrabold text-[#151A28]'
const PROMPT_GHOST = 'min-h-[52px] rounded-2xl border border-slate-300 px-4 text-[0.9375rem] font-bold text-slate-800'

/** کارت صبح/شام: خبر، دلیلش (عدد صندوق در اپ) و یک دکمه. */
export function TimePrompt(p: PromptProps) {
  const morning = p.kind === 'morning'
  return (
    <section aria-label="پیام این ساعت" className="mb-4 rounded-[22px] border-2 border-[#E0A43A] bg-white p-4">
      <span className="rounded-full bg-[#E0A43A]/20 px-3 py-1 text-[0.8125rem] font-extrabold text-amber-800">{morning ? 'صبح' : 'شام'}</span>
      <p className="mt-2 text-[1.625rem] font-extrabold leading-snug text-slate-900">{morning ? 'صبح بخیر' : 'روز را ببندید'}</p>
      <p className="mt-1 text-base leading-8 text-slate-700">
        {morning
          ? <>{p.noSalesYet ? 'پیش از اولین فروش، صندوق را بشمارید.' : 'صندوق را بشمارید.'} در اپ باید <b className="text-slate-900">{fmtMoney(p.cash)}</b> باشد.</>
          : <>خلاصهٔ امروز را ببینید و روز را ببندید. صندوق در اپ حالا <b className="text-slate-900">{fmtMoney(p.cash)}</b> است.</>}
      </p>
      <div className="mt-3 flex gap-2.5">
        {morning ? (
          <>
            <button type="button" onClick={p.onCount} className={PROMPT_GOLD}>شمارش صندوق</button>
            {p.yesterdayPending && <button type="button" onClick={p.onYesterday} className={PROMPT_GHOST}>خلاصهٔ دیروز</button>}
            <button type="button" onClick={p.onSkip} className={PROMPT_GHOST}>بعداً</button>
          </>
        ) : (
          <>
            <button type="button" onClick={p.onCloseDay} className={PROMPT_GOLD}>بستن روز</button>
            <button type="button" onClick={p.onOpenSales} className={PROMPT_GHOST}>خلاصهٔ امروز</button>
          </>
        )}
      </div>
    </section>
  )
}
