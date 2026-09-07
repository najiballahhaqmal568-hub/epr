import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type SaleLine, type Variant, type Product } from '../../db'
import { addSale, addSaleWithShipping, type SaleShippingInput } from '../../lib/ops'
import { calculateShipping } from '../../lib/shipping'
import { ShippingEditor } from './SaleShipping'
import { fmtNum, fmtMoney, parseNum, fromDateInput } from '../../lib/format'
import { saveSaleDraft, deleteSaleDraft, readWorkingSale, writeWorkingSale, clearWorkingSale, type SaleDraft } from '../../lib/saleDrafts'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { Icon } from '../../components/Icon'
import StockSelectionSummary from './StockSelectionSummary'

function EmbeddedSale({ children }: { children: ReactNode; title: string; onClose: () => void }) {
  return <div className="sale-embedded">{children}</div>
}

export function NewSaleModal({
  onClose,
  onSaved,
  onHeld,
  onPendingChange,
  draft: suppliedDraft,
  embedded = false
}: {
  onClose: () => void
  onSaved?: (sale: Sale) => void
  onHeld?: (draft: SaleDraft) => void
  onPendingChange?: (pending: boolean) => void
  draft?: SaleDraft
  embedded?: boolean
}) {
  const [draft] = useState(() => suppliedDraft ?? (embedded ? readWorkingSale() ?? undefined : undefined))
  const pendingRef = useRef(false)
  const completedRef = useRef(false)
  const [pending, setPending] = useState(false)
  useEffect(() => { onPendingChange?.(pending) }, [pending, onPendingChange])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pendingRef.current && !completedRef.current) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])
  const [draftStatus, setDraftStatus] = useState(draft ? 'پیش‌نویس بازیابی شد' : 'آماده برای فروش جدید')
  const Shell = embedded ? EmbeddedSale : Modal
  const [saleType, setSaleType] = useState<'retail' | 'wholesale'>(draft?.saleType ?? 'retail')
  const [shipping, setShipping] = useState<SaleShippingInput | undefined>(draft?.shipping)
  const [showShipping, setShowShipping] = useState(false)
  const [customerId, setCustomerId] = useState<number | ''>(draft?.customerId ?? '')
  const [custSearch, setCustSearch] = useState('')
  const [showCust, setShowCust] = useState(false)
  const [lines, setLines] = useState<SaleLine[]>(draft?.lines ?? [])
  const [paidStr, setPaidStr] = useState(draft?.paidStr ?? '')
  const [paidTouched, setPaidTouched] = useState(draft?.paidTouched ?? false)
  const [discountStr, setDiscountStr] = useState(draft?.discountStr ?? '')
  const [showDiscount, setShowDiscount] = useState(Boolean(draft?.discountStr))
  const [promise, setPromise] = useState(draft?.promise ?? '')
  // صفحهٔ دفتر فزیکی — با انتخاب مشتری، صفحهٔ فعلی خودش پیشنهاد می‌شود
  const [bookPage, setBookPage] = useState(draft?.bookPage ?? '')
  const [pageTouched, setPageTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => { if (error) errorRef.current?.scrollIntoView({ block: 'center' }) }, [error])
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  // در عمده اول می‌پرسد: کارتن کامل یا نیم کارتن (خانه‌پری سایزها تا نصف کارتن)
  const [pickerMode, setPickerMode] = useState<'choice' | 'single' | 'half'>('single')
  const [halfQtys, setHalfQtys] = useState<Record<number, number>>({})
  // چند کارتن یک‌جا — مثل فاکتور عمدهٔ کاغذی (۳ کارتن ECCO…)
  const [cartonCounts, setCartonCounts] = useState<Record<number, number>>({})
  const cartonCountOf = (id: number) => Math.max(1, Math.floor(cartonCounts[id] ?? 1))
  const setCartonCount = (id: number, n: number) => setCartonCounts((c) => ({ ...c, [id]: Math.max(1, n) }))

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const reserved = new Map<number, number>()
  for (const line of lines) reserved.set(line.variantId, (reserved.get(line.variantId) ?? 0) + line.qty)
  const selectedQty = (id: number) => reserved.get(id) ?? 0
  const remainingQty = (v: Variant) => Math.max(0, v.stockQty - selectedQty(v.id!))
  const stockInvalid = !variants || lines.some(line => {
    const v = variants.find(item => item.id === line.variantId)
    return !v || !Number.isInteger(line.qty) || line.qty <= 0 || selectedQty(line.variantId) > v.stockQty
  })
  // فروش‌های ۳۰ روز اخیر برای کاشی‌های «پرفروش‌ها»
  const recentSales = useLiveQuery(
    () => db.sales.where('date').aboveOrEqual(Date.now() - 30 * 86400000).filter((s) => !s.deleted).toArray(),
    []
  )

  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  // پرفروش‌ترین مدل‌های ۳۰ روز اخیر — هر مدل یک کاشی؛ سایز/رنگ بعد از ضربه انتخاب می‌شود
  const soldCount = new Map<number, number>()
  recentSales?.forEach((s) => s.lines.forEach((l) => soldCount.set(l.variantId, (soldCount.get(l.variantId) ?? 0) + l.qty)))
  const byProd = new Map<number, { p: Product; vs: Variant[]; sold: number; stock: number }>()
  variants?.forEach((v) => {
    const p = productMap.get(v.productId)
    if (!p) return
    const e = byProd.get(p.id!) ?? { p, vs: [], sold: 0, stock: 0 }
    e.vs.push(v)
    e.sold += soldCount.get(v.id!) ?? 0
    e.stock += v.stockQty
    byProd.set(p.id!, e)
  })
  const quickProducts = [...byProd.values()]
    .filter((e) => e.stock > 0)
    .sort((a, b) => (b.sold !== a.sold ? b.sold - a.sold : b.stock - a.stock))
    .slice(0, 24)

  const matches =
    search.trim() && variants && products
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color} ${v.sku ?? ''}`
            return search
              .trim()
              .split(/\s+/)
              .every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  // جنس‌های کارتن‌دارِ مطابق جستجو — برای فروش کارتنی
  const cartonProducts = [
    ...new Map(
      matches
        .map((v) => productMap.get(v.productId)!)
        .filter((p) => (p.carton?.items.length ?? 0) > 0)
        .map((p) => [p.id!, p])
    ).values()
  ]

  /** چند کارتن کامل از این جنس در گدام موجود است؟ */
  function cartonsInStock(p: Product): number {
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    const required = new Map<Variant, number>()
    for (const it of p.carton!.items) {
      const v = vs.find(x => x.size === it.size && x.color === it.color)
      if (!v || !Number.isInteger(it.qty) || it.qty <= 0) return 0
      required.set(v, (required.get(v) ?? 0) + it.qty)
    }
    return required.size ? Math.min(...[...required].map(([v, qty]) => Math.floor(remainingQty(v) / qty))) : 0
  }

  function addCartonSale(p: Product, count = 1) {
    if (!Number.isInteger(count) || count <= 0 || count > cartonsInStock(p)) return setError('برای این تعداد کارتن، موجودی باقی‌مانده کافی نیست')
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    setLines((ls) => {
      let out = [...ls]
      for (const it of p.carton!.items) {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        if (!v) continue
        const q = it.qty * count
        const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
        const i = out.findIndex((l) => l.variantId === v.id)
        if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + q } : l))
        else out.push({ variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: q, unitPrice: price })
      }
      return out
    })
    // قیمت کارتنی: تفاوت با مجموع فی‌جوړه به شکل تخفیف ثبت می‌شود تا مجموع دقیقاً قیمت کارتن شود
    if (saleType === 'wholesale' && p.carton?.price) {
      const vs2 = variants?.filter((v) => v.productId === p.id) ?? []
      const pairSum = p.carton.items.reduce((s, it) => {
        const v = vs2.find((x) => x.size === it.size && x.color === it.color)
        return s + it.qty * (v?.wholesalePrice ?? 0)
      }, 0)
      const diff = (pairSum - p.carton.price) * count
      if (diff > 0) setDiscountStr((prev) => String(parseNum(prev) + diff))
    }
  }

  const selectedCustomer = customers?.find((c) => c.id === customerId)
  const custMatches =
    custSearch.trim() && customers
      ? customers.filter((c) => `${c.name} ${c.phone ?? ''}`.includes(custSearch.trim())).slice(0, 8)
      : []

  async function quickAddCustomer() {
    const name = custSearch.trim()
    if (!name) return
    const id = (await db.customers.add({ name, type: saleType, balance: 0, createdAt: Date.now() })) as number
    setCustomerId(id)
    setCustSearch('')
  }

  const subtotal = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const discount = Math.min(parseNum(discountStr), subtotal)
  const total = subtotal - discount
  const paid = paidTouched ? parseNum(paidStr) : total
  const remainder = total - paid
  const paymentMode = paidTouched && !paidStr.trim() ? 'mixed' : !paidTouched || paid >= total ? 'cash' : paid === 0 ? 'credit' : 'mixed'

  useEffect(() => {
    if (!embedded || completedRef.current) return
    try {
      writeWorkingSale({ saleType, customerId: customerId || undefined, lines, paidStr, paidTouched, discountStr, promise, bookPage, shipping }, draft)
      setDraftStatus(lines.length ? 'پیش‌نویس در همین نشست محفوظ است' : 'آماده برای فروش جدید')
    } catch {
      setDraftStatus('پیش‌نویس محفوظ نشد؛ پیش از خروج ثبت یا معطل کنید')
    }
  }, [embedded, saleType, customerId, lines, paidStr, paidTouched, discountStr, promise, bookPage, shipping, draft])

  function discard() {
    if (pendingRef.current || !confirm('این سبد پاک شود؟ فروش ثبت نشده از گدام یا صندوق کم نمی‌شود.')) return
    try {
      if (draft && draft.id !== 'working') deleteSaleDraft(draft.id)
      clearWorkingSale()
      completedRef.current = true
      onClose()
    } catch {
      setError('پیش‌نویس پاک نشد؛ دوباره کوشش کنید')
    }
  }

  function addLine(v: Variant, n = 1) {
    if (n > remainingQty(v)) return setError('تمام موجودی این سایز و رنگ انتخاب شده است')
    const p = productMap.get(v.productId)!
    const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + n } : l))
      return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: n, unitPrice: price }]
    })
    setSearch('')
  }

  function hold() {
    if (pendingRef.current) return
    if (!lines.length) return setError('برای معطل‌کردن، حداقل یک جنس انتخاب کنید')
    try {
      const held = saveSaleDraft(
        {
          saleType,
          customerId: customerId || undefined,
          lines,
          paidStr,
          paidTouched,
          discountStr,
          promise,
          bookPage,
          shipping
        },
        draft?.id === 'working' ? undefined : draft
      )
      completedRef.current = true
      try { clearWorkingSale() } catch { /* Explicit held copy is already durable. */ }
      onHeld?.(held)
      onClose()
    } catch {
      setError('پیش‌نویس در این دستگاه ذخیره نشد؛ فضای مرورگر را بررسی کنید')
    }
  }

  async function save() {
    if (pendingRef.current) return
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    if (shipping && (saleType !== 'wholesale' || !customerId)) return setError('کرایه به مشتری عمده مربوط است؛ مشتری را انتخاب کنید یا کرایه را بردارید')
    if (shipping) {
      try { calculateShipping(shipping) }
      catch { return setError('معلومات کرایه درست نیست؛ کرایه را باز و اصلاح کنید') }
    }
    if (stockInvalid) return setError('موجودی بعضی سایزها کافی نیست یا تعداد درست نیست؛ سبد را اصلاح کنید')
    if (paidTouched && !paidStr.trim()) return setError('مبلغ نقد دریافتی را وارد کنید؛ اگر هیچ نقد نگرفته‌اید، گزینهٔ قرض را انتخاب کنید.')
    if (remainder > 0 && !customerId) {
      setShowCust(true)
      return setError('برای فروش قرضی باید مشتری انتخاب شود')
    }
    const customer = customers?.find((c) => c.id === customerId)
    const sale: Sale = {
      date: Date.now(),
      customerId: customerId || undefined,
      customerName: customer?.name,
      saleType,
      lines,
      total,
      paid,
      discount: discount > 0 ? discount : undefined,
      promiseDate: remainder > 0 && promise ? fromDateInput(promise) : undefined,
      // صفحه فقط برای فروش قرضی معنا دارد — فروش نقدی در دفتر قرض نمی‌نشیند
      bookPage: remainder > 0 && bookPage.trim() ? bookPage.trim() : undefined
    }
    pendingRef.current = true
    setPending(true)
    setError('')
    try {
      const id = shipping ? await addSaleWithShipping(sale, shipping) : await addSale(sale)
      sale.id = id
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      pendingRef.current = false
      setPending(false)
      return
    }
    // The transaction has committed. Ancillary preference/storage errors must
    // never present the sale as failed or offer a retry that duplicates it.
    completedRef.current = true
    const warnings: string[] = []
    try {
      clearWorkingSale()
    } catch { warnings.push('پیش‌نویس پاک نشد؛ آن را دوباره ثبت نکنید.') }
    if (draft && draft.id !== 'working') {
      try { deleteSaleDraft(draft.id) }
      catch { warnings.push('فروش معطل پاک نشد؛ آن را دوباره ثبت نکنید.') }
    }
    if (sale.bookPage && customer?.id && customer.bookPage?.trim() !== sale.bookPage) {
      try { await db.customers.update(customer.id, { bookPage: sale.bookPage }) }
      catch { warnings.push('صفحهٔ پیش‌فرض مشتری تغییر نکرد؛ صفحه در خود فروش محفوظ است.') }
    }
    if (warnings.length) alert(`فروش ثبت شد. ${warnings.join(' ')}`)
    if (onSaved) onSaved(sale)
    else onClose()
  }

  return (
    <Shell title="فروش جدید" onClose={() => { if (!pendingRef.current) onClose() }}>
      {error && <p ref={errorRef} role="alert" className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">{error}</p>}
      <div className="sale-draft-status mb-3 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span role="status">{pending ? 'در حال ثبت؛ لطفاً منتظر بمانید' : draftStatus}</span>
        {lines.length > 0 && <button disabled={pending} onClick={discard} className="text-red-600">پاک‌کردن سبد</button>}
      </div>
      <fieldset disabled={pending} className="min-w-0">
      <div className={embedded ? 'sale-workspace' : ''}>
      <section className="sale-finder">
      <h2 className="mb-4 text-xl font-bold">انتخاب جنس</h2>
      <div className="mb-3 flex gap-2">
        {(['retail', 'wholesale'] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setSaleType(t)
              setLines((ls) =>
                ls.map((l) => {
                  const v = variants?.find((v) => v.id === l.variantId)
                  return v ? { ...l, unitPrice: t === 'retail' ? v.retailPrice : v.wholesalePrice } : l
                })
              )
            }}
            className={`flex-1 rounded-xl py-2 font-bold ${
              saleType === t ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t === 'retail' ? 'پرچون' : 'عمده'}
          </button>
        ))}
      </div>

      <Field label="جستجوی جنس">
        <div className="relative"><span className="pointer-events-none absolute right-3 top-3 text-slate-400"><Icon name="search" /></span><input
          className={`${inputCls} pr-10`}
          autoFocus={!embedded}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="نام، سایز، رنگ یا کود..."
        /></div>
      </Field>
      {products === undefined && <p role="status" className="py-8 text-center text-slate-500">در حال بارگذاری اجناس…</p>}
      {products?.length === 0 && <p className="py-8 text-center text-slate-500">هنوز جنسی در گدام نیست. نخست جنس اضافه کنید.</p>}
      {search.trim() && products && matches.length === 0 && <p className="py-8 text-center text-slate-500">جنسی با این جستجو پیدا نشد.</p>}
      {quickProducts.length > 0 && !search.trim() && (
        <>
          <p className="mb-3 text-sm text-slate-500">اجناس موجود · مدل را انتخاب کنید، سپس سایز و رنگ</p>
          <div className="sale-product-grid mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {quickProducts.map((e) => {
              const inStock = e.vs.filter((v) => v.stockQty > 0)
              const minPrice = Math.min(...inStock.map((v) => (saleType === 'retail' ? v.retailPrice : v.wholesalePrice)))
              return (
                <button
                  key={e.p.id}
                  onClick={() => {
                    setPickerFor(e.p.id!)
                    setPickerMode(saleType === 'wholesale' && (e.p.carton?.items.length ?? 0) > 0 ? 'choice' : 'single')
                    setHalfQtys({})
                  }}
                  className="sale-product-card rounded-xl border border-slate-200 bg-white p-3 text-right active:bg-teal-50"
                >
                  {e.p.photo ? (
                    <img src={e.p.photo} alt={e.p.name} className="mb-3 h-28 w-full rounded-lg object-cover" />
                  ) : (
                    <span className="sale-product-placeholder mb-3 flex h-28 items-center justify-center rounded-lg bg-slate-50 text-3xl text-slate-400" aria-hidden="true">{e.p.name.slice(0, 2)}</span>
                  )}
                  <p className="truncate text-sm font-bold text-slate-800">{e.p.name}</p>
                  <p className="truncate text-xs text-slate-500">
                    {fmtNum(inStock.length)} سایز · {fmtNum(e.stock)} جوړه
                  </p>
                  <p className="text-xs font-bold text-teal-700">{fmtMoney(minPrice)}</p>
                </button>
              )
            })}
          </div>
        </>
      )}

      {saleType === 'wholesale' &&
        cartonProducts.map((p) => {
          const pairs = p.carton!.items.reduce((s, it) => s + it.qty, 0)
          const avail = cartonsInStock(p)
          const n = cartonCountOf(p.id!)
          return (
            <div
              key={`c${p.id}`}
              className="mb-2 flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-right font-bold text-amber-800"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate">{p.name}</p>
                <p className="block text-xs font-normal">
                  هر کارتن {fmtNum(pairs)} جوړه
                  {p.carton!.price ? ` · کارتنی: ${fmtMoney(p.carton!.price)}` : ''} ·{' '}
                  {avail > 0 ? `${fmtNum(avail)} کارتن باقی‌مانده پس از سبد` : 'کارتن کامل دیگری موجود نیست'}
                  <span className="block">پس از این انتخاب: {fmtNum(Math.max(0, avail - n))} کارتن باقی می‌ماند</span>
                  {n > avail && <span role="alert" className="block text-red-700">تعداد کارتن از باقی‌مانده بیشتر است</span>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  className="h-8 w-8 rounded-full bg-white font-bold"
                  onClick={() => setCartonCount(p.id!, n - 1)}
                  disabled={n <= 1}
                >
                  −
                </button>
                <span className="w-8 text-center">{fmtNum(n)}</span>
                <button
                  className="h-8 w-8 rounded-full bg-white font-bold"
                  onClick={() => setCartonCount(p.id!, Math.min(n + 1, avail))}
                  disabled={avail <= 0 || n >= avail}
                >
                  ＋
                </button>
                <button
                  onClick={() => addCartonSale(p, n)}
                  disabled={avail <= 0 || n > avail}
                  className="rounded-xl bg-amber-700 px-4 py-2 text-white active:bg-amber-800 disabled:opacity-40"
                >
                  ＋ افزودن
                </button>
              </div>
            </div>
          )
        })}
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((v) => {
            const p = productMap.get(v.productId)!
            return (
              <div key={v.id} className="flex items-stretch border-b border-slate-100 bg-white last:border-0">
                <button
                  onClick={() => addLine(v)}
                  disabled={remainingQty(v) <= 0}
                  className="flex flex-1 items-center justify-between px-3 py-2 text-right active:bg-teal-50 disabled:opacity-40"
                >
                  <span>
                    {p.name} — {v.size} {v.color}
                  </span>
                  <span className="text-sm text-slate-500">
                    <StockSelectionSummary stock={v.stockQty} selected={selectedQty(v.id!)} />
                    {fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}
                  </span>
                </button>
                {/* تعداد مستقیم از نتیجهٔ جستجو — بدون باز کردن سطر */}
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => addLine(v, n)}
                    disabled={remainingQty(v) < n}
                    className="w-10 shrink-0 border-r border-slate-100 text-sm font-bold text-teal-700 active:bg-teal-50 disabled:opacity-30"
                  >
                    ×{fmtNum(n)}
                  </button>
                ))}
              </div>
            )
          })}
        </div>
      )}

      </section>
      <section className="sale-checkout">
      <div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-bold">سبد فروش</h2><span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-bold text-teal-700">{fmtNum(lines.reduce((sum, line) => sum + line.qty, 0))} جوړه</span></div>
      {!lines.length && <div className="sale-empty-cart rounded-xl border border-dashed border-slate-300 p-8 text-center"><Icon name="sale" className="mx-auto mb-3 text-slate-400" /><p className="font-bold text-slate-600">سبد هنوز خالی است</p><p className="mt-2 text-sm text-slate-500">یک جنس انتخاب کنید تا فروش را شروع کنیم.</p></div>}
      {lines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1">
            <p className="text-sm font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              aria-label={`قیمت ${l.productName} ${l.size}`}
              value={l.unitPrice}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت فی جوړه</span>
          </div>
          <div className="flex items-center gap-2">
            <button aria-label={`کاهش تعداد ${l.productName}`} className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={l.qty}
              aria-label={`تعداد ${l.productName} ${l.size}`}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseNum(e.target.value) || 1) } : x)))}
            />
            <button aria-label={`افزایش تعداد ${l.productName}`} disabled={!variants || selectedQty(l.variantId) >= (variants.find(v => v.id === l.variantId)?.stockQty ?? 0)} className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800 disabled:opacity-40" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              ＋
            </button>
            <button aria-label={`حذف ${l.productName} از سبد`} className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              <Icon name="trash" />
            </button>
          </div>
          <div className="w-full"><StockSelectionSummary stock={variants ? variants.find(v => v.id === l.variantId)?.stockQty ?? 0 : undefined} selected={selectedQty(l.variantId)} /></div>
        </div>
      ))}

      {selectedCustomer ? (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-teal-50 p-2.5">
          <div>
            <p className="font-bold text-teal-800">{selectedCustomer.name}</p>
            {selectedCustomer.balance > 0 && (
              <p className="text-xs text-red-600">قرض فعلی: {fmtMoney(selectedCustomer.balance)}</p>
            )}
          </div>
          <button
            className="rounded-full bg-white px-3 py-1 text-sm font-bold text-slate-500"
            onClick={() => {
              setCustomerId('')
              setShowCust(false)
            }}
            aria-label="حذف مشتری"
          >
            ✕
          </button>
        </div>
      ) : showCust ? (
        <Field label="مشتری (خالی = نقدی؛ برای قرضی لازمی)">
          <input
            className={inputCls}
            autoFocus
            value={custSearch}
            onChange={(e) => setCustSearch(e.target.value)}
            placeholder="جستجوی نام یا تلفن مشتری..."
          />
        </Field>
      ) : (
        // فروش نقدی پیش‌فرض است — خانهٔ مشتری فقط وقتی لازم شود باز می‌شود
        <div className="mb-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
          <span className="text-sm font-bold text-slate-600">{remainder > 0 ? 'انتخاب مشتری برای قرض' : 'مشتری نقدی'}</span>
          <button onClick={() => setShowCust(true)} className="rounded-full bg-amber-100 px-4 py-1.5 text-sm font-bold text-amber-800">
            قرضی؟ انتخاب مشتری
          </button>
        </div>
      )}
      {!selectedCustomer && custSearch.trim() && (
        <div className="-mt-2 mb-3 overflow-hidden rounded-xl border border-slate-200">
          {custMatches.map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setCustomerId(c.id!)
                setCustSearch('')
                if (!pageTouched) setBookPage(c.bookPage?.trim() ?? '')
              }}
              className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50"
            >
              <span>{c.name}</span>
              {c.balance > 0 ? (
                <span className="text-xs text-red-600">قرض: {fmtMoney(c.balance)}</span>
              ) : (
                <span className="text-xs text-slate-400">{c.phone}</span>
              )}
            </button>
          ))}
          <button onClick={() => void quickAddCustomer()} className="w-full bg-teal-50 px-3 py-2 text-right font-bold text-teal-800">
            ＋ مشتری جدید: «{custSearch.trim()}»
          </button>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-teal-50 p-3">
        <div className="flex justify-between text-slate-600">
          <span>مجموع اجناس</span>
          <span>{fmtMoney(subtotal)}</span>
        </div>
        {showDiscount ? (
          <Field label="تخفیف (اختیاری)">
            <div className="flex gap-2">
              <input className={inputCls} inputMode="numeric" value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} placeholder="۰" />
              <button
                type="button"
                className="shrink-0 rounded-xl bg-white px-3 text-sm font-bold text-slate-500"
                onClick={() => {
                  setDiscountStr('')
                  setShowDiscount(false)
                }}
              >
                حذف
              </button>
            </div>
          </Field>
        ) : (
          <button type="button" onClick={() => setShowDiscount(true)} className="my-2 text-sm font-bold text-teal-700">
            ＋ افزودن تخفیف
          </button>
        )}
        <div className="flex items-center justify-between font-bold text-slate-800">
          <span>قابل پرداخت{discount > 0 ? ` (با ${fmtMoney(discount)} تخفیف)` : ''}</span>
          <span className="text-xl">{fmtMoney(total)}</span>
        </div>
        <div role="group" aria-label="روش پرداخت" className="my-4 flex gap-2">
          {(['cash', 'credit', 'mixed'] as const).map((mode) => <button key={mode} type="button" aria-pressed={paymentMode === mode} className={`flex-1 rounded-xl px-2 py-2 text-sm font-bold ${paymentMode === mode ? 'bg-teal-700 text-white' : 'bg-white text-slate-600'}`} onClick={() => {
            setPaidTouched(mode !== 'cash')
            setPaidStr(mode === 'credit' ? '0' : '')
            if (mode !== 'cash') setShowCust(true)
          }}>{mode === 'cash' ? 'نقد' : mode === 'credit' ? 'قرض' : 'نقد و قرض'}</button>)}
        </div>
        <Field label="مبلغ دریافتی (نقد)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={paidTouched ? paidStr : String(total)}
            onFocus={() => {
              if (!paidTouched) {
                setPaidTouched(true)
                setPaidStr(String(total))
              }
            }}
            onChange={(e) => setPaidStr(e.target.value)}
          />
        </Field>
        {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض مشتری): {fmtMoney(remainder)}</p>}
        {remainder > 0 && customerId !== '' && (
          <Field label="صفحهٔ دفتر (این قرض در کدام ورق نوشته شد)">
            <input
              className={inputCls}
              value={bookPage}
              onChange={(e) => {
                setPageTouched(true)
                setBookPage(e.target.value)
              }}
              placeholder={selectedCustomer?.bookPage?.trim() ? `صفحهٔ فعلی: ${selectedCustomer.bookPage.trim()}` : 'مثلاً ۱۲'}
            />
          </Field>
        )}
        {remainder > 0 && (
          <Field label="وعدهٔ پرداخت (اختیاری)">
            <input type="date" className={inputCls} value={promise} onChange={(e) => setPromise(e.target.value)} />
          </Field>
        )}
        {remainder < 0 && <p className="text-sm font-bold text-amber-600">بازگشت به مشتری: {fmtMoney(-remainder)}</p>}
      </div>

      {/* نوار چسپان: مجموع و ثبت همیشه دیده شوند */}
      {(saleType === 'wholesale' || shipping) && <div className="mb-3 rounded-xl border border-slate-200 p-3 text-sm">
        {shipping && <><p>کرایهٔ بار: {fmtMoney(shipping.total)} · سهم مشتری: {fmtMoney(shipping.customerShare)}</p><p>دریافت نقدی کرایه: {fmtMoney(shipping.received)} · باقی قرض کرایه: {fmtMoney(shipping.customerShare - shipping.received)}</p></>}
        <div className="mt-2 flex gap-2">
          <button disabled={pending || !customerId || saleType !== 'wholesale'} className="flex-1 rounded-lg bg-teal-50 p-3 font-bold text-teal-800 disabled:opacity-40" onClick={() => setShowShipping(true)}>{shipping ? 'ویرایش کرایهٔ فروش' : 'افزودن کرایهٔ بار'}</button>
          {shipping && <button className="rounded-lg bg-red-50 p-3 text-red-700" onClick={() => setShipping(undefined)}>برداشتن کرایه</button>}
        </div>
        {!customerId && <p className="mt-2 text-slate-500">برای کرایه، مشتری را انتخاب کنید.</p>}
        {shipping && saleType !== 'wholesale' && <p role="alert" className="mt-2 text-red-700">کرایه برای عمده است؛ نوع فروش را اصلاح کنید یا کرایه را بردارید.</p>}
      </div>}
      {showShipping && <ShippingEditor sale={{ date: Date.now(), saleType, customerId: customerId || undefined, customerName: customers?.find(c => c.id === customerId)?.name, lines, total, paid }} prepared={shipping} onPrepared={setShipping} onClose={() => setShowShipping(false)} />}
      <div data-empty={!lines.length} className="sale-commit-bar mt-3 flex items-center gap-2 border-t border-slate-200 bg-white p-3 pb-4">
        <div className="flex-1">
          <p className="text-xs text-slate-500">{shipping ? 'مبلغ کفش (کرایه جدا)' : 'قابل پرداخت'}</p>
          <p className="text-2xl font-bold text-teal-700">{fmtMoney(total)}</p>
          {remainder > 0 && <p className="text-xs font-bold text-red-600">قرض: {fmtMoney(remainder)}</p>}
        </div>
        <button
          onClick={hold}
          disabled={!lines.length || pending}
          className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800 active:bg-amber-100 disabled:opacity-40"
        >
          معطل
        </button>
        <button
          onClick={save}
          disabled={!lines.length || pending || stockInvalid}
          className="rounded-xl bg-teal-700 px-5 py-3 text-lg font-bold text-white active:bg-teal-800 disabled:opacity-40"
        >
          {pending ? 'در حال ثبت…' : 'ثبت فروش'}
        </button>
      </div>
      </section>
      </div>
      </fieldset>
      {pickerFor != null &&
        (() => {
          const p = productMap.get(pickerFor)
          const vs = (variants ?? [])
            .filter((v) => v.productId === pickerFor)
            .sort((a, b) => a.color.localeCompare(b.color) || parseNum(a.size) - parseNum(b.size))
          if (!p) return null
          if (pickerMode === 'choice' && p.carton?.items.length) {
            const pairs = p.carton.items.reduce((s, it) => s + it.qty, 0)
            const avail = cartonsInStock(p)
            const n = cartonCountOf(p.id!)
            return (
              <Modal title={`${p.name}`} onClose={() => setPickerFor(null)}>
                <div className="mb-2 flex items-center justify-center gap-3 rounded-xl bg-slate-50 p-2">
                  <button
                    className="h-9 w-9 rounded-full bg-white font-bold"
                    onClick={() => setCartonCount(p.id!, n - 1)}
                    disabled={n <= 1}
                  >
                    −
                  </button>
                  <span className="text-lg font-bold">{fmtNum(n)} کارتن</span>
                  <button
                    className="h-9 w-9 rounded-full bg-white font-bold"
                    onClick={() => setCartonCount(p.id!, Math.min(n + 1, avail))}
                    disabled={avail <= 0 || n >= avail}
                  >
                    ＋
                  </button>
                </div>
                <button
                  disabled={avail <= 0 || n > avail}
                  onClick={() => {
                    addCartonSale(p, n)
                    setPickerFor(null)
                  }}
                  className="mb-2 w-full rounded-xl bg-teal-700 p-4 text-right font-bold text-white active:bg-teal-800 disabled:opacity-40"
                >
                  <span className="block text-lg">
                    {fmtNum(n)} کارتن ({fmtNum(pairs * n)} جوړه)
                  </span>
                  <span className="text-sm font-normal opacity-90">
                    {avail > 0 ? `${fmtNum(avail)} کارتن باقی‌مانده پس از سبد` : 'کارتن کامل دیگری موجود نیست'}
                    <span className="block">پس از این انتخاب: {fmtNum(Math.max(0, avail - n))} کارتن باقی می‌ماند</span>
                    {p.carton.price ? ` · قیمت کارتنی هر کارتن: ${fmtMoney(p.carton.price)}` : ''}
                  </span>
                </button>
                {n > avail && <p role="alert" className="mb-2 text-sm font-bold text-red-700">تعداد کارتن از باقی‌مانده بیشتر است؛ تعداد را کم کنید یا نیم کارتن انتخاب کنید.</p>}
                <button
                  onClick={() => setPickerMode('half')}
                  className="w-full rounded-xl bg-amber-100 p-4 text-right font-bold text-amber-800 active:bg-amber-200"
                >
                  <span className="block text-lg">نیم کارتن ({fmtNum(Math.round(pairs / 2))} جوړه)</span>
                  <span className="text-sm font-normal">سایزها را خودتان تا نصف کارتن انتخاب کنید</span>
                </button>
              </Modal>
            )
          }
          if (pickerMode === 'half' && p.carton?.items.length) {
            const pairs = p.carton.items.reduce((s, it) => s + it.qty, 0)
            const target = Math.round(pairs / 2)
            const filled = vs.reduce((s, v) => s + (halfQtys[v.id!] ?? 0), 0)
            const halfInvalid = vs.some(v => !Number.isInteger(halfQtys[v.id!] ?? 0) || (halfQtys[v.id!] ?? 0) > remainingQty(v))
            const setQ = (id: number, q: number) =>
              setHalfQtys((hq) => ({ ...hq, [id]: Math.max(0, q) }))
            return (
              <Modal title={`نیم کارتن — ${p.name}`} onClose={() => setPickerFor(null)}>
                <p
                  className={`mb-2 rounded-xl p-2 text-center text-sm font-bold ${
                    filled === target ? 'bg-teal-50 text-teal-700' : filled > target ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {filled === target
                    ? `پوره شد: ${fmtNum(target)} جوړه`
                    : filled > target
                      ? `${fmtNum(filled - target)} جوړه زیادتر از نیم کارتن!`
                      : `${fmtNum(filled)} از ${fmtNum(target)} جوړه`}
                </p>
                {vs.map((v) => (
                  <div key={v.id} className="mb-1 flex flex-wrap items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-sm font-bold text-slate-800">
                      {v.size} <span className="font-normal text-slate-500">{v.color}</span>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        className="h-8 w-8 rounded-full bg-slate-200 font-bold"
                        aria-label={`کاهش نیم کارتن ${v.size} ${v.color}`}
                        onClick={() => setQ(v.id!, (halfQtys[v.id!] ?? 0) - 1)}
                      >
                        −
                      </button>
                      <input
                        className="w-12 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
                        inputMode="numeric"
                        aria-label={`تعداد نیم کارتن ${v.size} ${v.color}`}
                        value={halfQtys[v.id!] ?? 0}
                        onChange={(e) => setQ(v.id!, parseNum(e.target.value) || 0)}
                      />
                      <button
                        className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800"
                        aria-label={`افزایش نیم کارتن ${v.size} ${v.color}`}
                        disabled={remainingQty(v) <= (halfQtys[v.id!] ?? 0)}
                        onClick={() => setQ(v.id!, (halfQtys[v.id!] ?? 0) + 1)}
                      >
                        ＋
                      </button>
                    </div>
                    <div className="w-full"><StockSelectionSummary stock={v.stockQty} selected={selectedQty(v.id!) + (halfQtys[v.id!] ?? 0)} /></div>
                  </div>
                ))}
                <div className="mt-3">
                  <PrimaryBtn
                    disabled={filled !== target || halfInvalid}
                    onClick={() => {
                      if (halfInvalid || filled !== target) return
                      setLines((ls) => {
                        let out = [...ls]
                        for (const v of vs) {
                          const q = halfQtys[v.id!] ?? 0
                          if (q <= 0) continue
                          const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
                          const i = out.findIndex((l) => l.variantId === v.id)
                          if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + q } : l))
                          else out.push({ variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: q, unitPrice: price })
                        }
                        return out
                      })
                      setPickerFor(null)
                    }}
                  >
                    ✓ افزودن نیم کارتن به فاکتور
                  </PrimaryBtn>
                </div>
              </Modal>
            )
          }
          return (
            <Modal title={`انتخاب سایز — ${p.name}`} onClose={() => setPickerFor(null)}>
              {vs.map((v) => (
                <button
                  key={v.id}
                  disabled={remainingQty(v) <= 0}
                  onClick={() => {
                    addLine(v)
                    setPickerFor(null)
                  }}
                  className="mb-1 flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-3 text-right active:bg-teal-50 disabled:opacity-40"
                >
                  <span className="text-lg font-bold text-slate-800">
                    {v.size} <span className="text-sm font-normal text-slate-500">{v.color}</span>
                  </span>
                  <span className="text-left text-sm">
                    <StockSelectionSummary stock={v.stockQty} selected={selectedQty(v.id!)} />
                    <span className="text-slate-500">{fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}</span>
                  </span>
                </button>
              ))}
            </Modal>
          )
        })()}
    </Shell>
  )
}

export default NewSaleModal
