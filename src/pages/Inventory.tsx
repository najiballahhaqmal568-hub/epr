import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Product, type Variant } from '../db'
import { fmtNum, fmtMoney, ageLabel } from '../lib/format'
import { inputCls, Fab, Empty, Card } from '../components/ui'
import StockCartonWizard from './inventory/StockCartonWizard'
import StocktakeModal from './inventory/StocktakeModal'
import AdjustModal from './inventory/AdjustModal'
import ReorderModal from './inventory/ReorderModal'
import ProductModal from './inventory/ProductModal'
import MergeProductsModal from './inventory/MergeProductsModal'
import { findDuplicateGroups } from '../lib/merge'
import type { ProductDraft } from './inventory/helpers'
import { pairsPerCartonOf, productReorderInfo, reorderProducts } from '../lib/reorder'

type SortKey = 'name' | 'added' | 'newest' | 'oldest' | 'value'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'حرف (الف–ی)' },
  { id: 'added', label: 'تازه ثبت‌شده' },
  { id: 'newest', label: 'تازه آمده به گدام' },
  { id: 'oldest', label: 'کهنه‌ترین در گدام' },
  { id: 'value', label: 'ارزش' }
]

/** عکس را کوچک می‌کند تا دیتابیس و بکاپ سنگین نشود */

export default function Inventory({
  onOpenPurchases,
  openReorder = false,
  onReorderClosed
}: {
  onOpenPurchases?: () => void
  openReorder?: boolean
  onReorderClosed?: () => void
}) {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [adjusting, setAdjusting] = useState<{ v: Variant; p: Product } | null>(null)
  const [showReorder, setShowReorder] = useState(false)
  const [showStocktake, setShowStocktake] = useState(false)
  const [showMerge, setShowMerge] = useState(false)
  const [showTools, setShowTools] = useState(false)
  const [expandedProductId, setExpandedProductId] = useState<number | null>(null)
  const [draft, setDraft] = useState<ProductDraft | null>(null)
  // چیدمان انتخابی یادش می‌ماند تا هر بار دوباره انتخاب نشود
  const [sort, setSort] = useState<SortKey>(() => (localStorage.getItem('stockSort') as SortKey) || 'newest')
  const chooseSort = (k: SortKey) => {
    setSort(k)
    localStorage.setItem('stockSort', k)
  }

  useEffect(() => {
    if (openReorder) setShowReorder(true)
  }, [openReorder])

  const products = useLiveQuery(() => db.products.orderBy('name').filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])

  const byProduct = new Map<number, Variant[]>()
  variants?.forEach((v) => {
    const list = byProduct.get(v.productId) ?? []
    list.push(v)
    byProduct.set(v.productId, list)
  })

  // جستجو با ترکیب نام، برند، سایز، رنگ و کود — مثلاً «اسکچرز 40 خاکی»
  const filtered = products?.filter((p) => {
    if (!search.trim()) return true
    const vs = byProduct.get(p.id!) ?? []
    const words = search.trim().split(/\s+/)
    return (
      vs.some((v) => {
        const hay = `${p.name} ${p.brand ?? ''} ${p.category ?? ''} ${v.size} ${v.color} ${v.sku ?? ''}`.toLowerCase()
        return words.every((w) => hay.includes(w.toLowerCase()))
      }) ||
      (vs.length === 0 && words.every((w) => `${p.name} ${p.brand ?? ''}`.toLowerCase().includes(w.toLowerCase())))
    )
  })

  // دو تاریخِ جدا: کِی جنس در اپ ثبت شد، و کِی آخرین بار جوړه وارد گدام شد
  const addedOf = (p: Product) => p.createdAt ?? 0
  const newestOf = (p: Product) => {
    const vs = byProduct.get(p.id!) ?? []
    return Math.max(0, ...vs.map((v) => v.lastPurchaseAt ?? 0))
  }
  const oldestOf = (p: Product) => {
    const dates = (byProduct.get(p.id!) ?? []).filter((v) => v.stockQty > 0).map((v) => v.lastPurchaseAt ?? 0)
    const live = dates.filter((d) => d > 0)
    // جنسی که تاریخ ندارد آخر فهرست بماند، نه اول
    return live.length ? Math.min(...live) : Number.MAX_SAFE_INTEGER
  }
  const valueOfProduct = (p: Product) =>
    (byProduct.get(p.id!) ?? []).reduce((s, v) => s + v.stockQty * v.purchasePrice, 0)

  const sorted = [...(filtered ?? [])].sort((a, b) => {
    // برابر که شدند، نام تصمیم می‌گیرد — تا ترتیب همیشه یکسان بماند
    const tie = a.name.localeCompare(b.name, 'fa')
    if (sort === 'added') return addedOf(b) - addedOf(a) || tie
    if (sort === 'newest') return newestOf(b) - newestOf(a) || tie
    if (sort === 'oldest') return oldestOf(a) - oldestOf(b) || tie
    if (sort === 'value') return valueOfProduct(b) - valueOfProduct(a) || tie
    return tie
  })

  const reorderCount = reorderProducts(products ?? [], variants ?? []).length
  // ارزش کل گدام — همان عددی که در راپورها و ویزارد شروع سال می‌آید
  const valueOf = (list: Variant[]) => list.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0)
  const searching = search.trim().length > 0
  const totalValue = valueOf(variants ?? [])
  const totalPairs = (variants ?? []).reduce((s, v) => s + v.stockQty, 0)
  // موجودی دارد ولی قیمت خرید ندارد → در ارزش گدام و در مفاد اصلاً حساب نمی‌شود
  const noPrice = (variants ?? []).filter((v) => v.stockQty > 0 && v.purchasePrice <= 0)
  const noPriceIds = new Set(noPrice.map((v) => v.productId))
  const noPricePairs = noPrice.reduce((s, v) => s + v.stockQty, 0)
  // یک جنس که چند بار ثبت شده (کارتنی/جوړه‌ای/بوجی) — باید یکجا شود
  const dupGroups = findDuplicateGroups(products ?? [])
  const dupIds = new Set(dupGroups.flatMap((g) => g.products.map((p) => p.id!)))

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">گدام</h1>

      <section className="mb-3 rounded-3xl bg-teal-800 p-5 text-white shadow-sm">
        <p className="text-sm text-teal-100">موجودی گدام</p>
        <p className="mt-1 text-3xl font-bold">{fmtNum(totalPairs)} جوړه</p>
        <p className="mt-1 text-sm text-teal-100">ارزش به قیمت خرید: {fmtMoney(totalValue)}</p>
        {noPricePairs > 0 && <p className="mt-1 text-xs font-bold text-amber-200">{fmtNum(noPricePairs)} جوړه هنوز قیمت خرید ندارد</p>}
      </section>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <button className="rounded-xl bg-teal-700 py-2.5 text-sm font-bold text-white">موجودی</button>
        <button
          onClick={onOpenPurchases}
          disabled={!onOpenPurchases}
          className="rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-bold text-slate-700 disabled:opacity-50"
        >
          خرید
        </button>
        <button
          onClick={() => setShowReorder(true)}
          className={`rounded-xl py-2.5 text-sm font-bold ${reorderCount ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'}`}
        >
          خرید مجدد {reorderCount > 0 && `(${fmtNum(reorderCount)})`}
        </button>
      </div>

      <div className="mb-2 flex gap-2">
        <input
          className={inputCls}
          placeholder="جستجو نام، برند یا کود..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          onClick={() => setShowTools((value) => !value)}
          aria-expanded={showTools}
          className={`shrink-0 rounded-xl px-4 text-sm font-bold ${showTools ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700'}`}
        >
          ابزارها
        </button>
      </div>

      {showTools && (
        <section className="mb-3 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <p className="mb-2 text-sm font-bold text-slate-700">ابزارهای گدام</p>
          <div className="flex flex-wrap gap-2">
          <button onClick={() => setShowStocktake(true)} className="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
            شمارش موجودی
          </button>
          {/* همیشه در دسترس — چون نام‌های کاملاً متفاوت خودکار پیدا نمی‌شوند */}
          <button onClick={() => setShowMerge(true)} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
            یکجا کردن جنس تکراری
          </button>
          </div>
          <p className="mb-1 mt-3 text-xs font-bold text-slate-500">چیدمان فهرست</p>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {SORTS.map((o) => (
              <button
                key={o.id}
                onClick={() => chooseSort(o.id)}
                className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
                  sort === o.id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {dupGroups.length > 0 && (
        <button
          onClick={() => setShowMerge(true)}
          className="mt-3 w-full rounded-xl bg-amber-500 p-3 text-right font-bold text-white"
        >
          🔗 {fmtNum(dupGroups.length)} جنس چند بار ثبت شده — یکجا کنید
          <span className="block text-xs font-normal">
            {dupGroups.slice(0, 3).map((g) => g.products[0].name).join('، ')}
          </span>
        </button>
      )}

      {noPrice.length > 0 && (
        <div className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-1 font-bold">
            ⚠️ {fmtNum(noPrice.length)} سایز قیمت خرید ندارد ({fmtNum(noPricePairs)} جوړه)
          </p>
          <p>
            این جوړه‌ها در «ارزش گدام»، در «دارایی خالص» و در سرمایهٔ شما <b>هیچ حساب نمی‌شوند</b> — و اگر فروخته شوند،
            مفاد بیشتر از واقع نشان می‌دهد.
          </p>
          <p className="mt-1">
            روی جنس بزنید و قیمت خرید را بنویسید:{' '}
            <b>{(products ?? []).filter((p) => noPriceIds.has(p.id!)).slice(0, 4).map((p) => p.name).join('، ')}</b>
          </p>
        </div>
      )}

      <div className="mt-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-bold text-slate-800">{searching ? 'نتیجهٔ جستجو' : 'موجودی اخیر'}</h2>
          <span className="text-xs text-slate-400">{fmtNum(sorted.length)} جنس</span>
        </div>
        {sorted.length === 0 && <Empty text="هنوز جنسی ثبت نشده. با دکمه + بوت جدید اضافه کنید." />}
        {sorted.map((p) => {
          const vs = byProduct.get(p.id!) ?? []
          const totalStock = vs.reduce((s, v) => s + v.stockQty, 0)
          // ارزش این جنس به قیمت تمام‌شده — همان تعریفی که «ارزش جنس گدام» در راپورها دارد
          const value = valueOf(vs)
          const reorder = productReorderInfo(p, vs)
          const low = reorder.needsReorder
          return (
            <Card key={p.id}>
              <button
                type="button"
                onClick={() => setExpandedProductId((id) => (id === p.id ? null : p.id!))}
                className="flex w-full items-center gap-3 text-right"
                aria-expanded={expandedProductId === p.id}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-slate-800">
                    {p.name}
                    {dupIds.has(p.id!) && <span className="mr-1 text-xs font-normal text-amber-600">🔗 تکراری</span>}
                  </p>
                  <p className="text-sm text-slate-500">
                    {p.brand} {p.category && `· ${p.category}`}
                  </p>
                </div>
                <div className="shrink-0 text-left">
                  <p className="font-bold text-teal-700">{fmtNum(totalStock)} جوړه</p>
                  {vs.some((v) => v.stockQty > 0 && v.purchasePrice <= 0) ? (
                    <p className="text-xs font-bold text-red-600">⚠️ قیمت خرید ندارد</p>
                  ) : (
                    value > 0 && <p className="text-xs font-bold text-slate-600">ارزش: {fmtMoney(value)}</p>
                  )}
                  {(() => {
                    const pairs = pairsPerCartonOf(p)
                    return (
                      <p className="text-xs text-slate-400">
                        {fmtNum(Math.floor(totalStock / pairs))} کارتن
                        {totalStock % pairs > 0 ? ` و ${fmtNum(totalStock % pairs)} جفت` : ''} ({fmtNum(pairs)}تایی)
                      </p>
                    )
                  })()}
                  {low && <p className="text-xs text-red-600">خرید مجدد: {fmtNum(reorder.reorderCartons)} کارتن یا کمتر مانده!</p>}
                  {(() => {
                    // کهنه‌ترین خرید در بین سایزهای موجود — سن جنس در گدام
                    const dates = vs.filter((v) => v.stockQty > 0).map((v) => v.lastPurchaseAt ?? 0)
                    const oldest = dates.length && Math.min(...dates) > 0 ? Math.min(...dates) : 0
                    const days = oldest ? (Date.now() - oldest) / 86400000 : 0
                    return oldest ? (
                      <p className={`text-xs ${days > 120 ? 'font-bold text-amber-600' : 'text-slate-400'}`}>
                        در گدام: {ageLabel(oldest)}
                      </p>
                    ) : null
                  })()}
                </div>
              </button>
              {expandedProductId === p.id && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <div className="flex flex-wrap gap-1">
                    {vs.map((v) => (
                      <button
                        key={v.id}
                        onClick={() => setAdjusting({ v, p })}
                        className={`rounded-lg px-2 py-1 text-xs ${
                          v.stockQty <= 0 ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'
                        }`}
                      >
                        {v.size} {v.color}: {fmtNum(v.stockQty)}
                        {v.stockQty <= 0 ? ' · تمام' : ''}
                      </button>
                    ))}
                  </div>
                  <button onClick={() => setEditing(p)} className="mt-2 text-sm font-bold text-teal-700">
                    ویرایش مشخصات جنس
                  </button>
                </div>
              )}
            </Card>
          )
        })}
      </div>

      <Fab onClick={() => setShowWizard(true)} label="بوت جدید" />
      {showWizard && (
        <StockCartonWizard
          onClassic={(d) => {
            setShowWizard(false)
            setDraft(d)
            setEditing('new')
          }}
          onClose={() => setShowWizard(false)}
        />
      )}
      {editing && (
        <ProductModal
          product={editing === 'new' ? null : editing}
          variants={editing === 'new' ? [] : (byProduct.get(editing.id!) ?? [])}
          allProducts={products ?? []}
          draft={editing === 'new' ? draft : null}
          onClose={() => {
            setEditing(null)
            setDraft(null)
          }}
        />
      )}
      {adjusting && <AdjustModal variant={adjusting.v} product={adjusting.p} onClose={() => setAdjusting(null)} />}
      {showReorder && (
        <ReorderModal
          onClose={() => {
            setShowReorder(false)
            onReorderClosed?.()
          }}
        />
      )}
      {showStocktake && <StocktakeModal onClose={() => setShowStocktake(false)} />}
      {showMerge && <MergeProductsModal onClose={() => setShowMerge(false)} />}
    </div>
  )
}
