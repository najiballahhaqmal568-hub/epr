import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { summarizeSales } from '../../lib/salesFigures'
import { Modal, PrimaryBtn, Skeleton } from '../../components/ui'
import { addCalendarDays, fmtDateShort, fmtMoney, fmtNum } from '../../lib/format'
import { explainCash } from '../../lib/numberSources'
import { confirmedSales, profitSummary } from '../../lib/profit'
import { ordinaryCustomerCollections } from '../../lib/directTradeReports'
import { haptic, reducedMotion } from '../../lib/feedback'

/** «بستن روز» — یک نگاه شبانه: فروش، مفاد، مصرف، مفاد خالص، قرض و صندوق. هیچ عددی نمی‌نویسد. */
export default function DailyCloseModal({ day, readyTradeUuids, readyReceiptUuids, onClose, onClosed }: {
  day: number; readyTradeUuids: ReadonlySet<string>; readyReceiptUuids: ReadonlySet<string>; onClose: () => void; onClosed: () => void
}) {
  const end = addCalendarDays(day, 1)
  const [stamped, setStamped] = useState(false)
  function close() {
    if (stamped) return
    setStamped(true)
    haptic('success')
    // the stamp is the whole point of the moment; it lasts under a second and Escape still closes
    setTimeout(onClosed, reducedMotion() ? 0 : 750)
  }
  const data = useLiveQuery(async () => {
    const [sales, returns, expenses, payments, variants, movements] = await Promise.all([
      db.sales.where('date').between(day, end, true, false).toArray(),
      db.returns.where('date').between(day, end, true, false).toArray(),
      db.expenses.where('date').between(day, end, true, false).toArray(),
      db.payments.where('date').between(day, end, true, false).toArray(),
      db.variants.toArray(),
      db.cashMovements.toArray()
    ])
    return { sales, returns, expenses, payments, variants, movements }
  }, [day, end])
  if (!data) return <Modal title="بستن روز" onClose={onClose}><Skeleton rows={5} /></Modal>
  const summary = profitSummary({ ...data, readyTradeUuids, readyReceiptUuids })
  const sales = confirmedSales(data.sales, readyTradeUuids, readyReceiptUuids)
  const credit = summarizeSales(sales).credit
  // فقط پول دریافت‌شده؛ «قرض قبلی» مبلغ منفی است و اینجا شمرده نمی‌شود
  const collected = ordinaryCustomerCollections(data.payments.filter(p => !p.deleted && p.amount > 0))
  const cash = explainCash(data.movements)
  return <Modal title={`بستن روز — ${fmtDateShort(day)}`} onClose={onClose}>
    {stamped && <p className="day-stamp" role="status">روز بسته شد ✓</p>}
    <section aria-label="خلاصهٔ روز" className="receipt-reveal rounded-xl bg-slate-50 p-3 text-sm">
      <p className="flex justify-between py-0.5"><span>فروش ({fmtNum(sales.length)})</span><b>{fmtMoney(summary.salesTotal)}</b></p>
      <p className="flex justify-between py-0.5"><span>مفاد فروش</span><span>{fmtMoney(summary.grossProfit)}</span></p>
      <p className="flex justify-between py-0.5"><span>مصارف تجارت</span><span>−{fmtMoney(summary.businessExpenses)}</span></p>
      <p className={`mt-1 flex justify-between border-t border-slate-200 pt-1.5 font-bold ${summary.netProfit >= 0 ? 'text-teal-700' : 'text-red-700'}`}><span>مفاد خالص امروز</span><span>{fmtMoney(summary.netProfit)}</span></p>
    </section>
    <section aria-label="قرض امروز" className="receipt-reveal mt-3 rounded-xl border border-slate-200 p-3 text-sm">
      <p className="flex justify-between py-0.5"><span>قرض تازه به مشتریان</span><span className={credit > 0 ? 'font-bold text-red-700' : ''}>{fmtMoney(credit)}</span></p>
      <p className="flex justify-between py-0.5"><span>پول گرفته‌شده از قرضداران</span><span className="font-bold text-teal-700">{fmtMoney(collected)}</span></p>
    </section>
    <section aria-label="صندوق حالا" className="mt-3">
      <p className="mb-1 font-bold">پول حالا — {fmtMoney(cash.total)}</p>
      <div className="explain-rows receipt-reveal">{cash.rows.map(row => <div key={row.key} className="explain-row"><span>{row.label}</span><span className="explain-amount">{fmtMoney(row.amount)}</span></div>)}</div>
      <p className="explain-note">پول دست را بشمارید؛ اگر با «دکان» یکی نیست، از صندوق «شمارش نقد» را بزنید.</p>
    </section>
    <div className="mt-4"><PrimaryBtn onClick={close} disabled={stamped}>دیدم — روز بسته شد</PrimaryBtn></div>
  </Modal>
}
