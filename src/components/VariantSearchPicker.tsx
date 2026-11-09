import { useState } from 'react'
import { bestMatches } from '../lib/search'
import { fmtNum } from '../lib/format'
import { inputCls } from './ui'

export interface VariantPickOption {
  variantId: number
  productName: string
  size: string
  color: string
  stockQty?: number
}

/**
 * انتخاب مدل، سایز و رنگ با جستجو — به جای لیست درازِ «انتخاب کنید...».
 * جستجو از همان bestMatches می‌گذرد که میز فروش و خرید استفاده می‌کنند.
 * تا وقتی جنسی انتخاب نشده، value خالی ('') است؛ با «تغییر» دوباره خالی می‌شود.
 */
export default function VariantSearchPicker<T extends VariantPickOption>({
  options,
  value,
  onChange,
  showStock = false
}: {
  options: T[] | undefined
  value: number | ''
  onChange: (variantId: number | '') => void
  showStock?: boolean
}) {
  const [search, setSearch] = useState('')
  const selected = value === '' ? undefined : options?.find((o) => o.variantId === value)
  const label = (o: VariantPickOption) => `${o.productName} — سایز ${o.size} — ${o.color}`

  if (selected) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm">
        <span className="font-bold text-emerald-900">
          {label(selected)}
          {showStock && selected.stockQty !== undefined && (
            <span className="font-normal text-slate-600"> — موجودی {fmtNum(selected.stockQty)}</span>
          )}
        </span>
        <button
          type="button"
          aria-label="تغییر جنس"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-700"
          onClick={() => {
            onChange('')
            setSearch('')
          }}
        >
          تغییر
        </button>
      </div>
    )
  }

  const matches = options ? bestMatches(options, search, (o) => `${o.productName} ${o.size} ${o.color}`) : []

  return (
    <div>
      <input
        className={inputCls}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="نام بوت، سایز یا رنگ را بنویسید..."
        aria-label="جستجوی مدل، سایز و رنگ"
      />
      {search.trim() !== '' &&
        (matches.length > 0 ? (
          <div className="mt-2 max-h-72 overflow-y-auto rounded-xl border border-slate-200">
            {matches.map((o) => (
              <button
                key={o.variantId}
                type="button"
                className="block w-full border-b border-slate-100 p-3 text-right text-sm last:border-b-0 active:bg-slate-100"
                onClick={() => {
                  onChange(o.variantId)
                  setSearch('')
                }}
              >
                <span className="font-bold">{o.productName}</span>
                <span className="text-slate-600">
                  {' '}— سایز {o.size} — {o.color}
                  {showStock && o.stockQty !== undefined && ` — موجودی ${fmtNum(o.stockQty)}`}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">چیزی پیدا نشد. نام را کوتاه‌تر بنویسید.</p>
        ))}
    </div>
  )
}
