import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum } from '../../lib/format'
import { SALE_TIMINGS_KEY, speedSummary, type SaleTiming } from '../../lib/saleSpeed'

/** Seconds and taps per sale on this phone — this week against last week. */
export default function SaleSpeedCard() {
  const timings = useLiveQuery(async () => ((await db.settings.get(SALE_TIMINGS_KEY))?.value as SaleTiming[] | undefined) ?? [], [])
  if (!timings?.length) return null
  const { thisWeek, lastWeek } = speedSummary(timings)
  if (!thisWeek.count) return null
  const faster = lastWeek.count ? lastWeek.seconds - thisWeek.seconds : 0
  return (
    <section aria-label="سرعت فروش" className="surface mb-3 p-4 text-sm">
      <p className="font-bold">سرعت فروش (همین موبایل)</p>
      <p className="mt-1">
        این هفته: هر فروش حدود <b>{fmtNum(thisWeek.seconds)} ثانیه</b> و <b>{fmtNum(thisWeek.taps)} لمس</b> · {fmtNum(thisWeek.count)} فروش
      </p>
      {lastWeek.count > 0 && <p className="mt-1 text-slate-600">
        هفتهٔ گذشته: {fmtNum(lastWeek.seconds)} ثانیه و {fmtNum(lastWeek.taps)} لمس
        {faster !== 0 && <span className={faster > 0 ? 'font-bold text-teal-700' : 'font-bold text-red-700'}> — {fmtNum(Math.abs(faster))} ثانیه {faster > 0 ? 'تندتر' : 'کندتر'}</span>}
      </p>}
      <p className="explain-note">از اولین جوړه در سبد تا «ثبت فروش». میانه حساب می‌شود تا یک مشتری معطل عدد را خراب نکند.</p>
    </section>
  )
}
