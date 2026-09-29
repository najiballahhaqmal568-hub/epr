import { RollingNumber } from '../../components/RollingNumber'
import { Skeleton } from '../../components/ui'
import { fmtMoney, fmtNum } from '../../lib/format'
import type { NetWorth } from '../../lib/networth'
import type { ExplainKind } from './ExplainModal'

/**
 * «پول شما کجاست» — نقد، طلب و قرض روی یک خط‌کش.
 * همهٔ نوارها با یک مقیاس کشیده می‌شوند (بزرگ‌ترین عدد)، پس یک نگاه نشان می‌دهد
 * طلب از مشتریان چند برابر نقد صندوق است. عددها از همان netWorth() می‌آیند که
 * راپورها و سال مالی هم می‌خوانند.
 */
interface Row {
  key: string
  name: string
  sub?: string
  value: number
  text?: string
  ink: string
  fill: string
  kind: ExplainKind
}

export default function MoneyMap({ worth, debtors, suppliers, lenders, onOpen }: {
  worth: NetWorth | undefined
  /** مشتری‌هایی که قرضدارند */
  debtors: number
  /** تأمین‌کننده و صرافی که به آن‌ها قرضداریم */
  suppliers: number
  /** اشخاصی که از آن‌ها قرض گرفته‌ایم */
  lenders: number
  onOpen: (kind: ExplainKind) => void
}) {
  if (!worth) {
    return (
      <section aria-label="پول شما کجاست" className="mb-4">
        <h2 className="mb-2 text-lg font-bold text-slate-800">پول شما کجاست</h2>
        <div className="surface p-4"><Skeleton rows={4} label="در حال خواندن حساب‌ها…" /></div>
      </section>
    )
  }
  const assets: Row[] = [
    { key: 'cash', name: 'صندوق', value: worth.cash, ink: 'text-slate-900', fill: 'bg-teal-600', kind: 'cash' },
    { key: 'receivables', name: 'طلب از مشتریان', sub: debtors > 0 ? `${fmtNum(debtors)} مشتری` : undefined, value: worth.receivables, ink: 'text-blue-700', fill: 'bg-blue-700', kind: 'receivables' },
    { key: 'stock', name: 'موجودی گدام', value: worth.pairs, text: `${fmtNum(worth.pairs)} جوړه`, ink: 'text-slate-900', fill: 'bg-slate-500', kind: 'stock' }
  ]
  const debts: Row[] = [
    { key: 'payables', name: 'قرض ما — تأمین‌کنندگان', sub: suppliers > 0 ? `${fmtNum(suppliers)} نفر` : undefined, value: worth.payables, ink: 'text-amber-700', fill: 'bg-amber-600', kind: 'payables' },
    { key: 'loans', name: 'قرض ما — اشخاص', sub: lenders > 0 ? `${fmtNum(lenders)} نفر` : undefined, value: worth.loans, ink: 'text-amber-700', fill: 'bg-amber-600', kind: 'loans' }
  ]
  // گدام به جوړه است، نه افغانی؛ روی خط‌کش پول نمی‌آید
  const scale = Math.max(worth.cash, worth.receivables, worth.payables, worth.loans, 1)
  const ratio = worth.cash > 0 && worth.receivables >= worth.cash * 3 ? Math.round(worth.receivables / worth.cash) : 0

  const line = (row: Row, bar: boolean) => (
    <button key={row.key} type="button" onClick={() => onOpen(row.kind)} aria-label={`${row.name} ${row.text ?? fmtMoney(row.value)} — از کجا آمد`} className="explain-card flex w-full flex-col gap-1.5 rounded-xl py-1 text-right">
      <span className="flex items-end justify-between gap-3">
        <span className="flex flex-col">
          <span className="text-[0.9375rem] font-bold text-slate-800">{row.name}</span>
          {row.sub && <span className="text-[0.8125rem] text-slate-500">{row.sub}</span>}
        </span>
        <span className={`whitespace-nowrap text-lg font-extrabold ${row.ink}`}>{row.text ?? <RollingNumber value={row.value} />}</span>
      </span>
      {bar && (
        <span className="block h-2 rounded-full bg-slate-100">
          <span className={`block h-2 rounded-full ${row.fill}`} style={{ width: `${Math.max(row.value > 0 ? 1 : 0, (row.value / scale) * 100)}%`, minWidth: row.value > 0 ? 4 : 0 }} />
        </span>
      )}
    </button>
  )

  return (
    <section aria-label="پول شما کجاست" className="mb-4">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-lg font-bold text-slate-800">پول شما کجاست</h2>
        <span className="text-[0.8125rem] text-slate-500">هر سطر را بزنید</span>
      </div>
      <div className="surface flex flex-col gap-3 p-4">
        <p className="text-[0.8125rem] font-extrabold text-slate-500">آنچه دارید</p>
        {assets.map((row) => line(row, row.key !== 'stock'))}
        <div className="h-px bg-slate-200" />
        <p className="text-[0.8125rem] font-extrabold text-slate-500">آنچه قرضدارید</p>
        {debts.map((row) => line(row, true))}
        {ratio > 1 && <p className="rounded-2xl bg-blue-50 px-3.5 py-3 text-sm leading-7 text-blue-900">طلب شما از مشتریان حدود <b>{fmtNum(ratio)} برابر</b> نقد صندوق است.</p>}
      </div>
    </section>
  )
}
