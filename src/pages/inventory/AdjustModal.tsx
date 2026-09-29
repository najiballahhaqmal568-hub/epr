import { useState } from 'react'
import { useSubmitOnce } from '../../lib/useSubmitOnce'
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
  const submit = useSubmitOnce()

  const live = useLiveQuery(() => db.variants.get(variant.id!), [variant.id])
  const v = live ?? variant

  // موجودی بعد از این تعدیل — برای پیش‌نمایش
  const preview = reason === 'correction' ? parseNum(qty) : v.stockQty - parseNum(qty)

  const history = useLiveQuery(() => db.adjustments.where('variantId').equals(variant.id!).filter((a) => !a.deleted).reverse().sortBy('date'), [variant.id])

  const reasons: { id: AdjustReason; label: string; sign: -1 | 1 | 0 }[] = [
    { id: 'damaged', label: 'داغمه (کم شود)', sign: -1 },
    { id: 'lost', label: 'مفقود (کم شود)', sign: -1 },
    { id: 'correction', label: 'تصحیح شمار (تنظیم دقیق)', sign: 0 }
  ]

  async function save() {
    const n = parseNum(qty)
    if (n < 0 || !Number.isInteger(n)) return setError('تعداد جوړه را عدد صحیح وارد کنید')
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
      <p className="mb-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-sm text-slate-700">
        موجودی فعلی: <b>{fmtNum(v.stockQty)}</b> {v.sku && <span className="text-slate-400">· کود: {v.sku}</span>}
      </p>
      <Field label="دلیل">
        <select
          className={inputCls}
          value={reason}
          onChange={(e) => {
            const r = e.target.value as AdjustReason
            setReason(r)
            // در «تصحیح شمار» عدد یعنی موجودی درست، نه تعداد کم‌شده — پس با موجودی فعلی شروع می‌کند
            setQty(r === 'correction' ? String(v.stockQty) : '1')
          }}
        >
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={reason === 'correction' ? 'شمارش واقعی (موجودی درست بعد از شمارش)' : 'چند جوړه کم شود؟'}>
        <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>
      {/* نتیجه پیش از ثبت دیده شود تا اشتباه نشود */}
      {qty.trim() !== '' && (
        <section className="-mt-2 mb-3 rounded-2xl border border-blue-100 bg-blue-50 p-3 text-center text-sm" aria-label="اثر تعدیل">
          <span className="block text-xs font-bold text-slate-500">اثر تعدیل بر موجودی</span>
          موجودی: <span className="font-bold">{fmtNum(v.stockQty)}</span> ←{' '}
          <span className={`text-lg font-bold ${preview < 0 ? 'text-red-600' : 'text-blue-700'}`}>{fmtNum(preview)}</span>
          {preview < 0 && <span className="block text-xs font-bold text-red-600">موجودی منفی می‌شود!</span>}
        </section>
      )}
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="mb-2 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700" role="alert">{error}</p>}
      <PrimaryBtn onClick={() => void submit.run(save)} disabled={submit.busy}>ثبت تعدیل</PrimaryBtn>

      {history && history.length > 0 && (
        <>
          <p className="mt-4 mb-2 font-bold text-slate-800">تعدیل‌های قبلی</p>
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
