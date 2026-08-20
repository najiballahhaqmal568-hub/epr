import { fmtNum } from '../lib/format'

/**
 * نمودارهای ساده با نوار — بدون کتابخانهٔ خارجی.
 * روی موبایل و در راست‌به‌چپ خوانا است و هر نوار عدد خودش را هم می‌نویسد.
 */

const TONES = {
  teal: 'bg-teal-600',
  amber: 'bg-amber-500',
  purple: 'bg-purple-600',
  red: 'bg-red-500',
  slate: 'bg-slate-400'
} as const

export type Tone = keyof typeof TONES

/** یک نوار افقی با عنوان بالا و عدد کنارش */
export function BarRow({
  label,
  sub,
  value,
  max,
  tone = 'teal',
  right
}: {
  label: string
  sub?: string
  value: number
  max: number
  tone?: Tone
  right?: string
}) {
  const pct = max > 0 ? Math.max(2, Math.min(100, (Math.abs(value) / max) * 100)) : 0
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{label}</span>
        <span className="shrink-0 text-sm font-bold text-slate-800">{right}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
        <div className={`h-full rounded-full ${TONES[value < 0 ? 'red' : tone]}`} style={{ width: `${pct}%` }} />
      </div>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  )
}

/** دو نوار روی هم برای مقایسهٔ دو چیز (عمده/پرچون) با فیصدی */
export function SplitBar({
  a,
  b,
  labelA,
  labelB,
  fmt
}: {
  a: number
  b: number
  labelA: string
  labelB: string
  fmt: (n: number) => string
}) {
  const total = Math.abs(a) + Math.abs(b)
  const pctA = total > 0 ? Math.round((Math.abs(a) / total) * 100) : 0
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-bold text-teal-700">
          {labelA} <span className="text-xs font-normal text-slate-400">{fmtNum(pctA)}٪</span>
        </span>
        <span className="font-bold text-amber-600">
          <span className="text-xs font-normal text-slate-400">{fmtNum(100 - pctA)}٪</span> {labelB}
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div className="h-full bg-teal-600" style={{ width: `${pctA}%` }} />
        <div className="h-full bg-amber-500" style={{ width: `${100 - pctA}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-sm font-bold">
        <span className="text-teal-700">{fmt(a)}</span>
        <span className="text-amber-600">{fmt(b)}</span>
      </div>
    </div>
  )
}

/** ستون‌های عمودی کوچک — برای ماه‌به‌ماه */
export function ColumnChart({
  rows,
  fmt,
  compact = false
}: {
  rows: { label: string; value: number; second?: number }[]
  fmt: (n: number) => string
  compact?: boolean
}) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.value, r.second ?? 0)))
  return (
    <div className={compact ? 'overflow-hidden' : 'overflow-x-auto'}>
      <div className="flex min-w-full items-end gap-1.5" style={{ height: 120 }}>
        {rows.map((r) => (
          <div key={r.label} className="flex min-w-[38px] flex-1 flex-col items-center justify-end gap-0.5">
            <span className="text-[10px] text-slate-400">{fmt(r.value)}</span>
            <div className="flex w-full items-end justify-center gap-0.5" style={{ height: 70 }}>
              <div
                className="w-2.5 rounded-t bg-teal-600"
                style={{ height: `${Math.max(2, (r.value / max) * 100)}%` }}
                title="فروش"
              />
              {r.second !== undefined && (
                <div
                  className={`w-2.5 rounded-t ${r.second < 0 ? 'bg-red-500' : 'bg-purple-500'}`}
                  style={{ height: `${Math.max(2, (Math.abs(r.second) / max) * 100)}%` }}
                  title="مفاد"
                />
              )}
            </div>
            <span className="truncate text-[10px] text-slate-500">{r.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-teal-600" /> فروش
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm bg-purple-500" /> مفاد
        </span>
      </div>
    </div>
  )
}

/** تغییر نسبت به دورهٔ گذشته — فلش سبز/سرخ */
export function ChangeChip({ pct, goodWhenUp = true }: { pct: number | null; goodWhenUp?: boolean }) {
  if (pct === null) return <span className="text-xs text-slate-400">—</span>
  const up = pct >= 0
  const good = up === goodWhenUp
  return (
    <span className={`text-xs font-bold ${Math.abs(pct) < 0.5 ? 'text-slate-400' : good ? 'text-teal-700' : 'text-red-600'}`}>
      {up ? '↑' : '↓'} {fmtNum(Math.abs(Math.round(pct)))}٪
    </span>
  )
}
