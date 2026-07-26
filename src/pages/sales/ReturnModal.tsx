import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../../db'
import { addCustomerReturn } from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

export function ReturnModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [reason, setReason] = useState('سایز غلط')
  const [settlement, setSettlement] = useState<'cashRefund' | 'reduceDebt'>(sale.customerId ? 'reduceDebt' : 'cashRefund')
  const [error, setError] = useState('')

  const customer = useLiveQuery(
    async () => (sale.customerId ? await db.customers.get(sale.customerId) : undefined),
    [sale.customerId]
  )

  const amount = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)

  async function save() {
    const lines = sale.lines
      .map((l, i) => ({ ...l, qty: qtys[i] ?? 0, restock }))
      .filter((l) => l.qty > 0)
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    if (settlement === 'reduceDebt' && !sale.customerId) return setError('این فروش مشتری ندارد — بازپرداخت نقدی را انتخاب کنید')
    try {
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: sale.customerId,
        partyName: sale.customerName ?? 'مشتری نقدی',
        refId: sale.id,
        saleType: sale.saleType,
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
    <Modal title="مرجوعی فروش" onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">
        {sale.customerName || 'مشتری نقدی'} — {fmtDate(sale.date)}
      </p>
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

      <Field label="دلیل مرجوعی">
        <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>سایز غلط</option>
          <option>خرابی جنس</option>
          <option>تبدیلی</option>
          <option>پشیمانی مشتری</option>
          <option>دیگر</option>
        </select>
      </Field>

      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} className="h-4 w-4" />
        جنس سالم است — به گدام برگردد (اگر داغمه است تیک را بردارید)
      </label>

      <Field label="تصفیه پول">
        <select className={inputCls} value={settlement} onChange={(e) => setSettlement(e.target.value as 'cashRefund' | 'reduceDebt')}>
          <option value="cashRefund">بازپرداخت نقدی از صندوق</option>
          {sale.customerId && <option value="reduceDebt">کم شدن از قرض مشتری{customer ? ` (قرض فعلی: ${fmtMoney(customer.balance)})` : ''}</option>}
        </select>
      </Field>

      <p className="mb-3 font-bold text-slate-800">مبلغ مرجوعی: {fmtMoney(amount)}</p>
      <p className="mb-3 text-xs text-slate-400">اگر مشتری جنس دیگری می‌خواهد، به جای مرجوعی از دکمهٔ «تبادله» استفاده کنید.</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={amount <= 0}>
        ثبت مرجوعی
      </PrimaryBtn>
    </Modal>
  )
}

export default ReturnModal
