import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Product, type Variant } from '../db'
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

export default function Inventory() {
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<Product | 'new' | null>(null)

  const products = useLiveQuery(() => db.products.orderBy('name').toArray(), [])
  const variants = useLiveQuery(() => db.variants.toArray(), [])

  const byProduct = new Map<number, Variant[]>()
  variants?.forEach((v) => {
    const list = byProduct.get(v.productId) ?? []
    list.push(v)
    byProduct.set(v.productId, list)
  })

  const filtered = products?.filter(
    (p) => !search || p.name.includes(search) || (p.brand ?? '').includes(search)
  )

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">گدام</h1>
      <input
        className={inputCls}
        placeholder="جستجو نام یا برند..."
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
            <Card key={p.id} onClick={() => setEditing(p)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">{p.name}</p>
                  <p className="text-sm text-slate-500">
                    {p.brand} {p.category && `· ${p.category}`}
                  </p>
                </div>
                <div className="text-left">
                  <p className={`font-bold ${low ? 'text-red-600' : 'text-teal-700'}`}>
                    {fmtNum(totalStock)} جوړه
                  </p>
                  {low && <p className="text-xs text-red-600">موجودی کم!</p>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {vs.map((v) => (
                  <span
                    key={v.id}
                    className={`rounded-lg px-2 py-0.5 text-xs ${
                      v.stockQty <= v.lowStock ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'
                    }`}
                  >
                    {v.size} {v.color} : {fmtNum(v.stockQty)}
                  </span>
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
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function ProductModal({
  product,
  variants,
  onClose
}: {
  product: Product | null
  variants: Variant[]
  onClose: () => void
}) {
  const [name, setName] = useState(product?.name ?? '')
  const [brand, setBrand] = useState(product?.brand ?? '')
  const [category, setCategory] = useState(product?.category ?? '')
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

  const setForm = (i: number, patch: Partial<VariantForm>) =>
    setForms((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)))

  async function save() {
    if (!name.trim()) return setError('نام بوت را بنویسید')
    const valid = forms.filter((f) => f.size.trim())
    if (!valid.length) return setError('حداقل یک سایز اضافه کنید')
    try {
      await db.transaction('rw', db.products, db.variants, async () => {
        let productId = product?.id
        if (productId) {
          await db.products.update(productId, { name: name.trim(), brand: brand.trim(), category: category.trim() })
        } else {
          productId = (await db.products.add({
            name: name.trim(),
            brand: brand.trim(),
            category: category.trim(),
            createdAt: Date.now()
          })) as number
        }
        const keptIds = new Set(valid.map((f) => f.id).filter(Boolean))
        for (const v of variants) {
          if (!keptIds.has(v.id)) await db.variants.delete(v.id!)
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
          if (f.id) await db.variants.update(f.id, data)
          else await db.variants.add(data)
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
      await db.variants.where('productId').equals(product.id!).delete()
      await db.products.delete(product.id!)
    })
    onClose()
  }

  return (
    <Modal title={product ? 'ویرایش بوت' : 'بوت جدید'} onClose={onClose}>
      <Field label="نام بوت *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً بوت چرمی مردانه" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="برند">
          <input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>
        <Field label="کتگوری">
          <input className={inputCls} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="مردانه / زنانه / اطفال" />
        </Field>
      </div>

      <p className="mb-2 font-bold text-slate-700">سایزها و رنگ‌ها</p>
      {forms.map((f, i) => (
        <div key={i} className="mb-3 rounded-xl border border-slate-200 p-3">
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
            <Field label="هشدار موجودی کم">
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
