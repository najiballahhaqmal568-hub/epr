import { useState } from 'react'
import type { ReturnDoc, Sale } from '../db'
import { fmtNum, fmtMoney, jalaliMonth } from '../lib/format'
import { Card } from './ui'
import { BarRow, SplitBar, ColumnChart, ChangeChip } from './charts'
import { retailVsWholesale, byModel, byCustomer, byMonth, changePct, type Totals } from '../lib/analytics'

const money0 = (n: number) => (Math.abs(n) >= 1000 ? `${fmtNum(Math.round(n / 1000))}هـ` : fmtNum(Math.round(n)))

/** مقایسهٔ عمده و پرچون — فروش، مفاد و فیصدی مفاد */
export function RetailWholesaleCard({ sales, returns }: { sales: Sale[]; returns: ReturnDoc[] }) {
  const { retail, wholesale } = retailVsWholesale(sales, returns)
  if (retail.sales === 0 && wholesale.sales === 0) return null

  const row = (label: string, t: Totals, tone: 'teal' | 'amber') => (
    <div className={`rounded-xl p-2.5 ${tone === 'teal' ? 'bg-teal-50' : 'bg-amber-50'}`}>
      <p className={`text-sm font-bold ${tone === 'teal' ? 'text-teal-800' : 'text-amber-800'}`}>{label}</p>
      <p className="text-xs text-slate-500">
        {fmtNum(t.pairs)} جوړه · {fmtNum(t.count)} فروش
      </p>
      <p className="mt-1 text-sm">
        <span className="text-slate-500">مفاد فی ۱۰۰ ؋: </span>
        <span className="font-bold text-slate-800">{fmtNum(Math.round(t.margin))} ؋</span>
      </p>
    </div>
  )

  return (
    <Card>
      <p className="mb-3 font-bold text-slate-700">⚖️ عمده در مقابل پرچون</p>

      <p className="mb-1 text-sm text-slate-500">فروش</p>
      <SplitBar a={retail.sales} b={wholesale.sales} labelA="پرچون" labelB="عمده" fmt={fmtMoney} />

      <p className="mb-1 text-sm text-slate-500">مفاد</p>
      <SplitBar a={retail.profit} b={wholesale.profit} labelA="پرچون" labelB="عمده" fmt={fmtMoney} />

      <div className="mt-3 grid grid-cols-2 gap-2">
        {row('پرچون', retail, 'teal')}
        {row('عمده', wholesale, 'amber')}
      </div>

      {retail.sales > 0 && wholesale.sales > 0 && (
        <p className="mt-2 rounded-xl bg-slate-50 p-2.5 text-xs text-slate-600">
          {retail.margin > wholesale.margin
            ? `پرچون فی ۱۰۰ افغانی ${fmtNum(Math.round(retail.margin - wholesale.margin))} افغانی بیشتر مفاد می‌دهد.`
            : `عمده فی ۱۰۰ افغانی ${fmtNum(Math.round(wholesale.margin - retail.margin))} افغانی بیشتر مفاد می‌دهد.`}
        </p>
      )}
    </Card>
  )
}

type ModelSort = 'profit' | 'pairs' | 'margin'

/** مقایسهٔ مدل‌ها با ترتیب قابل تغییر */
export function ModelsCard({ sales }: { sales: Sale[] }) {
  const [sort, setSort] = useState<ModelSort>('profit')
  const rows = byModel(sales)
  if (rows.length === 0) return null

  const sorted = [...rows].sort((a, b) => b[sort] - a[sort]).slice(0, 12)
  const max = Math.max(...sorted.map((r) => Math.abs(r[sort])), 1)

  const chip = (id: ModelSort, label: string) => (
    <button
      key={id}
      onClick={() => setSort(id)}
      className={`rounded-full px-3 py-1 text-xs font-bold ${sort === id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
    >
      {label}
    </button>
  )

  return (
    <Card>
      <p className="mb-2 font-bold text-slate-700">👞 مقایسهٔ مدل‌ها</p>
      <div className="mb-3 flex gap-2">
        {chip('profit', 'مفاد')}
        {chip('pairs', 'تعداد جوړه')}
        {chip('margin', 'فیصدی مفاد')}
      </div>
      {sorted.map((r) => (
        <BarRow
          key={r.name}
          label={r.name}
          value={r[sort]}
          max={max}
          tone={sort === 'margin' ? 'purple' : 'teal'}
          right={sort === 'pairs' ? `${fmtNum(r.pairs)} جوړه` : sort === 'margin' ? `${fmtNum(Math.round(r.margin))}٪` : fmtMoney(r.profit)}
          sub={`${fmtNum(r.pairs)} جوړه · فروش ${fmtMoney(r.sales)} · مفاد ${fmtMoney(r.profit)} (${fmtNum(Math.round(r.margin))}٪)`}
        />
      ))}
      {sort === 'margin' && (
        <p className="mt-2 rounded-xl bg-purple-50 p-2.5 text-xs text-purple-800">
          فیصدی مفاد یعنی از هر ۱۰۰ افغانی فروش چند افغانی مفاد می‌ماند. مدلی که زیاد می‌فروشد ولی فیصدی‌اش کم است، شاید
          کمتر از مدلی بیارزد که کم می‌فروشد ولی فیصدی‌اش بلند است.
        </p>
      )}
    </Card>
  )
}

/** مشتریان: خرید و مفاد هر کدام */
export function CustomersCard({ sales }: { sales: Sale[] }) {
  const [sort, setSort] = useState<'sales' | 'profit'>('sales')
  const rows = byCustomer(sales)
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => b[sort] - a[sort]).slice(0, 10)
  const max = Math.max(...sorted.map((r) => Math.abs(r[sort])), 1)

  return (
    <Card>
      <p className="mb-2 font-bold text-slate-700">⭐ مشتریان</p>
      <div className="mb-3 flex gap-2">
        <button
          onClick={() => setSort('sales')}
          className={`rounded-full px-3 py-1 text-xs font-bold ${sort === 'sales' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          مبلغ خرید
        </button>
        <button
          onClick={() => setSort('profit')}
          className={`rounded-full px-3 py-1 text-xs font-bold ${sort === 'profit' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          مفادی که داد
        </button>
      </div>
      {sorted.map((r) => (
        <BarRow
          key={r.name}
          label={`${r.name} ${r.kind === 'wholesale' ? '(عمده)' : '(پرچون)'}`}
          value={r[sort]}
          max={max}
          tone={r.kind === 'wholesale' ? 'amber' : 'teal'}
          right={fmtMoney(r[sort])}
          sub={`${fmtNum(r.pairs)} جوړه · مفاد ${fmtMoney(r.profit)} (${fmtNum(Math.round(r.margin))}٪)`}
        />
      ))}
    </Card>
  )
}

/** فروش و مفاد ماه‌به‌ماه */
export function MonthsCard({ sales }: { sales: Sale[] }) {
  const rows = byMonth(sales, jalaliMonth)
  if (rows.length < 2) return null
  return (
    <Card>
      <p className="mb-3 font-bold text-slate-700">📅 فروش و مفاد ماه‌به‌ماه</p>
      <ColumnChart rows={rows.map((r) => ({ label: r.label.split(' ')[0], value: r.sales, second: r.profit }))} fmt={money0} />
    </Card>
  )
}

/** مقایسهٔ دورهٔ فعلی با دورهٔ گذشته */
export function PeriodCompareCard({
  label,
  now,
  before,
  returnsNow = [],
  returnsBefore = []
}: {
  label: string
  now: Sale[]
  before: Sale[]
  returnsNow?: ReturnDoc[]
  returnsBefore?: ReturnDoc[]
}) {
  if (now.length === 0 && before.length === 0) return null
  const sum = (list: Sale[], rets: ReturnDoc[]) => {
    const a = retailVsWholesale(list, rets)
    return {
      sales: a.retail.sales + a.wholesale.sales,
      profit: a.retail.profit + a.wholesale.profit,
      pairs: a.retail.pairs + a.wholesale.pairs
    }
  }
  const n = sum(now, returnsNow)
  const b = sum(before, returnsBefore)
  const marginNow = n.sales > 0 ? (n.profit / n.sales) * 100 : 0
  const marginBefore = b.sales > 0 ? (b.profit / b.sales) * 100 : 0

  const line = (title: string, valNow: number, valBefore: number, fmt: (x: number) => string) => (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 last:border-0">
      <span className="text-sm text-slate-600">{title}</span>
      <span className="flex items-center gap-2">
        <span className="text-xs text-slate-400">{fmt(valBefore)}</span>
        <span className="text-sm font-bold text-slate-800">{fmt(valNow)}</span>
        <ChangeChip pct={changePct(valNow, valBefore)} />
      </span>
    </div>
  )

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-700">📈 مقایسه با {label}</p>
      <p className="mb-2 text-xs text-slate-400">عدد کوچک = {label}، عدد کلان = دورهٔ فعلی</p>
      {line('فروش', n.sales, b.sales, fmtMoney)}
      {line('مفاد', n.profit, b.profit, fmtMoney)}
      {line('جوړهٔ فروخته‌شده', n.pairs, b.pairs, (x) => fmtNum(Math.round(x)))}
      {line('فیصدی مفاد', marginNow, marginBefore, (x) => `${fmtNum(Math.round(x))}٪`)}
      {n.sales > b.sales && n.profit < b.profit && (
        <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs font-bold text-amber-800">
          ⚠️ فروش بالا رفته ولی مفاد پایین آمده — شاید زیر قیمت زیاد فروخته شده یا تخفیف زیاد داده‌اید.
        </p>
      )}
    </Card>
  )
}
