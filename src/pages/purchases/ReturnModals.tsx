import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Purchase, type Product, type Supplier, type ReturnLine } from '../../db'
import { addSupplierReturn } from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../../lib/format'
import QtyControl from '../../components/QtyControl'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/** مرجوعی مستقیم از روی یک خرید: اجناس همان فاکتور با قیمت خرید همان فاکتور */
export function PurchaseReturnModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('خرابی جنس')
  const [settlement, setSettlement] = useState<'reduceDebt' | 'cashRefund'>('reduceDebt')
  const [error, setError] = useState('')
  const supplier = useLiveQuery(() => db.suppliers.get(purchase.supplierId), [purchase.supplierId])

  const amount = purchase.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitCost, 0)

  async function save() {
    const lines: ReturnLine[] = purchase.lines
      .map((l, i) => ({
        variantId: l.variantId,
        productName: l.productName,
        size: l.size,
        color: l.color,
        qty: qtys[i] ?? 0,
        unitPrice: l.unitCost,
        restock: false
      }))
      .filter((l) => l.qty > 0)
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    try {
      await addSupplierReturn({
        date: Date.now(),
        kind: 'supplier',
        partyId: purchase.supplierId,
        partyName: purchase.supplierName,
        refId: purchase.id,
        lines,
        reason,
        settlement,
        amount
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={`مرجوعی به ${purchase.supplierName}`} onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">خرید {fmtDate(purchase.date)}</p>
      {purchase.lines.map((l, i) => (
        <div key={i} className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-2">
          <div className="text-sm">
            <p className="font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <p className="text-slate-500">
              خریده: {fmtNum(l.qty)} × {fmtMoney(l.unitCost)}
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
      <Field label="دلیل">
        <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>خرابی جنس</option>
          <option>جنس اشتباه</option>
          <option>کیفیت پایین</option>
          <option>دیگر</option>
        </select>
      </Field>
      <Field label="تصفیه پول">
        <select className={inputCls} value={settlement} onChange={(e) => setSettlement(e.target.value as 'reduceDebt' | 'cashRefund')}>
          <option value="reduceDebt">کم شدن از قرض ما{supplier ? ` (قرض فعلی: ${fmtMoney(supplier.balance)})` : ''}</option>
          <option value="cashRefund">دریافت نقدی به صندوق</option>
        </select>
      </Field>
      <p className="mb-3 font-bold text-slate-800">مبلغ مرجوعی: {fmtMoney(amount)}</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={amount <= 0}>
        ثبت مرجوعی
      </PrimaryBtn>
    </Modal>
  )
}

export function SupplierReturnModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('خرابی جنس')
  const [settlement, setSettlement] = useState<'reduceDebt' | 'cashRefund'>(supplier.balance > 0 ? 'reduceDebt' : 'cashRefund')
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

  const amount = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)

  async function save() {
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    try {
      await addSupplierReturn({
        date: Date.now(),
        kind: 'supplier',
        partyId: supplier.id,
        partyName: supplier.name,
        lines,
        reason,
        settlement,
        amount
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={`مرجوعی به ${supplier.name}`} onClose={onClose}>
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
                disabled={v.stockQty <= 0}
                onClick={() => {
                  setLines((ls) => {
                    if (ls.some((l) => l.variantId === v.id)) return ls
                    return [
                      ...ls,
                      { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: v.purchasePrice, restock: false }
                    ]
                  })
                  setSearch('')
                }}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50 disabled:opacity-40"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">{fmtNum(v.stockQty)} موجود</span>
              </button>
            )
          })}
        </div>
      )}

      {lines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1 text-sm">
            <p className="font-bold">
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
            <QtyControl qty={l.qty} onChange={(q) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: q } : x)))} />
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <Field label="دلیل">
        <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>خرابی جنس</option>
          <option>جنس اشتباه</option>
          <option>کیفیت پایین</option>
          <option>دیگر</option>
        </select>
      </Field>
      <Field label="تصفیه پول">
        <select className={inputCls} value={settlement} onChange={(e) => setSettlement(e.target.value as 'reduceDebt' | 'cashRefund')}>
          <option value="reduceDebt">کم شدن از قرض ما (قرض فعلی: {fmtMoney(supplier.balance)})</option>
          <option value="cashRefund">دریافت نقدی به صندوق</option>
        </select>
      </Field>
      <p className="mb-3 font-bold text-slate-800">مبلغ مرجوعی: {fmtMoney(amount)}</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={!lines.length}>
        ثبت مرجوعی
      </PrimaryBtn>
    </Modal>
  )
}
