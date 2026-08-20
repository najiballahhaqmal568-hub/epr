import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Supplier } from '../../db'
import { addOpeningDebt } from '../../lib/ops'
import { fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Empty } from '../../components/ui'

/** تاریخچهٔ کامل حساب یک تأمین‌کننده یا صراف */
export function SupplierDetailModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [showDebt, setShowDebt] = useState(false)
  const [debtStr, setDebtStr] = useState('')
  const [debtNote, setDebtNote] = useState('')
  const live = useLiveQuery(() => db.suppliers.get(supplier.id!), [supplier.id])
  const purchases = useLiveQuery(
    () => db.purchases.where('supplierId').equals(supplier.id!).filter((p) => !p.deleted).toArray(),
    [supplier.id]
  )
  const hawalas = useLiveQuery(() => db.purchases.filter((p) => !p.deleted && p.sarrafId === supplier.id).toArray(), [supplier.id])
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'supplier' && p.partyId === supplier.id).toArray(),
    [supplier.id]
  )
  const sarrafPays = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.via === 'sarraf' && p.sarrafId === supplier.id).toArray(),
    [supplier.id]
  )
  const returns = useLiveQuery(
    () => db.returns.filter((r) => !r.deleted && r.kind === 'supplier' && r.partyId === supplier.id).toArray(),
    [supplier.id]
  )

  type Ev = { date: number; label: string; sub?: string; amount: number; plus: boolean }
  const events: Ev[] = []
  purchases?.forEach((p) => {
    const hawala = p.sarrafAmount ?? 0
    const rem = p.total - p.paid - hawala
    events.push({
      date: p.date,
      label: `خرید ${p.received === false ? '(در راه)' : ''}`,
      sub: `مجموع ${fmtMoney(p.total)} · نقد ${fmtMoney(p.paid)}${hawala > 0 ? ` · حواله ${fmtMoney(hawala)}` : ''}`,
      amount: rem,
      plus: rem > 0
    })
  })
  hawalas?.forEach((p) => {
    events.push({
      date: p.date,
      label: `حواله برای ${p.supplierName}`,
      amount: p.sarrafAmount ?? 0,
      plus: true
    })
  })
  payments?.forEach((p) => {
    if (p.amount < 0) {
      // بیلانس اولیه / قرض قبلی: قرض ما را بالا برده است
      events.push({ date: p.date, label: p.note ?? 'قرض قبلی', amount: -p.amount, plus: true })
    } else {
      const sarrafAmount = p.via === 'sarraf' ? (p.sarrafAmount ?? p.amount) : 0
      const cashAmount = p.amount - sarrafAmount
      events.push({
        date: p.date,
        label: p.via === 'sarraf'
          ? cashAmount > 0
            ? `پرداخت ترکیبی با ${p.sarrafName ?? 'صراف'}`
            : `پرداخت از طریق صراف ${p.sarrafName ?? ''}`
          : 'پرداخت نقدی',
        sub: cashAmount > 0 && sarrafAmount > 0
          ? `صندوق ${fmtMoney(cashAmount)} · صراف ${fmtMoney(sarrafAmount)}${p.note ? ` · ${p.note}` : ''}`
          : p.note,
        amount: p.amount,
        plus: false
      })
    }
  })
  sarrafPays?.forEach((p) => {
    events.push({ date: p.date, label: `حواله برای ${p.partyName}`, amount: p.sarrafAmount ?? p.amount, plus: true })
  })
  returns?.forEach((r) => {
    if (r.settlement === 'reduceDebt') {
      events.push({ date: r.date, label: `مرجوعی جنس (${r.reason})`, amount: r.amount, plus: false })
    }
  })
  events.sort((a, b) => b.date - a.date)

  const bal = live?.balance ?? supplier.balance
  return (
    <Modal title={supplier.kind === 'sarraf' ? `💱 ${supplier.name}` : supplier.name} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">{bal > 0 ? 'قرض ما' : bal < 0 ? 'طلب ما (پیشکی)' : 'حساب تصفیه است'}</p>
        <p className={`text-2xl font-bold ${bal > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(bal))}</p>
      </div>
      {!showDebt ? (
        <button className="mb-3 w-full rounded-xl bg-amber-100 py-2 text-sm font-bold text-amber-800" onClick={() => setShowDebt(true)}>
          ＋ ثبت قرض قبلی (پیش از اپ)
        </button>
      ) : (
        <div className="mb-3 rounded-xl border border-amber-200 p-3">
          <p className="mb-2 text-xs text-slate-500">قرض خریدهای گذشته — در خرید، مفاد و صندوق حساب نمی‌شود.</p>
          <Field label="مبلغ قرض قبلی">
            <input className={inputCls} inputMode="numeric" value={debtStr} onChange={(e) => setDebtStr(e.target.value)} />
          </Field>
          <Field label="یادداشت (اختیاری)">
            <input className={inputCls} value={debtNote} onChange={(e) => setDebtNote(e.target.value)} placeholder="مثلاً بابت حمل گذشته" />
          </Field>
          <PrimaryBtn
            disabled={parseNum(debtStr) <= 0}
            onClick={async () => {
              await addOpeningDebt('supplier', supplier.id!, supplier.name, parseNum(debtStr), debtNote)
              setDebtStr('')
              setDebtNote('')
              setShowDebt(false)
            }}
          >
            ثبت قرض قبلی
          </PrimaryBtn>
        </div>
      )}
      <p className="mb-2 text-sm font-bold text-slate-700">تاریخچهٔ حساب</p>
      {events.length === 0 && <Empty text="هنوز سندی ثبت نشده." />}
      <div className="max-h-96 overflow-y-auto">
        {events.map((e, i) => (
          <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
            <div>
              <p className="font-bold text-slate-700">{e.label}</p>
              {e.sub && <p className="text-xs text-slate-400">{e.sub}</p>}
              <p className="text-xs text-slate-400">{fmtDate(e.date)}</p>
            </div>
            <span className={`font-bold ${e.plus ? 'text-red-600' : 'text-teal-700'}`}>
              {e.plus ? '+' : '−'}
              {fmtMoney(Math.abs(e.amount))}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">قرمز = قرض ما زیاد شد · سبز = پرداخت/کم شد</p>
    </Modal>
  )
}

export default SupplierDetailModal
