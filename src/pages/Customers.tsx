import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../db'
import { addPayment } from '../lib/ops'
import { fmtMoney, fmtDate, fmtDateShort, parseNum, toDateInput, fromDateInput, startOfDay } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

export default function Customers() {
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [search, setSearch] = useState('')

  const customers = useLiveQuery(() => db.customers.orderBy('name').toArray(), [])
  const filtered = customers?.filter((c) => !search || c.name.includes(search) || (c.phone ?? '').includes(search))

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">مشتریان</h1>
      <input className={inputCls} placeholder="جستجو..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-3">
        {filtered?.length === 0 && <Empty text="مشتری‌ای ثبت نشده." />}
        {filtered?.map((c) => {
          const overdue = c.balance > 0 && c.promiseDate && c.promiseDate < startOfDay()
          return (
          <Card key={c.id} onClick={() => setSelected(c)}>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-bold text-slate-800">
                  {c.flag === 'good' && '⭐ '}
                  {c.flag === 'bad' && '⚠️ '}
                  {c.name}{' '}
                  <span className="text-xs font-normal text-slate-400">({c.type === 'retail' ? 'پرچون' : 'عمده'})</span>
                </p>
                {c.phone && <p className="text-sm text-slate-500" dir="ltr">{c.phone}</p>}
                {overdue && <p className="text-xs font-bold text-red-600">وعده گذشته: {fmtDateShort(c.promiseDate!)}</p>}
                {!overdue && c.balance > 0 && c.promiseDate && (
                  <p className="text-xs text-slate-500">وعده: {fmtDateShort(c.promiseDate)}</p>
                )}
              </div>
              <div className="text-left">
                <p className={`font-bold ${c.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(c.balance))}</p>
                <p className="text-xs text-slate-400">{c.balance > 0 ? 'قرضدار' : c.balance < 0 ? 'بستانکار' : 'تصفیه'}</p>
              </div>
            </div>
          </Card>
          )
        })}
      </div>
      <Fab onClick={() => setShowNew(true)} label="مشتری جدید" />
      {showNew && <CustomerModal customer={null} onClose={() => setShowNew(false)} />}
      {selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

function CustomerModal({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [type, setType] = useState<'retail' | 'wholesale'>(customer?.type ?? 'retail')
  const [flag, setFlag] = useState<'good' | 'bad' | ''>(customer?.flag ?? '')
  const [promise, setPromise] = useState(customer?.promiseDate ? toDateInput(customer.promiseDate) : '')

  return (
    <Modal title={customer ? 'ویرایش مشتری' : 'مشتری جدید'} onClose={onClose}>
      <Field label="نام *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="شماره تلفن">
        <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="نوع مشتری">
        <select className={inputCls} value={type} onChange={(e) => setType(e.target.value as 'retail' | 'wholesale')}>
          <option value="retail">پرچون</option>
          <option value="wholesale">عمده</option>
        </select>
      </Field>
      <Field label="نشان مشتری">
        <select className={inputCls} value={flag} onChange={(e) => setFlag(e.target.value as 'good' | 'bad' | '')}>
          <option value="">عادی</option>
          <option value="good">⭐ مشتری خوب</option>
          <option value="bad">⚠️ قرض بد / احتیاط</option>
        </select>
      </Field>
      {customer && customer.balance > 0 && (
        <Field label="وعدهٔ پرداخت قرض">
          <input type="date" className={inputCls} value={promise} onChange={(e) => setPromise(e.target.value)} />
        </Field>
      )}
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          const data = {
            name: name.trim(),
            phone: phone.trim(),
            type,
            flag: (flag || null) as 'good' | 'bad' | null,
            promiseDate: promise ? fromDateInput(promise) : undefined
          }
          if (customer?.id) await db.customers.update(customer.id, data)
          else await db.customers.add({ ...data, balance: 0 })
          onClose()
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [showPay, setShowPay] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [amount, setAmount] = useState('')

  const live = useLiveQuery(() => db.customers.get(customer.id!), [customer.id])
  const sales = useLiveQuery(() => db.sales.where('customerId').equals(customer.id!).reverse().sortBy('date'), [customer.id])
  const payments = useLiveQuery(
    () => db.payments.where('[partyType+partyId]').equals(['customer', customer.id!]).reverse().sortBy('date'),
    [customer.id]
  )

  const c = live ?? customer

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
        <button className="flex-1 rounded-xl bg-slate-100 py-2 font-bold text-slate-700" onClick={() => setShowEdit(true)}>
          ویرایش
        </button>
      </div>

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

      <p className="mb-2 font-bold text-slate-700">تاریخچه</p>
      {payments?.map((p) => (
        <div key={`p${p.id}`} className="mb-2 flex justify-between rounded-lg bg-teal-50 p-2 text-sm">
          <span>دریافت پول — {fmtDate(p.date)}</span>
          <span className="font-bold text-teal-700">{fmtMoney(p.amount)}</span>
        </div>
      ))}
      {sales?.map((s) => (
        <div key={`s${s.id}`} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
          <div className="flex justify-between">
            <span>خرید — {fmtDate(s.date)}</span>
            <span className="font-bold">{fmtMoney(s.total)}</span>
          </div>
          {s.total - s.paid > 0 && <p className="text-xs text-red-600">قرضی: {fmtMoney(s.total - s.paid)}</p>}
        </div>
      ))}
      {!sales?.length && !payments?.length && <p className="text-sm text-slate-400">تاریخچه‌ای موجود نیست.</p>}

      {showEdit && <CustomerModal customer={c} onClose={() => setShowEdit(false)} />}
    </Modal>
  )
}
