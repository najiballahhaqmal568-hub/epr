import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type SaleLine, type Variant, type Product } from '../../db'
import { addExchange } from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/** تبادله: جنس برگشتی + جنس جدید؛ صندوق فقط تفاوت را می‌بیند */
export function ExchangeModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [newLines, setNewLines] = useState<SaleLine[]>([])
  const [search, setSearch] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [cashTouched, setCashTouched] = useState(false)
  const [error, setError] = useState('')

  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  const returnAmount = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)
  const newTotal = newLines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const diff = newTotal - returnAmount
  const cashIn = cashTouched ? parseNum(cashStr) : Math.max(0, diff)
  // اگر جنس جدید ارزان‌تر است، تفاوت نقد به مشتری برمی‌گردد (اثر خالص صندوق = تفاوت)
  const paid = diff >= 0 ? returnAmount + cashIn : newTotal
  const remainder = newTotal - paid

  function addLine(v: Variant) {
    const p = productMap.get(v.productId)!
    const price = sale.saleType === 'retail' ? v.retailPrice : v.wholesalePrice
    setNewLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: price }]
    })
    setSearch('')
  }

  async function save() {
    const retLines = sale.lines
      .map((l, i) => ({ ...l, qty: qtys[i] ?? 0, restock }))
      .filter((l) => l.qty > 0)
    if (!retLines.length) return setError('جنس برگشتی را انتخاب کنید')
    if (!newLines.length) return setError('جنس جدید را انتخاب کنید')
    if (remainder > 0 && !sale.customerId) return setError('این فروش مشتری ندارد — تفاوت باید نقد گرفته شود')
    try {
      await addExchange(
        {
          date: Date.now(),
          kind: 'customer',
          partyId: sale.customerId,
          partyName: sale.customerName ?? 'مشتری نقدی',
          refId: sale.id,
        saleType: sale.saleType,
          lines: retLines,
          reason: 'تبادله',
          settlement: 'cashRefund',
          amount: returnAmount
        },
        {
          date: Date.now(),
          customerId: sale.customerId,
          customerName: sale.customerName,
          saleType: sale.saleType,
          lines: newLines,
          total: newTotal,
          paid
        }
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="تبادلهٔ جنس" onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">
        {sale.customerName || 'مشتری نقدی'} — {fmtDate(sale.date)}
      </p>

      <p className="mb-1 text-sm font-bold text-slate-700">۱) جنس برگشتی</p>
      {sale.lines.map((l, i) => (
        <div key={i} className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-2">
          <div className="text-sm">
            <p className="font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <p className="text-slate-500">
              فروخته: {fmtNum(l.qty)} × {fmtMoney(l.unitPrice)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQtys((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1) }))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={qtys[i] ?? 0}
              onChange={(e) => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, Math.max(0, parseNum(e.target.value) || 0)) }))}
            />
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1) }))}>
              ＋
            </button>
          </div>
        </div>
      ))}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4" />
        جنس برگشتی سالم است — به گدام برگردد
      </label>

      <p className="mb-1 text-sm font-bold text-slate-700">۲) جنس جدید</p>
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
                disabled={v.stockQty <= 0 && !sale.lines.some((l) => l.variantId === v.id)}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50 disabled:opacity-40"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">
                  {fmtNum(v.stockQty)} عدد · {fmtMoney(sale.saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}
                </span>
              </button>
            )
          })}
        </div>
      )}
      {newLines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1">
            <p className="text-sm font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              value={l.unitPrice}
              onChange={(e) => setNewLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت فی جوړه</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={l.qty}
              onChange={(e) => setNewLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseNum(e.target.value) || 1) } : x)))}
            />
            <button className="mr-1 text-red-500" onClick={() => setNewLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="mt-3 rounded-xl bg-amber-50 p-3">
        <div className="flex justify-between text-slate-600">
          <span>ارزش جنس برگشتی</span>
          <span>{fmtMoney(returnAmount)}</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>ارزش جنس جدید</span>
          <span>{fmtMoney(newTotal)}</span>
        </div>
        {diff > 0 && (
          <>
            <div className="flex justify-between font-bold text-slate-800">
              <span>تفاوت — از مشتری بگیرید</span>
              <span>{fmtMoney(diff)}</span>
            </div>
            <Field label="دریافتی نقدی">
              <input
                className={inputCls}
                inputMode="numeric"
                value={cashTouched ? cashStr : String(diff)}
                onFocus={() => {
                  if (!cashTouched) {
                    setCashTouched(true)
                    setCashStr(String(diff))
                  }
                }}
                onChange={(e) => setCashStr(e.target.value)}
              />
            </Field>
            {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض مشتری): {fmtMoney(remainder)}</p>}
          </>
        )}
        {diff < 0 && <p className="font-bold text-amber-700">بازگشت نقدی به مشتری: {fmtMoney(-diff)}</p>}
        {diff === 0 && newTotal > 0 && <p className="font-bold text-teal-700">برابر — بدون پرداخت ✓</p>}
      </div>

      {error && <p className="my-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3">
        <PrimaryBtn onClick={save} disabled={returnAmount <= 0 || !newLines.length}>
          ثبت تبادله
        </PrimaryBtn>
      </div>
    </Modal>
  )
}

export default ExchangeModal
