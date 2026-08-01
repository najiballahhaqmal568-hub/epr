import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Variant } from '../../db'
import { applyStocktake, type StocktakeResult } from '../../lib/ops'
import { fmtNum, fmtMoney, parseNum, toLatinDigits } from '../../lib/format'
import { Modal, inputCls, PrimaryBtn } from '../../components/ui'
import { periodBounds } from '../../lib/period'
import { soldVariantIds } from '../../lib/sold'

/** دامنهٔ شمارش: همه، یا فقط اجناسی که در دوره حرکت کرده‌اند */
type Scope = 'all' | 'thisMonth' | 'lastMonth'

const SCOPES: { id: Scope; label: string }[] = [
  { id: 'lastMonth', label: 'فروخته‌شدهٔ ماه گذشته' },
  { id: 'thisMonth', label: 'فروخته‌شدهٔ این ماه' },
  { id: 'all', label: 'همهٔ گدام' }
]

export function StocktakeModal({ onClose }: { onClose: () => void }) {
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [filter, setFilter] = useState('')
  const [scope, setScope] = useState<Scope>('lastMonth')
  const [phase, setPhase] = useState<'counting' | 'confirm' | 'done'>('counting')
  const [result, setResult] = useState<StocktakeResult | null>(null)

  const products = useLiveQuery(() => db.products.orderBy('name').filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])

  // اجناسی که در دوره حرکت کرده‌اند — فقط همین‌ها نیاز به شمارش دوباره دارند
  const { from, to } = periodBounds(scope === 'thisMonth' ? 'month' : 'prevMonth')
  const moved = useLiveQuery(async () => {
    if (scope === 'all') return null
    const [sales, returns] = await Promise.all([
      db.sales.where('date').between(from, to, true, true).toArray(),
      db.returns.where('date').between(from, to, true, true).toArray()
    ])
    return soldVariantIds(sales, returns)
  }, [scope, from, to])

  const inScope = (v: Variant) => scope === 'all' || !moved || moved.has(v.id!)

  const byProduct = new Map<number, Variant[]>()
  variants?.filter(inScope).forEach((v) => {
    const list = byProduct.get(v.productId) ?? []
    list.push(v)
    byProduct.set(v.productId, list)
  })

  const visible = (products ?? [])
    .filter((p) => byProduct.has(p.id!))
    .filter((p) => !filter || p.name.includes(filter) || (p.brand ?? '').includes(filter))
  const total = variants?.filter(inScope).length ?? 0
  const skipped = (variants?.length ?? 0) - total
  const countedEntries = Object.entries(counts).filter(([, val]) => toLatinDigits(val).trim() !== '')
  const countedNum = countedEntries.length

  const diffs = countedEntries
    .map(([id, val]) => {
      const v = variants?.find((x) => x.id === Number(id))
      if (!v) return null
      const counted = parseNum(val)
      return { v, counted, diff: counted - v.stockQty }
    })
    .filter((x): x is { v: Variant; counted: number; diff: number } => x !== null)
  const changed = diffs.filter((d) => d.diff !== 0)
  const valueDiff = changed.reduce((s, d) => s + d.diff * d.v.purchasePrice, 0)
  const productName = (v: Variant) => products?.find((p) => p.id === v.productId)?.name ?? ''

  async function apply() {
    const r = await applyStocktake(diffs.map((d) => ({ variantId: d.v.id!, counted: d.counted })))
    setResult(r)
    setPhase('done')
  }

  return (
    <Modal title="شمارش فزیکی گدام" onClose={onClose}>
      {phase === 'counting' && (
        <>
          <p className="mb-2 text-sm text-slate-500">
            هر جنس را بشمارید و تعداد واقعی را بنویسید. اجناسی که خالی بمانند تغییری نمی‌کنند.
          </p>
          <div className="mb-2 flex gap-1 overflow-x-auto pb-1">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1 text-sm font-bold ${
                  scope === s.id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          {scope !== 'all' && (
            <p className="mb-2 rounded-xl bg-teal-50 p-2.5 text-xs text-teal-900">
              فقط اجناسی که در این دوره فروخته شده نشان داده می‌شود — {fmtNum(skipped)} سایز دیگر حرکت نکرده و لازم نیست
              دوباره شمرده شود.
            </p>
          )}
          <input className={inputCls} placeholder="فلتر نام یا برند..." value={filter} onChange={(e) => setFilter(e.target.value)} />
          <p className="my-2 text-sm font-bold text-teal-700">
            {fmtNum(countedNum)} از {fmtNum(total)} شمارش شده
          </p>
          {total === 0 && (
            <p className="mb-3 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
              در این دوره چیزی فروخته نشده — چیزی برای شمارش نیست.
            </p>
          )}
          {visible.map((p) => (
            <div key={p.id} className="mb-3">
              <p className="mb-1 font-bold text-slate-700">
                {p.name} {p.brand && <span className="text-sm font-normal text-slate-400">({p.brand})</span>}
              </p>
              {(byProduct.get(p.id!) ?? []).map((v) => (
                <div key={v.id} className="mb-1 flex items-center gap-2 rounded-lg bg-slate-50 p-2">
                  <span className="flex-1 text-sm">
                    {v.size} {v.color}
                    <span className="mr-2 text-xs text-slate-400">در اپ: {fmtNum(v.stockQty)}</span>
                  </span>
                  <input
                    className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-center"
                    inputMode="numeric"
                    placeholder="شمار"
                    value={counts[v.id!] ?? ''}
                    onChange={(e) => setCounts((c) => ({ ...c, [v.id!]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          ))}
          <PrimaryBtn onClick={() => setPhase('confirm')} disabled={countedNum === 0}>
            ادامه ({fmtNum(countedNum)} جنس)
          </PrimaryBtn>
        </>
      )}

      {phase === 'confirm' && (
        <>
          <p className="mb-3 font-bold text-slate-700">نتیجهٔ شمارش — قبل از ثبت بررسی کنید:</p>
          <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between py-1">
              <span>برابر با اپ</span>
              <span className="font-bold text-teal-700">{fmtNum(diffs.length - changed.length)} جنس</span>
            </div>
            <div className="flex justify-between py-1">
              <span>دارای تفاوت</span>
              <span className="font-bold text-red-600">{fmtNum(changed.length)} جنس</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-1">
              <span>تفاوت ارزش (به قیمت خرید)</span>
              <span className={`font-bold ${valueDiff < 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(valueDiff)}</span>
            </div>
          </div>
          {changed.map((d) => (
            <div key={d.v.id} className="mb-1 flex justify-between rounded-lg bg-red-50 p-2 text-sm">
              <span>
                {productName(d.v)} {d.v.size} {d.v.color}
              </span>
              <span className="font-bold">
                {fmtNum(d.v.stockQty)} ← {fmtNum(d.counted)} ({d.diff > 0 ? '+' : ''}
                {fmtNum(d.diff)})
              </span>
            </div>
          ))}
          {changed.length === 0 && <p className="mb-3 text-teal-700">✅ همه چیز برابر است — چیزی تغییر نمی‌کند.</p>}
          <div className="mt-3 flex gap-2">
            <button onClick={() => setPhase('counting')} className="flex-1 rounded-xl bg-slate-100 py-3 font-bold text-slate-700">
              برگشت
            </button>
            <button onClick={apply} className="flex-1 rounded-xl bg-teal-700 py-3 font-bold text-white">
              ثبت شمارش
            </button>
          </div>
        </>
      )}

      {phase === 'done' && result && (
        <div className="py-6 text-center">
          <p className="mb-2 text-4xl">✅</p>
          <p className="mb-4 text-lg font-bold text-slate-800">شمارش تمام شد</p>
          <div className="mx-auto max-w-xs rounded-xl bg-slate-50 p-3 text-right text-sm">
            <div className="flex justify-between py-1">
              <span>برابر</span>
              <span className="font-bold text-teal-700">{fmtNum(result.matched)} جنس</span>
            </div>
            <div className="flex justify-between py-1">
              <span>اصلاح شد</span>
              <span className="font-bold text-red-600">{fmtNum(result.fixed)} جنس</span>
            </div>
            <div className="flex justify-between border-t border-slate-200 py-1">
              <span>تفاوت ارزش</span>
              <span className={`font-bold ${result.valueDiff < 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(result.valueDiff)}</span>
            </div>
          </div>
          <p className="mt-3 text-xs text-slate-400">اصلاحات در تاریخچهٔ تعدیل هر جنس با یادداشت «شمارش گدام» ثبت شد.</p>
          <button onClick={onClose} className="mt-4 w-full rounded-xl bg-teal-700 py-3 font-bold text-white">
            بستن
          </button>
        </div>
      )}
    </Modal>
  )
}

export default StocktakeModal
