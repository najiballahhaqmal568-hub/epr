import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, makeSku, type Product, type Variant, type AdjustReason } from '../db'
import { addAdjustment } from '../lib/ops'
import { fmtNum, fmtMoney, parseNum } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

interface VariantForm {
  id?: number
  size: string
  color: string
  purchasePrice: string
  retailPrice: string
  wholesalePrice: string
  stockQty: string
  lowStock: string
}

const emptyVariant = (): VariantForm => ({
  size: '',
  color: '',
  purchasePrice: '',
  retailPrice: '',
  wholesalePrice: '',
  stockQty: '0',
  lowStock: '2'
})

/** عکس را کوچک می‌کند تا دیتابیس و بکاپ سنگین نشود */
async function downscalePhoto(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = rej
      i.src = url
    })
    const max = 800
    const scale = Math.min(1, max / Math.max(img.width, img.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.width * scale)
    canvas.height = Math.round(img.height * scale)
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.75)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)
  const [adjusting, setAdjusting] = useState<{ v: Variant; p: Product } | null>(null)
  const [showReorder, setShowReorder] = useState(false)

  const products = useLiveQuery(() => db.products.orderBy('name').filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])

  const byProduct = new Map<number, Variant[]>()
  variants?.forEach((v) => {
    const list = byProduct.get(v.productId) ?? []
    list.push(v)
    byProduct.set(v.productId, list)
  })

  const filtered = products?.filter(
    (p) =>
      !search ||
      p.name.includes(search) ||
      (p.brand ?? '').includes(search) ||
      (byProduct.get(p.id!) ?? []).some((v) => (v.sku ?? '').toLowerCase().includes(search.toLowerCase()))
  )

  const reorderCount = variants?.filter((v) => v.stockQty <= v.lowStock).length ?? 0

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">گدام</h1>
        <button onClick={() => setShowReorder(true)} className={`rounded-full px-3 py-1 text-sm font-bold ${reorderCount ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'}`}>
          خرید مجدد {reorderCount > 0 && `(${fmtNum(reorderCount)})`}
        </button>
      </div>
      <input
        className={inputCls}
        placeholder="جستجو نام، برند یا کود..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="mt-3">
        {filtered?.length === 0 && <Empty text="هنوز جنسی ثبت نشده. با دکمه + بوت جدید اضافه کنید." />}
        {filtered?.map((p) => {
          const vs = byProduct.get(p.id!) ?? []
          const totalStock = vs.reduce((s, v) => s + v.stockQty, 0)
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
                  <p className="font-bold text-slate-800">{p.name}</p>
                  <p className="text-sm text-slate-500">
                    {p.brand} {p.category && `· ${p.category}`}
                  </p>
                </div>
                <div className="text-left">
                  <p className={`font-bold ${low ? 'text-red-600' : 'text-teal-700'}`}>{fmtNum(totalStock)} جوړه</p>
                  {low && <p className="text-xs text-red-600">موجودی کم!</p>}
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

      <Fab onClick={() => setEditing('new')} label="بوت جدید" />
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
    </div>
  )
}

function AdjustModal({ variant, product, onClose }: { variant: Variant; product: Product; onClose: () => void }) {
  const [reason, setReason] = useState<AdjustReason>('damaged')
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const live = useLiveQuery(() => db.variants.get(variant.id!), [variant.id])
  const v = live ?? variant

  const history = useLiveQuery(() => db.adjustments.where('variantId').equals(variant.id!).reverse().sortBy('date'), [variant.id])

  const reasons: { id: AdjustReason; label: string; sign: -1 | 1 | 0 }[] = [
    { id: 'damaged', label: 'داغمه (کم شود)', sign: -1 },
    { id: 'lost', label: 'مفقود (کم شود)', sign: -1 },
    { id: 'correction', label: 'تصحیح شمار (تنظیم دقیق)', sign: 0 }
  ]

  async function save() {
    const n = parseNum(qty)
    if (n < 0) return setError('عدد معتبر وارد کنید')
    let change: number
    if (reason === 'correction') {
      change = n - v.stockQty // qty = شمارش واقعی
    } else {
      if (n === 0) return setError('تعداد را وارد کنید')
      change = -n
    }
    try {
      await addAdjustment({
        date: Date.now(),
        variantId: v.id!,
        productName: product.name,
        size: v.size,
        color: v.color,
        qtyChange: change,
        reason,
        note: note.trim() || undefined
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={`تعدیل گدام — ${product.name} ${v.size} ${v.color}`} onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">
        موجودی فعلی: <b>{fmtNum(v.stockQty)}</b> {v.sku && <span className="text-slate-400">· کود: {v.sku}</span>}
      </p>
      <Field label="دلیل">
        <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value as AdjustReason)}>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={reason === 'correction' ? 'شمارش واقعی (موجودی درست)' : 'تعداد'}>
        <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save}>ثبت تعدیل</PrimaryBtn>

      {history && history.length > 0 && (
        <>
          <p className="mt-4 mb-2 font-bold text-slate-700">تعدیل‌های قبلی</p>
          {history.slice(0, 10).map((a) => (
            <div key={a.id} className="mb-1 flex justify-between rounded-lg bg-slate-50 p-2 text-sm">
              <span>
                {a.reason === 'damaged' ? 'داغمه' : a.reason === 'lost' ? 'مفقود' : a.reason === 'returnDamaged' ? 'مرجوعی داغمه' : 'تصحیح'}
                {a.note && <span className="text-slate-400"> — {a.note}</span>}
              </span>
              <span className={a.qtyChange < 0 ? 'font-bold text-red-600' : 'font-bold text-teal-700'}>
                {a.qtyChange > 0 ? '+' : ''}
                {fmtNum(a.qtyChange)}
              </span>
            </div>
          ))}
        </>
      )}
    </Modal>
  )
}

function ReorderModal({ onClose }: { onClose: () => void }) {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const low = (variants ?? []).filter((v) => v.stockQty <= v.lowStock)
  const productMap = new Map(products?.map((p) => [p.id!, p]))

  return (
    <Modal title="لیست خرید مجدد" onClose={onClose}>
      {low.length === 0 && <p className="text-slate-400">همه اجناس کافی است ✓</p>}
      {low.map((v) => {
        const p = productMap.get(v.productId)
        return (
          <div key={v.id} className="mb-2 flex justify-between rounded-lg bg-slate-50 p-2 text-sm">
            <span>
              {p?.name} — {v.size} {v.color}
              {p?.brand && <span className="text-slate-400"> ({p.brand})</span>}
            </span>
            <span className="font-bold text-red-600">
              {fmtNum(v.stockQty)} / حد {fmtNum(v.lowStock)}
            </span>
          </div>
        )
      })}
    </Modal>
  )
}

function ProductModal({
  product,
  variants,
  allProducts,
  onClose
}: {
  product: Product | null
  variants: Variant[]
  allProducts: Product[]
  onClose: () => void
}) {
  const [name, setName] = useState(product?.name ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [photo, setPhoto] = useState<string | undefined>(product?.photo)
  const [forms, setForms] = useState<VariantForm[]>(
    variants.length
      ? variants.map((v) => ({
          id: v.id,
          size: v.size,
          color: v.color,
          purchasePrice: String(v.purchasePrice),
          retailPrice: String(v.retailPrice),
          wholesalePrice: String(v.wholesalePrice),
          stockQty: String(v.stockQty),
          lowStock: String(v.lowStock)
        }))
      : [emptyVariant()]
  )
  const [error, setError] = useState('')

  const brands = [...new Set(allProducts.map((p) => p.brand).filter(Boolean))] as string[]
  const categories = [...new Set(allProducts.map((p) => p.category).filter(Boolean))] as string[]

  const setForm = (i: number, patch: Partial<VariantForm>) =>
    setForms((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  async function save() {
    if (!name.trim()) return setError('نام بوت را بنویسید')
    const valid = forms.filter((f) => f.size.trim())
    if (!valid.length) return setError('حداقل یک سایز اضافه کنید')
    try {
      await db.transaction('rw', db.products, db.variants, async () => {
        let productId = product?.id
        const pData = { name: name.trim(), brand: brand.trim(), category: category.trim(), photo }
        if (productId) {
          await db.products.update(productId, pData)
        } else {
          productId = (await db.products.add({ ...pData, createdAt: Date.now() })) as number
        }
        const keptIds = new Set(valid.map((f) => f.id).filter(Boolean))
        for (const v of variants) {
          if (!keptIds.has(v.id)) await db.variants.update(v.id!, { deleted: true })
        }
        for (const f of valid) {
          const data = {
            productId: productId!,
            size: f.size.trim(),
            color: f.color.trim(),
            purchasePrice: parseNum(f.purchasePrice),
            retailPrice: parseNum(f.retailPrice),
            wholesalePrice: parseNum(f.wholesalePrice),
            stockQty: parseNum(f.stockQty),
            lowStock: parseNum(f.lowStock)
          }
          if (f.id) {
            await db.variants.update(f.id, data)
          } else {
            const vid = (await db.variants.add(data)) as number
            await db.variants.update(vid, { sku: makeSku(vid, data.size) })
          }
        }
      })
      onClose()
    } catch (e) {
      setError(String(e))
    }
  }

  async function remove() {
    if (!product?.id) return
    if (!confirm('این بوت و همه سایزهای آن حذف شود؟')) return
    await db.transaction('rw', db.products, db.variants, async () => {
      await db.variants.where('productId').equals(product.id!).modify({ deleted: true })
      await db.products.update(product.id!, { deleted: true })
    })
    onClose()
  }

  return (
    <Modal title={product ? 'ویرایش بوت' : 'بوت جدید'} onClose={onClose}>
      <div className="mb-3 flex items-center gap-3">
        {photo ? (
          <img src={photo} alt="" className="h-16 w-16 rounded-xl object-cover" />
        ) : (
          <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-slate-100 text-2xl">👞</div>
        )}
        <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
          {photo ? 'تغییر عکس' : '📷 عکس بوت'}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              if (f) setPhoto(await downscalePhoto(f))
              e.target.value = ''
            }}
          />
        </label>
        {photo && (
          <button className="text-sm text-red-500" onClick={() => setPhoto(undefined)}>
            حذف عکس
          </button>
        )}
      </div>

      <Field label="نام بوت *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً بوت چرمی مردانه" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="برند">
          <input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} list="brand-list" />
          <datalist id="brand-list">
            {brands.map((b) => (
              <option key={b} value={b} />
            ))}
          </datalist>
        </Field>
        <Field label="کتگوری">
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} list="category-list" placeholder="مردانه / زنانه / اطفال" />
          <datalist id="category-list">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </Field>
      </div>

      <p className="mb-2 font-bold text-slate-700">سایزها و رنگ‌ها</p>
      {forms.map((f, i) => (
        <div key={i} className="mb-3 rounded-xl border border-slate-200 p-3">
          {f.id && variants.find((v) => v.id === f.id)?.sku && (
            <p className="mb-1 text-xs text-slate-400">کود: {variants.find((v) => v.id === f.id)!.sku}</p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="سایز *">
              <input className={inputCls} value={f.size} onChange={(e) => setForm(i, { size: e.target.value })} placeholder="۴۲" />
            </Field>
            <Field label="رنگ">
              <input className={inputCls} value={f.color} onChange={(e) => setForm(i, { color: e.target.value })} placeholder="سیاه" />
            </Field>
            <Field label="قیمت خرید">
              <input className={inputCls} inputMode="numeric" value={f.purchasePrice} onChange={(e) => setForm(i, { purchasePrice: e.target.value })} />
            </Field>
            <Field label="تعداد موجود">
              <input className={inputCls} inputMode="numeric" value={f.stockQty} onChange={(e) => setForm(i, { stockQty: e.target.value })} />
            </Field>
            <Field label="قیمت پرچون">
              <input className={inputCls} inputMode="numeric" value={f.retailPrice} onChange={(e) => setForm(i, { retailPrice: e.target.value })} />
            </Field>
            <Field label="قیمت عمده">
              <input className={inputCls} inputMode="numeric" value={f.wholesalePrice} onChange={(e) => setForm(i, { wholesalePrice: e.target.value })} />
            </Field>
            <Field label="حد خرید مجدد">
              <input className={inputCls} inputMode="numeric" value={f.lowStock} onChange={(e) => setForm(i, { lowStock: e.target.value })} />
            </Field>
          </div>
          {forms.length > 1 && (
            <button className="text-sm text-red-600" onClick={() => setForms((fs) => fs.filter((_, j) => j !== i))}>
              حذف این سایز
            </button>
          )}
        </div>
      ))}
      <button
        className="mb-4 w-full rounded-xl border border-dashed border-teal-600 py-2 text-teal-700"
        onClick={() => setForms((fs) => [...fs, emptyVariant()])}
      >
        ＋ افزودن سایز دیگر
      </button>

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save}>ذخیره</PrimaryBtn>
      {product && (
        <button className="mt-3 w-full text-sm text-red-600" onClick={remove}>
          حذف بوت
        </button>
      )}
      {product && variants.length > 0 && (
        <p className="mt-3 text-xs text-slate-400">
          ارزش گدام این بوت: {fmtMoney(variants.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0))}
        </p>
      )}
    </Modal>
  )
}
