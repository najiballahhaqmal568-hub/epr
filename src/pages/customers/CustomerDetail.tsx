import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../../db'
import { addPayment, addOpeningDebt } from '../../lib/ops'
import { fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { buildCustomerLedger } from '../../lib/ledger'
import CustomerModal from './CustomerModal'

export function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [showPay, setShowPay] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDebt, setShowDebt] = useState(false)
  const [amount, setAmount] = useState('')
  const [debtStr, setDebtStr] = useState('')
  const [debtNote, setDebtNote] = useState('')

  const live = useLiveQuery(() => db.customers.get(customer.id!), [customer.id])
  const sales = useLiveQuery(() => db.sales.where('customerId').equals(customer.id!).filter((s) => !s.deleted).reverse().sortBy('date'), [customer.id])
  const payments = useLiveQuery(
    () => db.payments.where('[partyType+partyId]').equals(['customer', customer.id!]).filter((p) => !p.deleted).reverse().sortBy('date'),
    [customer.id]
  )
  const returns = useLiveQuery(
    () => db.returns.filter((r) => !r.deleted && r.kind === 'customer' && r.partyId === customer.id).toArray(),
    [customer.id]
  )

  const c = live ?? customer
  // دفتر حساب: هر سند با قرض بعد از آن — تا معلوم شود این عدد از کجا آمد
  const ledger = buildCustomerLedger(sales ?? [], payments ?? [], returns ?? [])
  const ledgerEnd = ledger.length ? ledger[ledger.length - 1].balance : 0
  const mismatch = Math.abs(ledgerEnd - c.balance) > 0.5

  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">{c.balance > 0 ? 'قرض مشتری' : c.balance < 0 ? 'بستانکاری مشتری' : 'حساب تصفیه است'}</p>
        <p className={`text-2xl font-bold ${c.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(c.balance))}</p>
      </div>

      <div className="mb-4 flex gap-2">
        <button className="flex-1 rounded-xl bg-teal-700 py-2 font-bold text-white" onClick={() => setShowPay(true)}>
          دریافت پول
        </button>
        <button className="flex-1 rounded-xl bg-amber-100 py-2 font-bold text-amber-800" onClick={() => setShowDebt(true)}>
          قرض قبلی
        </button>
        <button className="flex-1 rounded-xl bg-slate-100 py-2 font-bold text-slate-700" onClick={() => setShowEdit(true)}>
          ویرایش
        </button>
      </div>

      {showDebt && (
        <div className="mb-4 rounded-xl border border-amber-200 p-3">
          <p className="mb-2 text-xs text-slate-500">قرض فروش‌های گذشته (پیش از اپ) — در فروش، مفاد و صندوق حساب نمی‌شود.</p>
          <Field label="مبلغ قرض قبلی">
            <input className={inputCls} inputMode="numeric" value={debtStr} onChange={(e) => setDebtStr(e.target.value)} />
          </Field>
          <Field label="یادداشت (اختیاری)">
            <input className={inputCls} value={debtNote} onChange={(e) => setDebtNote(e.target.value)} placeholder="مثلاً بابت خریدهای سال گذشته" />
          </Field>
          <PrimaryBtn
            disabled={parseNum(debtStr) <= 0}
            onClick={async () => {
              await addOpeningDebt('customer', c.id!, c.name, parseNum(debtStr), debtNote)
              setDebtStr('')
              setDebtNote('')
              setShowDebt(false)
            }}
          >
            ثبت قرض قبلی
          </PrimaryBtn>
        </div>
      )}

      {showPay && (
        <div className="mb-4 rounded-xl border border-teal-200 p-3">
          <Field label="مبلغ دریافتی">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              await addPayment({
                date: Date.now(),
                partyType: 'customer',
                partyId: c.id!,
                partyName: c.name,
                amount: parseNum(amount)
              })
              setAmount('')
              setShowPay(false)
            }}
          >
            ثبت دریافت
          </PrimaryBtn>
        </div>
      )}

      <div className="mb-2 flex items-baseline justify-between">
        <p className="font-bold text-slate-700">دفتر حساب — این عدد از کجا آمد</p>
        <span className="text-xs text-slate-400">قرض بعد از هر سند</span>
      </div>
      {mismatch && (
        <p className="mb-2 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800">
          ⚠️ جمع دفتر ({fmtMoney(ledgerEnd)}) با عدد بالا برابر نیست — با «تصفیه» یا پشتیبان‌گیری بررسی کنید.
        </p>
      )}
      {[...ledger].reverse().map((r) => (
        <div key={r.key} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-slate-800">{r.label}</p>
              <p className="text-xs text-slate-400">{fmtDate(r.date)}</p>
              {r.note && <p className="truncate text-xs text-slate-500">{r.note}</p>}
            </div>
            <div className="shrink-0 text-left">
              <p className={`font-bold ${r.delta > 0 ? 'text-red-600' : 'text-teal-700'}`}>
                {r.delta > 0 ? '+' : '−'}
                {fmtMoney(Math.abs(r.delta))}
              </p>
              <p className="text-xs text-slate-500">قرض شد: {fmtMoney(r.balance)}</p>
            </div>
          </div>
        </div>
      ))}
      {ledger.length === 0 && <p className="text-sm text-slate-400">هنوز سندی نیست.</p>}

      {showEdit && <CustomerModal customer={c} onClose={() => setShowEdit(false)} />}
    </Modal>
  )
}

export default CustomerDetail
