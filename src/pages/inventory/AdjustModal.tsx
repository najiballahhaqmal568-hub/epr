import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Product, type Variant, type AdjustReason } from '../../db'
import { addAdjustment } from '../../lib/ops'
import { fmtNum, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

export function AdjustModal({ variant, product, onClose }: { variant: Variant; product: Product; onClose: () => void }) {
  const [reason, setReason] = useState<AdjustReason>('damaged')
  const [qty, setQty] = useState('1')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const live = useLiveQuery(() => db.variants.get(variant.id!), [variant.id])
  const v = live ?? variant

  const history = useLiveQuery(() => db.adjustments.where('variantId').equals(variant.id!).filter((a) => !a.deleted).reverse().sortBy('date'), [variant.id])

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

export default AdjustModal
