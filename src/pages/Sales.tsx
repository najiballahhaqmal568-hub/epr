import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type SaleLine, type Variant, type Product } from '../db'
import { addSale, deleteSale } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

export default function Sales() {
  const [showNew, setShowNew] = useState(false)
  const sales = useLiveQuery(() => db.sales.orderBy('date').reverse().limit(100).toArray(), [])

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">فروش</h1>
      {sales?.length === 0 && <Empty text="هنوز فروشی ثبت نشده." />}
      {sales?.map((s) => {
        const remainder = s.total - s.paid
        return (
          <Card key={s.id}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-800">
                  {s.customerName || 'مشتری نقدی'}{' '}
                  <span className="text-xs font-normal text-slate-400">
                    ({s.saleType === 'retail' ? 'پرچون' : 'عمده'})
                  </span>
                </p>
                <p className="text-xs text-slate-500">{fmtDate(s.date)}</p>
              </div>
              <div className="text-left">
                <p className="font-bold text-teal-700">{fmtMoney(s.total)}</p>
                {remainder > 0 && <p className="text-xs text-red-600">باقی: {fmtMoney(remainder)}</p>}
              </div>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              {s.lines.map((l) => `${l.productName} ${l.size} ×${fmtNum(l.qty)}`).join('، ')}
            </p>
            <button
              className="mt-1 text-xs text-red-500"
              onClick={async () => {
                if (confirm('این فروش حذف شود؟ اجناس به گدام برمی‌گردد.')) await deleteSale(s.id!)
              }}
            >
              حذف فروش
            </button>
          </Card>
        )
      })}
      <Fab onClick={() => setShowNew(true)} label="فروش جدید" />
      {showNew && <NewSaleModal onClose={() => setShowNew(false)} />}
    </div>
  )
}

function NewSaleModal({ onClose }: { onClose: () => void }) {
  const [saleType, setSaleType] = useState<'retail' | 'wholesale'>('retail')
  const [customerId, setCustomerId] = useState<number | ''>('')
  const [lines, setLines] = useState<SaleLine[]>([])
  const [paidStr, setPaidStr] = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [])
  const products = useLiveQuery(() => db.products.toArray(), [])
  const variants = useLiveQuery(() => db.variants.toArray(), [])

  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants && products
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color}`
            return search
              .trim()
              .split(/\s+/)
              .every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  const total = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const paid = paidTouched ? parseNum(paidStr) : total
  const remainder = total - paid

  function addLine(v: Variant) {
    const p = productMap.get(v.productId)!
    const price = saleType === 'retail' ? v.retailPrice : v.wholesalePrice
    setLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: price }]
    })
    setSearch('')
  }

  async function save() {
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    if (remainder > 0 && !customerId) return setError('برای فروش قرضی باید مشتری انتخاب شود')
    const customer = customers?.find((c) => c.id === customerId)
    try {
      await addSale({
        date: Date.now(),
        customerId: customerId || undefined,
        customerName: customer?.name,
        saleType,
        lines,
        total,
        paid
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="فروش جدید" onClose={onClose}>
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

      <Field label="مشتری (برای فروش قرضی لازمی)">
        <select className={inputCls} value={customerId} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">مشتری نقدی</option>
          {customers?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="جستجوی جنس">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((v) => {
            const p = productMap.get(v.productId)!
            return (
              <button
                key={v.id}
                onClick={() => addLine(v)}
                disabled={v.stockQty <= 0}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50 disabled:opacity-40"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">
                  {v.stockQty <= 0 ? 'ناموجود' : `${fmtNum(v.stockQty)} عدد · ${fmtMoney(saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}`}
                </span>
              </button>
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
            <span className="w-6 text-center font-bold">{fmtNum(l.qty)}</span>
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
        <div className="flex justify-between font-bold text-slate-800">
          <span>مجموع</span>
          <span>{fmtMoney(total)}</span>
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
        {remainder < 0 && <p className="text-sm font-bold text-amber-600">بازگشت به مشتری: {fmtMoney(-remainder)}</p>}
      </div>

      {error && <p className="my-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3">
        <PrimaryBtn onClick={save} disabled={!lines.length}>
          ثبت فروش
        </PrimaryBtn>
      </div>
    </Modal>
  )
}
