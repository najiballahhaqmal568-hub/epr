import { accessFlags, type Sale } from '../../db'
import { salePairs, saleCustomerCredit } from '../../lib/salesFigures'
import { commercialSaleLines } from '../../lib/commercialLines'
import { fmtClock, fmtMoney, fmtNum } from '../../lib/format'

/** «فروش‌های آخر» — سه فروش آخرِ امروز؛ با یک لمس سندش (رسید، مرجوعی، تبادله) باز می‌شود. */
export default function RecentSales({ sales, goTo }: { sales: Sale[]; goTo: (target: string) => void }) {
  const rows = [...sales].sort((a, b) => b.date - a.date).slice(0, 3)
  return (
    <section aria-label="فروش‌های آخر" className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-slate-800">فروش‌های آخر</h2>
        <button type="button" onClick={() => goTo('sales')} className="min-h-[44px] px-1 text-sm font-bold text-[var(--action)]">همهٔ فروش‌ها ‹</button>
      </div>
      {rows.length === 0 ? (
        <p className="surface p-4 text-sm text-slate-600">امروز هنوز فروشی ثبت نشده.</p>
      ) : (
        <div className="surface overflow-hidden">
          {rows.map((sale) => {
            const lines = commercialSaleLines(sale)
            const pairs = salePairs(sale)
            const first = lines[0]
            const more = lines.length > 1 ? ` و ${fmtNum(lines.length - 1)} جنس دیگر` : ''
            const credit = saleCustomerCredit(sale)
            const name = sale.customerName || 'مشتری نقدی'
            return (
              <button
                key={sale.id}
                type="button"
                disabled={sale.id === undefined}
                aria-label={`جزئیات فروش ${name} ${fmtMoney(sale.total)}`}
                onClick={() => goTo(`sale:${sale.id}`)}
                className="flex min-h-[68px] w-full items-center gap-3 border-b border-slate-100 px-3.5 py-3 text-right last:border-b-0"
              >
                <span className="w-14 shrink-0 rounded-xl bg-slate-100 py-1.5 text-center text-[0.8125rem] font-extrabold text-slate-700">{fmtClock(sale.date)}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[0.9375rem] font-bold text-slate-800">{name}</span>
                  <span className="truncate text-[0.8125rem] text-slate-500">{fmtNum(pairs)} جوړه{first ? ` · ${first.productName}${more}` : ''}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="text-base font-extrabold text-slate-900">{fmtMoney(sale.total)}</span>
                  {credit > 0 && <span className="text-xs font-bold text-red-700">قرض {fmtMoney(credit)}</span>}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {rows.length > 0 && (
        <p className="mt-2 text-[0.8125rem] text-slate-500">{accessFlags.readOnly ? 'روی هر فروش بزنید تا سندش باز شود.' : 'روی هر فروش بزنید: رسید، مرجوعی یا تبادله.'}</p>
      )}
    </section>
  )
}
