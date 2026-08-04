import DuplicateNameHint from '../../components/DuplicateNameHint'
import { useState } from 'react'
import { db, type Product, type Variant } from '../../db'
import { addVariant, setOpeningStock, setPurchaseCost } from '../../lib/ops'
import { fmtNum, fmtMoney, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { emptyVariant, downscalePhoto, type VariantForm, type ProductDraft } from './helpers'

export function ProductModal({
  product,
  variants,
  allProducts,
  draft,
  onClose
}: {
  product: Product | null
  variants: Variant[]
  allProducts: Product[]
  /** آنچه در ویزارد کارتنی نوشته شده بود — تا دوباره نوشتن لازم نباشد */
  draft?: ProductDraft | null
  onClose: () => void
}) {
  const [name, setName] = useState(product?.name ?? draft?.name ?? '')
  const [brand, setBrand] = useState(product?.brand ?? draft?.brand ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
  const [photo, setPhoto] = useState<string | undefined>(product?.photo ?? draft?.photo)
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
          lowStock: String(v.lowStock),
          cartonQty: String(
            product?.carton?.items.find((it) => it.size === v.size && it.color === v.color)?.qty ?? ''
          )
        }))
      : [
          {
            ...emptyVariant(),
            color: draft?.color ?? '',
            purchasePrice: draft?.purchasePrice ?? '',
            retailPrice: draft?.retailPrice ?? '',
            wholesalePrice: draft?.wholesalePrice ?? ''
          }
        ]
  )
  const [cartonPrice, setCartonPrice] = useState(product?.carton?.price ? String(product.carton.price) : '')
  const [showBulk, setShowBulk] = useState(false)
  const [bulkFrom, setBulkFrom] = useState('')
  const [bulkTo, setBulkTo] = useState('')
  const [bulkColor, setBulkColor] = useState('')
  const [bulkCost, setBulkCost] = useState('')
  const [bulkRetail, setBulkRetail] = useState('')
  const [bulkWholesale, setBulkWholesale] = useState('')
  const [error, setError] = useState('')

  function addBulkSizes() {
    const from = parseNum(bulkFrom)
    const to = parseNum(bulkTo)
    if (from <= 0 || to < from) return setError('سایز شروع و پایان را درست بنویسید')
    if (to - from > 30) return setError('حداکثر ۳۰ سایز یکجا')
    const rows: VariantForm[] = []
    for (let s = from; s <= to; s++) {
      rows.push({
        size: String(s),
        color: bulkColor.trim(),
        purchasePrice: bulkCost,
        retailPrice: bulkRetail,
        wholesalePrice: bulkWholesale || bulkRetail,
        stockQty: '0',
        lowStock: '2',
        cartonQty: ''
      })
    }
    // ردیف خالی اول را کنار بزن
    setForms((fs) => [...fs.filter((f) => f.size.trim() || f.id), ...rows])
    setShowBulk(false)
    setError('')
  }

  const brands = [...new Set(allProducts.map((p) => p.brand).filter(Boolean))] as string[]
  const categories = [...new Set(allProducts.map((p) => p.category).filter(Boolean))] as string[]

  const setForm = (i: number, patch: Partial<VariantForm>) =>
    setForms((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  async function save() {
    if (!name.trim()) return setError('نام بوت را بنویسید')
    const valid = forms.filter((f) => f.size.trim())
    if (!valid.length) return setError('حداقل یک سایز اضافه کنید')
    // جنسی که موجودی دارد باید قیمت خرید داشته باشد — وگرنه در ارزش گدام،
    // در دارایی خالص و در مفاد صفر حساب می‌شود و کسی خبردار نمی‌شود.
    const noCost = valid.find((f) => parseNum(f.stockQty) > 0 && parseNum(f.purchasePrice) <= 0)
    if (noCost)
      return setError(`سایز ${noCost.size} موجودی دارد ولی قیمت خرید ندارد — بدون آن، ارزش گدام و مفاد غلط می‌شود`)
    try {
      let productId = product?.id
      const cartonItems = valid
        .filter((f) => parseNum(f.cartonQty) > 0)
        .map((f) => ({ size: f.size.trim(), color: f.color.trim(), qty: parseNum(f.cartonQty) }))
      const carton = cartonItems.length
        ? { ...(parseNum(cartonPrice) > 0 ? { price: parseNum(cartonPrice) } : {}), items: cartonItems }
        : undefined
      const pData = { name: name.trim(), brand: brand.trim(), category: category.trim(), photo, carton }
      if (productId) await db.products.update(productId, pData)
      else productId = (await db.products.add({ ...pData, createdAt: Date.now() })) as number

      const keptIds = new Set(valid.map((f) => f.id).filter(Boolean))
      for (const v of variants) if (!keptIds.has(v.id)) await db.variants.update(v.id!, { deleted: true })

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
          const { stockQty, purchasePrice, ...rest } = data
          await db.variants.update(f.id, rest)
          // موجودی و قیمت خرید هر دو با سند عوض می‌شوند، نه با نوشتنِ مستقیمِ عدد —
          // وگرنه دفعهٔ بعد که قیمت از روی اسناد بازسازی شود، تغییر پاک می‌گردد
          await setOpeningStock(f.id, stockQty, name.trim())
          await setPurchaseCost(f.id, purchasePrice, name.trim())
        } else {
          await addVariant(data, name.trim())
        }
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      <DuplicateNameHint name={name} ignoreId={product?.id} />
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
            <Field label="در هر کارتن (اختیاری)">
              <input className={inputCls} inputMode="numeric" value={f.cartonQty} onChange={(e) => setForm(i, { cartonQty: e.target.value })} placeholder="۰" />
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
        className="mb-2 w-full rounded-xl border border-dashed border-teal-600 py-2 text-teal-700"
        onClick={() => setForms((fs) => [...fs, emptyVariant()])}
      >
        ＋ افزودن سایز دیگر
      </button>
      {!showBulk ? (
        <button
          className="mb-4 w-full rounded-xl border border-dashed border-amber-500 py-2 text-amber-700"
          onClick={() => setShowBulk(true)}
        >
          ⚡ افزودن چند سایز یکجا (مثلاً ۴۰ تا ۴۴)
        </button>
      ) : (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50/50 p-3">
          <p className="mb-2 text-sm font-bold text-amber-800">برای هر سایز یک ردیف جدا ساخته می‌شود</p>
          <div className="grid grid-cols-2 gap-2">
            <Field label="از سایز *">
              <input className={inputCls} inputMode="numeric" value={bulkFrom} onChange={(e) => setBulkFrom(e.target.value)} placeholder="۴۰" />
            </Field>
            <Field label="تا سایز *">
              <input className={inputCls} inputMode="numeric" value={bulkTo} onChange={(e) => setBulkTo(e.target.value)} placeholder="۴۴" />
            </Field>
            <Field label="رنگ">
              <input className={inputCls} value={bulkColor} onChange={(e) => setBulkColor(e.target.value)} placeholder="خاکی" />
            </Field>
            <Field label="قیمت خرید">
              <input className={inputCls} inputMode="numeric" value={bulkCost} onChange={(e) => setBulkCost(e.target.value)} />
            </Field>
            <Field label="قیمت پرچون">
              <input className={inputCls} inputMode="numeric" value={bulkRetail} onChange={(e) => setBulkRetail(e.target.value)} />
            </Field>
            <Field label="قیمت عمده">
              <input className={inputCls} inputMode="numeric" value={bulkWholesale} onChange={(e) => setBulkWholesale(e.target.value)} />
            </Field>
          </div>
          <p className="mb-2 text-xs text-slate-500">بعد از ساخته شدن، تعداد موجود هر سایز را در ردیف خودش بنویسید.</p>
          <div className="flex gap-2">
            <button onClick={addBulkSizes} className="flex-1 rounded-xl bg-amber-600 py-2 text-sm font-bold text-white">
              بساز
            </button>
            <button onClick={() => setShowBulk(false)} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-600">
              لغو
            </button>
          </div>
        </div>
      )}

      {(() => {
        const pairs = forms.reduce((s, f) => s + (f.size.trim() ? parseNum(f.cartonQty) : 0), 0)
        if (pairs <= 0) return null
        return (
          <div className="mb-4 rounded-xl bg-amber-50 p-3">
            <p className="mb-2 text-sm font-bold text-amber-800">📦 کارتن‌بندی: {fmtNum(pairs)} جوړه در هر کارتن</p>
            <Field label="قیمت عمده فی کارتن (اختیاری)">
              <input className={inputCls} inputMode="numeric" value={cartonPrice} onChange={(e) => setCartonPrice(e.target.value)} />
            </Field>
            <p className="text-xs text-slate-500">
              در خرید و فروش دکمهٔ «＋ یک کارتن» ظاهر می‌شود که همهٔ سایزها را با همین ترکیب اضافه می‌کند.
            </p>
          </div>
        )
      })()}

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

export default ProductModal
