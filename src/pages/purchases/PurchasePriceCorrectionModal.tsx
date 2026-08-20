import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Product, type Purchase, type PurchaseLine } from '../../db'
import { correctPurchase, correctPurchasePrices } from '../../lib/ops'
import { fmtMoney, fmtNum, parseNum } from '../../lib/format'
import QtyControl from '../../components/QtyControl'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'

export default function PurchasePriceCorrectionModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const [lines, setLines] = useState<PurchaseLine[]>(() => purchase.lines.map((line) => ({ ...line })))
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const products = useLiveQuery(() => db.products.filter((product) => !product.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((variant) => !variant.deleted).toArray(), [])

  const productMap = new Map<number, Product>()
  products?.forEach((product) => productMap.set(product.id!, product))
  const matches =
    search.trim() && variants
      ? variants
          .filter((variant) => {
            const product = productMap.get(variant.productId)
            if (!product) return false
            const haystack = `${product.name} ${product.brand ?? ''} ${variant.size} ${variant.color} ${variant.sku ?? ''}`
            return search.trim().split(/\s+/).every((word) => haystack.includes(word))
          })
          .slice(0, 12)
      : []

  const corrected = lines.map((line) => ({
    ...line,
    qty: Math.round(line.qty),
    unitCost: Math.round(line.unitCost)
  }))
  const valid = corrected.length > 0 && corrected.every((line) => line.qty > 0 && line.unitCost > 0)
  const newTotal = corrected.reduce((sum, line) => sum + line.qty * line.unitCost, 0)
  const hawala = purchase.sarrafAmount ?? 0
  const oldDebt = Math.max(0, purchase.total - purchase.paid - hawala)
  const newDebt = Math.max(0, newTotal - purchase.paid - hawala)
  const changed =
    valid &&
    (corrected.length !== purchase.lines.length ||
      corrected.some((line, index) => {
        const old = purchase.lines[index]
        return !old || line.variantId !== old.variantId || line.qty !== old.qty || line.unitCost !== old.unitCost
      }))
  const structureChanged =
    corrected.length !== purchase.lines.length ||
    corrected.some((line, index) => {
      const old = purchase.lines[index]
      return !old || line.variantId !== old.variantId || line.qty !== old.qty
    })
  const priceOnly = changed && !structureChanged

  function addVariant(variantId: number) {
    const variant = variants?.find((item) => item.id === variantId)
    const product = variant ? productMap.get(variant.productId) : undefined
    if (!variant || !product) return
    setLines((current) => {
      const index = current.findIndex((line) => line.variantId === variantId)
      if (index >= 0) return current.map((line, i) => (i === index ? { ...line, qty: line.qty + 1 } : line))
      return [
        ...current,
        {
          variantId,
          productName: product.name,
          size: variant.size,
          color: variant.color,
          qty: 1,
          unitCost: variant.purchasePrice
        }
      ]
    })
    setSearch('')
  }

  async function save() {
    if (!purchase.id || !valid || !changed || saving) return
    setSaving(true)
    setError('')
    try {
      if (priceOnly) await correctPurchasePrices(purchase.id, corrected.map((line) => line.unitCost))
      else {
        await correctPurchase(
          purchase.id,
          corrected.map((line) => ({ variantId: line.variantId, qty: line.qty, unitCost: line.unitCost }))
        )
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اصلاح خرید انجام نشد')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`اصلاح خرید — ${purchase.supplierName}`} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        جنس، سایز/رنگ، تعداد و قیمت خرید قابل اصلاح است. تأمین‌کننده، پرداخت نقدی و حواله ثابت می‌مانند. برای جایگزینی، جنس اشتباه را حذف و جنس درست را جستجو و اضافه کنید.
      </div>
      <div className="mb-3 rounded-xl bg-teal-50 p-3 text-sm leading-6 text-teal-900">
        اگر بعد از این خرید فروش شده باشد، اصلاحِ فقط قیمت مجاز است: تعداد فروش، گدام، صندوق و حساب مشتری تغییر نمی‌کند؛ تنها قرض تأمین‌کننده، قیمت موجودی و مفاد راپورها اصلاح می‌شود. تغییر جنس یا تعداد بعد از فروش برای امنیت مسدود می‌ماند.
      </div>

      <Field label="جستجوی جنس برای افزودن یا جایگزینی">
        <input className={inputCls} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((variant) => {
            const product = productMap.get(variant.productId)!
            return (
              <button
                key={variant.id}
                onClick={() => addVariant(variant.id!)}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50"
              >
                <span>{product.name} — {variant.size} {variant.color}</span>
                <span className="text-xs text-slate-500">افزودن</span>
              </button>
            )
          })}
        </div>
      )}

      {lines.map((line, index) => (
        <div key={line.variantId} className="mb-3 rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex items-start justify-between gap-3">
            <div>
              <p className="font-bold text-slate-800">{line.productName}</p>
              <p className="text-xs text-slate-500">سایز {line.size || '—'} · {line.color || 'بدون رنگ'}</p>
            </div>
            <button className="text-xs font-bold text-red-600" onClick={() => setLines((current) => current.filter((_, i) => i !== index))}>
              حذف از خرید
            </button>
          </div>
          <div className="grid grid-cols-[auto_1fr] items-end gap-3">
            <div>
              <p className="mb-1 text-xs font-bold text-slate-600">تعداد</p>
              <QtyControl qty={line.qty} onChange={(qty) => setLines((current) => current.map((item, i) => (i === index ? { ...item, qty } : item)))} />
            </div>
            <Field label="قیمت درست هر جوړه">
              <input
                className={inputCls}
                inputMode="numeric"
                value={line.unitCost}
                onChange={(event) =>
                  setLines((current) => current.map((item, i) => (i === index ? { ...item, unitCost: parseNum(event.target.value) } : item)))
                }
              />
            </Field>
          </div>
          <p className="mt-1 text-left text-xs font-bold text-slate-600">{fmtNum(line.qty)} × {fmtMoney(line.unitCost)} = {fmtMoney(line.qty * line.unitCost)}</p>
        </div>
      ))}

      {!lines.length && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">حداقل یک جنس باید در خرید بماند.</p>}

      <div className="my-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-600"><span>جمع قبلی</span><span>{fmtMoney(purchase.total)}</span></div>
        <div className="mt-1 flex justify-between font-bold text-slate-900"><span>جمع درست</span><span>{fmtMoney(newTotal)}</span></div>
        <div className="mt-1 flex justify-between text-slate-600"><span>پرداخت/حواله (ثابت)</span><span>{fmtMoney(purchase.paid + hawala)}</span></div>
        <div className="mt-1 flex justify-between font-bold text-red-700"><span>قرض تأمین‌کننده</span><span>{fmtMoney(oldDebt)} ← {fmtMoney(newDebt)}</span></div>
      </div>

      {!valid && lines.length > 0 && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">تعداد و قیمت هر جنس باید بیشتر از صفر باشد.</p>}
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold leading-6 text-red-700">{error}</p>}

      <PrimaryBtn onClick={() => void save()} disabled={!valid || !changed || saving}>
        {saving ? 'در حال ثبت…' : priceOnly ? 'ثبت اصلاح قیمت خرید' : changed ? 'ثبت اصلاح کامل خرید' : 'معلومات تغییر نکرده است'}
      </PrimaryBtn>
    </Modal>
  )
}
