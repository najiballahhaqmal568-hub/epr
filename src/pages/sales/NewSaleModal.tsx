import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type SaleLine, type Variant, type Product } from '../../db'
import { addSale } from '../../lib/ops'
import { fmtNum, fmtMoney, parseNum, fromDateInput } from '../../lib/format'
import { saveSaleDraft, type SaleDraft } from '../../lib/saleDrafts'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

export function NewSaleModal({
  onClose,
  onSaved,
  onHeld,
  draft
}: {
  onClose: () => void
  onSaved?: (sale: Sale) => void
  onHeld?: (draft: SaleDraft) => void
  draft?: SaleDraft
}) {
  const [saleType, setSaleType] = useState<'retail' | 'wholesale'>(draft?.saleType ?? 'retail')
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
  const [pickerFor, setPickerFor] = useState<number | null>(null)
  // در عمده اول می‌پرسد: کارتن کامل یا نیم کارتن (خانه‌پری سایزها تا نصف کارتن)
  const [pickerMode, setPickerMode] = useState<'choice' | 'single' | 'half'>('single')
  const [halfQtys, setHalfQtys] = useState<Record<number, number>>({})

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
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
    .slice(0, 6)

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
    return Math.min(
      ...p.carton!.items.map((it) => {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        return v ? Math.floor(v.stockQty / it.qty) : 0
      })
    )
  }

  function addCartonSale(p: Product) {
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    setLines((ls) => {
      let out = [...ls]
      for (const it of p.carton!.items) {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        if (!v) continue
        const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
        const i = out.findIndex((l) => l.variantId === v.id)
        if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + it.qty } : l))
        else out.push({ variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: it.qty, unitPrice: price })
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
      const diff = pairSum - p.carton.price
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

  function addLine(v: Variant, n = 1) {
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
          bookPage
        },
        draft
      )
      onHeld?.(held)
      onClose()
    } catch {
      setError('پیش‌نویس در این دستگاه ذخیره نشد؛ فضای مرورگر را بررسی کنید')
    }
  }

  async function save() {
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
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
    try {
      const id = await addSale(sale)
      sale.id = id
      // صفحهٔ فعلیِ مشتری همان صفحه‌ای می‌شود که تازه در آن نوشتیم،
      // تا فروش بعدی خودش همان را پیشنهاد کند
      if (sale.bookPage && customer?.id && customer.bookPage?.trim() !== sale.bookPage) {
        await db.customers.update(customer.id, { bookPage: sale.bookPage })
      }
      if (onSaved) onSaved(sale)
      else onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="فروش جدید" onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}
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

      {selectedCustomer ? (
        <div className="mb-3 flex items-center justify-between rounded-xl bg-teal-50 p-2.5">
          <div>
            <p className="font-bold text-teal-800">👤 {selectedCustomer.name}</p>
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
          <span className="text-sm font-bold text-slate-600">💵 فروش نقدی</span>
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

      {quickProducts.length > 0 && !search.trim() && (
        <>
          <p className="mb-1 text-sm font-bold text-slate-700">🔥 پرفروش‌ها — ضربه بزنید و سایز را انتخاب کنید</p>
          <div className="mb-3 grid grid-cols-3 gap-2">
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
                  className="rounded-xl border border-slate-200 bg-white p-2 text-center active:bg-teal-50"
                >
                  {e.p.photo ? (
                    <img src={e.p.photo} alt="" className="mx-auto mb-1 h-12 w-12 rounded-lg object-cover" />
                  ) : (
                    <span className="mb-1 block text-2xl">👞</span>
                  )}
                  <p className="truncate text-xs font-bold text-slate-800">{e.p.name}</p>
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

      <Field label="جستجوی جنس">
        <input
          className={inputCls}
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="نام، سایز، رنگ یا کود..."
        />
      </Field>
      {cartonProducts.map((p) => {
        const pairs = p.carton!.items.reduce((s, it) => s + it.qty, 0)
        const avail = cartonsInStock(p)
        return (
          <button
            key={`c${p.id}`}
            onClick={() => addCartonSale(p)}
            disabled={avail <= 0}
            className="mb-2 flex w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-right font-bold text-amber-800 active:bg-amber-100 disabled:opacity-40"
          >
            <span>
              📦 {p.name} — ＋ یک کارتن ({fmtNum(pairs)} جوړه)
              {saleType === 'wholesale' && p.carton!.price ? <span className="block text-xs font-normal">قیمت کارتنی: {fmtMoney(p.carton!.price)}</span> : null}
            </span>
            <span className="text-sm font-normal">{avail > 0 ? `${fmtNum(avail)} کارتن موجود` : 'کارتن کامل نیست'}</span>
          </button>
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
                  disabled={v.stockQty <= 0}
                  className="flex flex-1 items-center justify-between px-3 py-2 text-right active:bg-teal-50 disabled:opacity-40"
                >
                  <span>
                    {p.name} — {v.size} {v.color}
                  </span>
                  <span className="text-sm text-slate-500">
                    {v.stockQty <= 0 ? 'ناموجود' : `${fmtNum(v.stockQty)} عدد · ${fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}`}
                  </span>
                </button>
                {/* تعداد مستقیم از نتیجهٔ جستجو — بدون باز کردن سطر */}
                {[2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => addLine(v, n)}
                    disabled={v.stockQty < n}
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

      {lines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1">
            <p className="text-sm font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              value={l.unitPrice}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت فی جوړه</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={l.qty}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseNum(e.target.value) || 1) } : x)))}
            />
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              ＋
            </button>
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

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
      <div className="sticky bottom-0 -mx-4 -mb-8 mt-3 flex items-center gap-2 border-t border-slate-200 bg-white p-3 pb-4">
        <div className="flex-1">
          <p className="text-xs text-slate-500">قابل پرداخت</p>
          <p className="text-2xl font-bold text-teal-700">{fmtMoney(total)}</p>
          {remainder > 0 && <p className="text-xs font-bold text-red-600">قرض: {fmtMoney(remainder)}</p>}
        </div>
        <button
          onClick={hold}
          disabled={!lines.length}
          className="rounded-xl border-2 border-amber-400 bg-amber-50 px-3 py-3 text-sm font-bold text-amber-800 active:bg-amber-100 disabled:opacity-40"
        >
          ⏸ معطل
        </button>
        <button
          onClick={save}
          disabled={!lines.length}
          className="rounded-xl bg-teal-700 px-5 py-3 text-lg font-bold text-white active:bg-teal-800 disabled:opacity-40"
        >
          ثبت فروش
        </button>
      </div>
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
            return (
              <Modal title={`📦 ${p.name}`} onClose={() => setPickerFor(null)}>
                <button
                  disabled={avail <= 0}
                  onClick={() => {
                    addCartonSale(p)
                    setPickerFor(null)
                  }}
                  className="mb-2 w-full rounded-xl bg-teal-700 p-4 text-right font-bold text-white active:bg-teal-800 disabled:opacity-40"
                >
                  <span className="block text-lg">📦 کارتن کامل ({fmtNum(pairs)} جوړه)</span>
                  <span className="text-sm font-normal opacity-90">
                    {avail > 0 ? `${fmtNum(avail)} کارتن موجود` : 'کارتن کامل موجود نیست'}
                    {p.carton.price ? ` · قیمت کارتنی: ${fmtMoney(p.carton.price)}` : ''}
                  </span>
                </button>
                <button
                  onClick={() => setPickerMode('half')}
                  className="w-full rounded-xl bg-amber-100 p-4 text-right font-bold text-amber-800 active:bg-amber-200"
                >
                  <span className="block text-lg">✋ نیم کارتن ({fmtNum(Math.round(pairs / 2))} جوړه)</span>
                  <span className="text-sm font-normal">سایزها را خودتان تا نصف کارتن انتخاب کنید</span>
                </button>
              </Modal>
            )
          }
          if (pickerMode === 'half' && p.carton?.items.length) {
            const pairs = p.carton.items.reduce((s, it) => s + it.qty, 0)
            const target = Math.round(pairs / 2)
            const filled = vs.reduce((s, v) => s + (halfQtys[v.id!] ?? 0), 0)
            const setQ = (id: number, q: number, max: number) =>
              setHalfQtys((hq) => ({ ...hq, [id]: Math.min(max, Math.max(0, q)) }))
            return (
              <Modal title={`✋ نیم کارتن — ${p.name}`} onClose={() => setPickerFor(null)}>
                <p
                  className={`mb-2 rounded-xl p-2 text-center text-sm font-bold ${
                    filled === target ? 'bg-teal-50 text-teal-700' : filled > target ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
                  }`}
                >
                  {filled === target
                    ? `✅ پوره شد: ${fmtNum(target)} جوړه`
                    : filled > target
                      ? `⚠️ ${fmtNum(filled - target)} جوړه زیادتر از نیم کارتن!`
                      : `${fmtNum(filled)} از ${fmtNum(target)} جوړه`}
                </p>
                {vs.map((v) => (
                  <div key={v.id} className="mb-1 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                    <span className="text-sm font-bold text-slate-800">
                      {v.size} <span className="font-normal text-slate-500">{v.color}</span>
                      <span className={`block text-xs font-normal ${v.stockQty <= 0 ? 'text-red-600' : 'text-slate-400'}`}>
                        {fmtNum(v.stockQty)} موجود
                      </span>
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        className="h-8 w-8 rounded-full bg-slate-200 font-bold"
                        onClick={() => setQ(v.id!, (halfQtys[v.id!] ?? 0) - 1, v.stockQty)}
                      >
                        −
                      </button>
                      <input
                        className="w-12 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
                        inputMode="numeric"
                        value={halfQtys[v.id!] ?? 0}
                        onChange={(e) => setQ(v.id!, parseNum(e.target.value) || 0, v.stockQty)}
                      />
                      <button
                        className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800"
                        disabled={v.stockQty <= (halfQtys[v.id!] ?? 0)}
                        onClick={() => setQ(v.id!, (halfQtys[v.id!] ?? 0) + 1, v.stockQty)}
                      >
                        ＋
                      </button>
                    </div>
                  </div>
                ))}
                <div className="mt-3">
                  <PrimaryBtn
                    disabled={filled !== target}
                    onClick={() => {
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
                  disabled={v.stockQty <= 0}
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
                    <span className={`block font-bold ${v.stockQty <= 0 ? 'text-red-600' : 'text-teal-700'}`}>
                      {v.stockQty <= 0 ? 'ناموجود' : `${fmtNum(v.stockQty)} موجود`}
                    </span>
                    <span className="text-slate-500">{fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}</span>
                  </span>
                </button>
              ))}
            </Modal>
          )
        })()}
    </Modal>
  )
}

export default NewSaleModal
