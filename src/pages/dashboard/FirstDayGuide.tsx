import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum } from '../../lib/format'
import { firstDayDone, firstDaySteps } from '../../lib/firstDay'

const TEXT = {
  cash: { title: 'پول صندوق را بشمارید و بنویسید', hint: 'تا صندوق اپ با پول دست یکی باشد.', target: 'expenses', action: 'صندوق' },
  products: { title: 'بوت‌ها را با عکس اضافه کنید', hint: 'فروشنده بوت را از عکس زودتر پیدا می‌کند.', target: 'inventory', action: 'گدام' },
  debts: { title: 'قرض‌های قبلی را بنویسید', hint: 'قرض مشتریان و قرض ما به دیگران، از دفتر کاغذی.', target: 'accounts', action: 'حساب‌ها' }
} as const

/** Owner-only start checklist; disappears by itself when the three steps are done, or when dismissed. */
export default function FirstDayGuide({ goTo }: { goTo: (target: string) => void }) {
  const data = useLiveQuery(async () => {
    const [cashMoves, products, parties, sales, dismissed] = await Promise.all([
      db.cashMovements.count(),
      db.products.filter((p) => !p.deleted).toArray(),
      Promise.all([db.customers.count(), db.suppliers.count()]).then(([a, b]) => a + b),
      db.sales.count(),
      db.settings.get('firstDayDismissed')
    ])
    return { cashMoves, products: products.length, productsWithPhoto: products.filter((p) => p.photo).length, parties, sales, dismissed: Boolean(dismissed?.value) }
  }, [])
  if (!data || data.dismissed) return null
  const steps = firstDaySteps(data)
  if (firstDayDone(steps)) return null
  const left = steps.filter((s) => !s.done).length
  return (
    <section aria-label="شروع کار با اتل" className="first-day surface mb-4 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-bold">شروع کار با اتل</h2>
          <p className="text-sm text-slate-500">{fmtNum(left)} قدم مانده تا عددهای اپ درست شوند.</p>
        </div>
        <button className="customers-back" onClick={() => void db.settings.put({ key: 'firstDayDismissed', value: true })}>بستن راهنما</button>
      </div>
      <ol className="first-day-steps">
        {steps.map((step, i) => {
          const t = TEXT[step.id]
          return (
            <li key={step.id} data-done={step.done}>
              <span className="first-day-mark" aria-hidden="true">{step.done ? '✓' : fmtNum(i + 1)}</span>
              <span className="min-w-0 flex-1">
                <b>{t.title}</b>
                <small>{step.id === 'products' && data.products > 0 ? `${fmtNum(data.productsWithPhoto)} از ${fmtNum(data.products)} بوت عکس دارد.` : t.hint}</small>
              </span>
              {step.done ? <span className="sr-only">انجام شد</span> : <button className="party-action" onClick={() => goTo(t.target)}>{t.action}</button>}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
