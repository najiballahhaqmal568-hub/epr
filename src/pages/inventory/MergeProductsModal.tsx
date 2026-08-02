import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Product } from '../../db'
import { fmtNum } from '../../lib/format'
import { Modal, PrimaryBtn, inputCls } from '../../components/ui'
import { findDuplicateGroups, mergeProducts, normalizeName } from '../../lib/merge'

/**
 * «یکجا کردن اجناس تکراری» — یک جنس که چند بار ثبت شده (کارتنی، جوړه‌ای، بوجی)
 * زیر یک نام می‌آید. مجموع جوړه هیچ تغییر نمی‌کند.
 */
export default function MergeProductsModal({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<{ key: string; keepId: number; withIds: number[] } | null>(null)
  const [manual, setManual] = useState(false)
  // انتخاب دستی چند جنس — تا وقتی «ادامه» نزده‌اند به صفحهٔ تأیید نمی‌رویم
  const [manualPicks, setManualPicks] = useState<number[]>([])
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const products = useLiveQuery(() => db.products.orderBy('name').filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  if (!products || !variants) return null

  const pairsOf = (id: number) => variants.filter((v) => v.productId === id).reduce((s, v) => s + v.stockQty, 0)
  const sizesOf = (id: number) => variants.filter((v) => v.productId === id).length
  const groups = findDuplicateGroups(products)

  const label = (p: Product) => (
    <span>
      <b>{p.name}</b>
      <span className="block text-xs text-slate-500">
        {fmtNum(pairsOf(p.id!))} جوړه · {fmtNum(sizesOf(p.id!))} سایز
        {p.brand ? ` · ${p.brand}` : ''}
      </span>
    </span>
  )

  async function doMerge() {
    if (!picked) return
    setBusy(true)
    setError('')
    try {
      const r = await mergeProducts(picked.keepId, picked.withIds)
      const kept = products!.find((p) => p.id === picked.keepId)
      setMsg(
        `✅ زیر «${kept?.name ?? ''}» یکجا شد — ${fmtNum(r.combined)} سایز جمع شد، ${fmtNum(r.moved)} سایز منتقل شد. ` +
          `مجموع جوړه: ${fmtNum(r.pairsBefore)} ← ${fmtNum(r.pairsAfter)}` +
          (r.pairsBefore === r.pairsAfter ? ' (بدون تغییر ✅)' : ' ⚠️')
      )
      setPicked(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  // انتخاب دستی: هر جنسی را با هر جنسی
  const manualList = products.filter((p) => {
    if (!search.trim()) return true
    return normalizeName(p.name).includes(normalizeName(search))
  })

  return (
    <Modal title="🔗 یکجا کردن اجناس تکراری" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-500">
        اگر یک جنس چند بار ثبت شده (یک بار کارتنی، یک بار جوړه‌ای، یک بار بوجی) این‌جا زیر یک نام می‌آید. بسته‌بندی هویت
        جنس نیست — موجودی همیشه به جوړه شمرده می‌شود. <b>مجموع جوړه و ارزش گدام تغییر نمی‌کند.</b>
      </p>

      {msg && <p className="mb-3 rounded-xl bg-teal-50 p-3 text-sm font-bold text-teal-800">{msg}</p>}
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">⚠️ {error}</p>}

      {picked ? (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">کدام نام بماند؟</p>
          {[picked.keepId, ...picked.withIds].map((id) => {
            const p = products.find((x) => x.id === id)
            if (!p) return null
            const keep = id === picked.keepId
            return (
              <button
                key={id}
                onClick={() =>
                  setPicked({
                    key: picked.key,
                    keepId: id,
                    withIds: [picked.keepId, ...picked.withIds].filter((x) => x !== id)
                  })
                }
                className={`mb-1 flex w-full items-center justify-between rounded-xl border-2 p-3 text-right ${
                  keep ? 'border-teal-600 bg-teal-50' : 'border-slate-200 bg-white'
                }`}
              >
                {label(p)}
                <span className="text-sm font-bold text-teal-700">{keep ? '✓ می‌ماند' : 'در آن ادغام شود'}</span>
              </button>
            )
          })}
          <p className="my-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            بعد از یکجا شدن، سایزهای یکسان جمع می‌شوند و نام‌های دیگر از گدام برداشته می‌شود. سوابق فروش و خرید محفوظ
            می‌ماند. مجموع جوړه:{' '}
            <b>{fmtNum([picked.keepId, ...picked.withIds].reduce((s, id) => s + pairsOf(id), 0))}</b>
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPicked(null)} className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-600">
              لغو
            </button>
            <div className="flex-1">
              <PrimaryBtn disabled={busy} onClick={() => void doMerge()}>
                ✓ یکجا کن
              </PrimaryBtn>
            </div>
          </div>
        </>
      ) : manual ? (
        <>
          <p className="mb-1 text-sm font-bold text-slate-700">دو یا چند جنس را خودتان انتخاب کنید</p>
          <p className="mb-2 text-xs text-slate-500">
            روی هر جنس بزنید تا انتخاب شود؛ دوباره بزنید تا لغو شود. حداقل دو جنس لازم است.
          </p>
          <input className={inputCls} placeholder="جستجو نام..." value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="my-2 max-h-72 overflow-y-auto">
            {manualList.map((p) => {
              const on = manualPicks.includes(p.id!)
              return (
                <button
                  key={p.id}
                  onClick={() =>
                    setManualPicks((cur) => (on ? cur.filter((x) => x !== p.id) : [...cur, p.id!]))
                  }
                  className={`mb-1 flex w-full items-center justify-between rounded-xl border-2 p-2.5 text-right ${
                    on ? 'border-teal-600 bg-teal-50' : 'border-transparent bg-slate-50'
                  }`}
                >
                  {label(p)}
                  <span className="text-xs font-bold text-teal-700">{on ? '✓ انتخاب شد' : 'انتخاب'}</span>
                </button>
              )
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setManual(false)
                setManualPicks([])
              }}
              className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-600"
            >
              ← برگشت
            </button>
            <div className="flex-1">
              <PrimaryBtn
                disabled={manualPicks.length < 2}
                onClick={() => {
                  // آن که بیشترین جوړه دارد پیش‌فرض می‌ماند — در قدم بعد قابل تغییر است
                  const sorted = [...manualPicks].sort((a, b) => pairsOf(b) - pairsOf(a))
                  setPicked({ key: 'manual', keepId: sorted[0], withIds: sorted.slice(1) })
                  setManual(false)
                  setManualPicks([])
                }}
              >
                ادامه ({fmtNum(manualPicks.length)} جنس)
              </PrimaryBtn>
            </div>
          </div>
        </>
      ) : (
        <>
          {groups.length === 0 && (
            <p className="mb-3 rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500">
              جنس تکراری پیدا نشد. اگر باز هم دو جنس یکی است، از «انتخاب دستی» استفاده کنید.
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="mb-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="mb-1 text-sm font-bold text-amber-900">
                {fmtNum(g.products.length)} بار ثبت شده — احتمالاً یک جنس است
              </p>
              {g.products.map((p) => (
                <div key={p.id} className="mb-1 rounded-lg bg-white p-2 text-sm">
                  {label(p)}
                </div>
              ))}
              <button
                onClick={() =>
                  setPicked({
                    key: g.key,
                    // پیش‌فرض: آن که بیشترین جوړه دارد نگه داشته می‌شود
                    keepId: [...g.products].sort((a, b) => pairsOf(b.id!) - pairsOf(a.id!))[0].id!,
                    withIds: [...g.products]
                      .sort((a, b) => pairsOf(b.id!) - pairsOf(a.id!))
                      .slice(1)
                      .map((p) => p.id!)
                  })
                }
                className="mt-1 w-full rounded-xl bg-amber-600 py-2 text-sm font-bold text-white"
              >
                این‌ها یک جنس است — یکجا کن
              </button>
            </div>
          ))}
          <button
            onClick={() => setManual(true)}
            className="mt-2 w-full rounded-xl border-2 border-dashed border-slate-300 py-2.5 text-sm font-bold text-slate-600"
          >
            انتخاب دستی (نام‌ها فرق دارد ولی جنس یکی است)
          </button>
        </>
      )}
    </Modal>
  )
}
