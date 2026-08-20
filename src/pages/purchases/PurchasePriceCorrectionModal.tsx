import { useState } from 'react'
import type { Purchase } from '../../db'
import { correctPurchasePrices } from '../../lib/ops'
import { fmtMoney, fmtNum, parseNum } from '../../lib/format'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'

export default function PurchasePriceCorrectionModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const [prices, setPrices] = useState(() => purchase.lines.map((line) => String(line.unitCost)))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const correctedPrices = prices.map((price) => Math.round(parseNum(price)))
  const valid = correctedPrices.every((price) => price > 0)
  const newTotal = purchase.lines.reduce((sum, line, index) => sum + line.qty * correctedPrices[index], 0)
  const hawala = purchase.sarrafAmount ?? 0
  const oldDebt = Math.max(0, purchase.total - purchase.paid - hawala)
  const newDebt = Math.max(0, newTotal - purchase.paid - hawala)
  const changed = valid && purchase.lines.some((line, index) => line.unitCost !== correctedPrices[index])

  async function save() {
    if (!purchase.id || !valid || !changed || saving) return
    setSaving(true)
    setError('')
    try {
      await correctPurchasePrices(purchase.id, correctedPrices)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'اصلاح قیمت خرید انجام نشد')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`اصلاح قیمت خرید — ${purchase.supplierName}`} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm leading-6 text-amber-900">
        فقط قیمت خرید را اصلاح کنید. تعداد گدام و پول پرداخت‌شده تغییر نمی‌کند؛ مجموع فاکتور، قرض تأمین‌کننده و قیمت تمام‌شده دوباره حساب می‌شود.
      </div>

      <div className="space-y-3">
        {purchase.lines.map((line, index) => (
          <div key={`${line.variantId}-${index}`} className="rounded-xl border border-slate-200 p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-800">{line.productName}</p>
                <p className="text-xs text-slate-500">
                  سایز {line.size || '—'} · {line.color || 'بدون رنگ'} · {fmtNum(line.qty)} جوړه
                </p>
              </div>
              <p className="whitespace-nowrap text-xs text-slate-500">قبلی: {fmtMoney(line.unitCost)}</p>
            </div>
            <Field label="قیمت درست هر جوړه">
              <input
                className={inputCls}
                inputMode="numeric"
                value={prices[index]}
                onChange={(event) => setPrices((current) => current.map((price, i) => (i === index ? event.target.value : price)))}
              />
            </Field>
          </div>
        ))}
      </div>

      <div className="my-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between text-slate-600"><span>جمع قبلی</span><span>{fmtMoney(purchase.total)}</span></div>
        <div className="mt-1 flex justify-between font-bold text-slate-900"><span>جمع درست</span><span>{fmtMoney(newTotal)}</span></div>
        <div className="mt-1 flex justify-between text-slate-600"><span>پول پرداخت/حواله (ثابت)</span><span>{fmtMoney(purchase.paid + hawala)}</span></div>
        <div className="mt-1 flex justify-between font-bold text-red-700"><span>قرض تأمین‌کننده</span><span>{fmtMoney(oldDebt)} ← {fmtMoney(newDebt)}</span></div>
      </div>

      {!valid && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">قیمت هر جنس باید بیشتر از صفر باشد.</p>}
      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold leading-6 text-red-700">{error}</p>}

      <PrimaryBtn onClick={() => void save()} disabled={!valid || !changed || saving}>
        {saving ? 'در حال ثبت…' : changed ? 'ثبت اصلاح قیمت' : 'قیمت تغییر نکرده است'}
      </PrimaryBtn>
    </Modal>
  )
}
