import { useRef, useState } from 'react'
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
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const customer = useLiveQuery(
    async () => (sale.customerId ? await db.customers.get(sale.customerId) : undefined),
    [sale.customerId]
  )

  const amount = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)

  async function save() {
    if (savingRef.current) return
    const lines = sale.lines
      .map((l, i) => ({ ...l, qty: qtys[i] ?? 0, restock }))
      .filter((l) => l.qty > 0)
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    if (settlement === 'reduceDebt' && !sale.customerId) return setError('این فروش مشتری ندارد — بازپرداخت نقدی را انتخاب کنید')
    savingRef.current = true
    setSaving(true)
    setError('')
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
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title="مرجوعی فروش" onClose={() => { if (!savingRef.current) onClose() }}>
      <div className="sale-document-heading">
        <strong>{sale.customerName || 'مشتری نقدی'}</strong>
        <p>فروش {sale.id ? `#${fmtNum(sale.id)} · ` : ''}{fmtDate(sale.date)}</p>
      </div>
      <fieldset disabled={saving} className="sale-correction-fields" aria-busy={saving}>
        <section className="sale-correction-group" aria-label="جنس برگشتی">
          <h3>۱) جنس برگشتی</h3>
          <p className="sale-correction-help">تعداد برگشتی را از هر جنس انتخاب کنید.</p>
          {sale.lines.map((l, i) => (
            <div key={i} className="sale-cart-line">
              <div className="text-sm">
                <p className="font-bold">
                  {l.productName} {l.size} {l.color}
                </p>
                <p className="text-slate-500">
                  فروخته: {fmtNum(l.qty)} × {fmtMoney(l.unitPrice)}
                </p>
              </div>
              <div className="sale-quantity-actions">
                <button className="quantity-step" aria-label={`کم کردن برگشتی ${l.productName} ${l.size} ${l.color}`} disabled={(qtys[i] ?? 0) <= 0} onClick={() => setQtys((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1) }))}>
                  −
                </button>
                <input
                  className="quantity-value"
                  aria-label={`تعداد برگشتی ${l.productName} ${l.size} ${l.color}`}
                  inputMode="numeric"
                  value={qtys[i] ?? 0}
                  onChange={(e) => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, Math.max(0, parseNum(e.target.value) || 0)) }))}
                />
                <button className="quantity-step" aria-label={`زیاد کردن برگشتی ${l.productName} ${l.size} ${l.color}`} disabled={(qtys[i] ?? 0) >= l.qty} onClick={() => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1) }))}>
                  ＋
                </button>
              </div>
            </div>
          ))}
        </section>
        <section className="sale-correction-group" aria-label="وضعیت جنس">
          <h3>۲) دلیل و وضعیت جنس</h3>
          <Field label="دلیل مرجوعی">
            <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
              <option>سایز غلط</option>
              <option>خرابی جنس</option>
              <option>تبدیلی</option>
              <option>پشیمانی مشتری</option>
              <option>دیگر</option>
            </select>
          </Field>

          <label className="sale-correction-check">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            جنس سالم است — به گدام برگردد (اگر داغمه است تیک را بردارید)
          </label>
          <p className="sale-correction-help">{restock ? 'تعداد انتخاب‌شده به موجودی گدام اضافه می‌شود.' : 'جنس داغمه ثبت می‌شود؛ موجودی گدام زیاد نمی‌شود.'}</p>
        </section>
        <section className="sale-correction-group" aria-label="تصفیه مرجوعی">
          <h3>۳) تصفیه مرجوعی</h3>
          <Field label="تصفیه پول">
            <select className={inputCls} value={settlement} onChange={(e) => setSettlement(e.target.value as 'cashRefund' | 'reduceDebt')}>
              <option value="cashRefund">بازپرداخت نقدی</option>
              {sale.customerId && <option value="reduceDebt">کاهش قرض مشتری</option>}
            </select>
          </Field>
          {customer && <p className="sale-correction-help">قرض فعلی: {fmtMoney(customer.balance)}</p>}
          <div className="sale-correction-summary">
            <dl><div><dt>مبلغ مرجوعی</dt><dd>{fmtMoney(amount)}</dd></div></dl>
            <p>{settlement === 'cashRefund' ? 'این مبلغ نقداً از صندوق به مشتری برمی‌گردد.' : 'این مبلغ از قرض مشتری کم می‌شود؛ پولی از صندوق خارج نمی‌شود.'}</p>
          </div>
        </section>
      </fieldset>
      <p className="sale-correction-help">اگر مشتری جنس دیگری می‌خواهد، به جای مرجوعی از دکمهٔ «تبادله» استفاده کنید.</p>
      {error && <p role="alert" className="sale-correction-error">{error}</p>}
      {saving && <p role="status" className="sale-correction-help">در حال ثبت… تا پایان ثبت، این صفحه باز می‌ماند.</p>}
      <PrimaryBtn onClick={save} disabled={saving || amount <= 0}>
        {saving ? 'در حال ثبت…' : 'ثبت مرجوعی'}
      </PrimaryBtn>
    </Modal>
  )
}

export default ReturnModal
