import { useState } from 'react'
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

/** عکس را کوچک می‌کند تا دیتابیس و بکاپ سنگین نشود */

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [showWizard, setShowWizard] = useState(false)
  const [adjusting, setAdjusting] = useState<{ v: Variant; p: Product } | null>(null)
  const [showReorder, setShowReorder] = useState(false)
  const [showStocktake, setShowStocktake] = useState(false)
  const [showMerge, setShowMerge] = useState(false)

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

  const reorderCount = variants?.filter((v) => v.stockQty <= v.lowStock).length ?? 0
  // ارزش کل گدام — همان عددی که در راپورها و ویزارد شروع سال می‌آید
  const valueOf = (list: Variant[]) => list.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0)
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
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">گدام</h1>
        <div className="flex gap-2">
          <button onClick={() => setShowStocktake(true)} className="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-800">
            📋 شمارش
          </button>
          {/* همیشه در دسترس — چون نام‌های کاملاً متفاوت خودکار پیدا نمی‌شوند */}
          <button onClick={() => setShowMerge(true)} className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-600">
            🔗 یکجا کردن
          </button>
          <button onClick={() => setShowReorder(true)} className={`rounded-full px-3 py-1 text-sm font-bold ${reorderCount ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
            خرید مجدد {reorderCount > 0 && `(${fmtNum(reorderCount)})`}
          </button>
        </div>
      </div>
      <input
        className={inputCls}
        placeholder="جستجو نام، برند یا کود..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

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

      {totalPairs > 0 && (
        <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-800 p-3 text-white">
          <span className="text-sm opacity-80">مجموع گدام</span>
          <span className="text-left">
            <span className="text-lg font-bold">{fmtMoney(totalValue)}</span>
            <span className="block text-xs opacity-80">
              {fmtNum(totalPairs)} جوړه · به قیمت خرید
              {noPricePairs > 0 && ` (${fmtNum(noPricePairs)} جوړه بی‌قیمت شمرده نشده)`}
            </span>
          </span>
        </div>
      )}

      <div className="mt-3">
        {filtered?.length === 0 && <Empty text="هنوز جنسی ثبت نشده. با دکمه + بوت جدید اضافه کنید." />}
        {filtered?.map((p) => {
          const vs = byProduct.get(p.id!) ?? []
          const totalStock = vs.reduce((s, v) => s + v.stockQty, 0)
          // ارزش این جنس به قیمت تمام‌شده — همان تعریفی که «ارزش جنس گدام» در راپورها دارد
          const value = valueOf(vs)
          const low = vs.some((v) => v.stockQty <= v.lowStock)
          return (
            <Card key={p.id}>
              <div className="flex items-center gap-3" onClick={() => setEditing(p)}>
                {p.photo ? (
                  <img src={p.photo} alt="" className="h-12 w-12 rounded-lg object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-xl">👞</div>
                )}
                <div className="flex-1">
                  <p className="font-bold text-slate-800">
                    {p.name}
                    {dupIds.has(p.id!) && <span className="mr-1 text-xs font-normal text-amber-600">🔗 تکراری</span>}
                  </p>
                  <p className="text-sm text-slate-500">
                    {p.brand} {p.category && `· ${p.category}`}
                  </p>
                </div>
                <div className="text-left">
                  <p className={`font-bold ${low ? 'text-red-600' : 'text-teal-700'}`}>{fmtNum(totalStock)} جوړه</p>
                  {vs.some((v) => v.stockQty > 0 && v.purchasePrice <= 0) ? (
                    <p className="text-xs font-bold text-red-600">⚠️ قیمت خرید ندارد</p>
                  ) : (
                    value > 0 && <p className="text-xs font-bold text-slate-600">ارزش: {fmtMoney(value)}</p>
                  )}
                  {(() => {
                    const pairs = p.carton?.items.reduce((s, it) => s + it.qty, 0) ?? 0
                    return pairs > 0 ? <p className="text-xs text-slate-400">≈ {fmtNum(Math.floor(totalStock / pairs))} کارتن ({fmtNum(pairs)}تایی)</p> : null
                  })()}
                  {low && <p className="text-xs text-red-600">موجودی کم!</p>}
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
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {vs.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => setAdjusting({ v, p })}
                    className={`rounded-lg px-2 py-0.5 text-xs ${
                      v.stockQty <= v.lowStock ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {v.size} {v.color} : {fmtNum(v.stockQty)}
                  </button>
                ))}
              </div>
            </Card>
          )
        })}
      </div>

      <Fab onClick={() => setShowWizard(true)} label="بوت جدید" />
      {showWizard && (
        <StockCartonWizard
          onClassic={() => {
            setShowWizard(false)
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
          onClose={() => setEditing(null)}
        />
      )}
      {adjusting && <AdjustModal variant={adjusting.v} product={adjusting.p} onClose={() => setAdjusting(null)} />}
      {showReorder && <ReorderModal onClose={() => setShowReorder(false)} />}
      {showStocktake && <StocktakeModal onClose={() => setShowStocktake(false)} />}
      {showMerge && <MergeProductsModal onClose={() => setShowMerge(false)} />}
    </div>
  )
}
