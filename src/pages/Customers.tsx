import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../db'
import { addPayment, addOpeningDebt } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate, fmtDateShort, parseNum, toDateInput, fromDateInput, startOfDay } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

export default function Customers() {
  const [view, setView] = useState<'retail' | 'wholesale'>('retail')
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [familySel, setFamilySel] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const inView = customers?.filter((c) => (c.type ?? 'retail') === view) ?? []
  const filtered = inView.filter(
    (c) => !search || c.name.includes(search) || (c.phone ?? '').includes(search) || (c.family ?? '').includes(search)
  )
  const viewDebt = inView.reduce((s, c) => s + Math.max(0, c.balance), 0)

  // در دفتر پرچون، اعضای یک خانواده یکجا دیده می‌شوند
  const families = new Map<string, Customer[]>()
  const singles: Customer[] = []
  for (const c of filtered) {
    if (view === 'retail' && c.family?.trim()) {
      const k = c.family.trim()
      families.set(k, [...(families.get(k) ?? []), c])
    } else {
      singles.push(c)
    }
  }

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

  const customerRow = (c: Customer) => {
    const overdue = c.balance > 0 && c.promiseDate && c.promiseDate < startOfDay()
    return (
      <Card key={c.id} onClick={() => setSelected(c)}>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-bold text-slate-800">
              {c.flag === 'good' && '⭐ '}
              {c.flag === 'bad' && '⚠️ '}
              {c.name}
              {c.family?.trim() && <span className="mr-1 text-xs font-normal text-slate-400">({c.family.trim()})</span>}
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
  }

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">مشتریان</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('retail')} className={tabCls('retail')}>
          دفتر پرچون
        </button>
        <button onClick={() => setView('wholesale')} className={tabCls('wholesale')}>
          دفتر عمده
        </button>
      </div>
      <div className="mb-3 rounded-xl bg-white p-3 shadow-sm">
        <div className="flex justify-between">
          <span className="text-sm text-slate-500">مجموع قرض {view === 'retail' ? 'پرچون' : 'عمده'}</span>
          <span className="font-bold text-red-600">{fmtMoney(viewDebt)}</span>
        </div>
      </div>
      <input className={inputCls} placeholder="جستجو نام، تلفن یا خانواده..." value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-3">
        {filtered.length === 0 && <Empty text="مشتری‌ای در این دفتر ثبت نشده." />}
        {[...families.entries()].map(([fam, members]) => {
          const famDebt = members.reduce((s, m) => s + Math.max(0, m.balance), 0)
          return (
            <Card key={`f-${fam}`} onClick={() => setFamilySel(fam)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">👨‍👩‍👦 خانوادهٔ {fam}</p>
                  <p className="text-xs text-slate-500">{members.map((m) => m.name).join('، ')}</p>
                </div>
                <div className="text-left">
                  <p className={`font-bold ${famDebt > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(famDebt)}</p>
                  <p className="text-xs text-slate-400">قرض خانواده · {fmtNum(members.length)} نفر</p>
                </div>
              </div>
            </Card>
          )
        })}
        {singles.map(customerRow)}
      </div>
      <Fab onClick={() => setShowNew(true)} label="مشتری جدید" />
      {showNew && <CustomerModal customer={null} defaultType={view} onClose={() => setShowNew(false)} />}
      {selected && <CustomerDetail customer={selected} onClose={() => setSelected(null)} />}
      {familySel && (
        <FamilyDetail
          family={familySel}
          members={families.get(familySel) ?? []}
          onMember={(c) => {
            setFamilySel(null)
            setSelected(c)
          }}
          onClose={() => setFamilySel(null)}
        />
      )}
    </div>
  )
}

/** دفتر خانواده: قرض مجموعی + تاریخچهٔ همهٔ اعضا با جزئیات کامل */
function FamilyDetail({
  family,
  members,
  onMember,
  onClose
}: {
  family: string
  members: Customer[]
  onMember: (c: Customer) => void
  onClose: () => void
}) {
  const ids = members.map((m) => m.id!)
  const nameOf = new Map(members.map((m) => [m.id!, m.name]))
  const sales = useLiveQuery(
    () => db.sales.filter((s) => !s.deleted && s.customerId !== undefined && ids.includes(s.customerId)).reverse().sortBy('date'),
    [family]
  )
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'customer' && ids.includes(p.partyId)).reverse().sortBy('date'),
    [family]
  )
  const famDebt = members.reduce((s, m) => s + Math.max(0, m.balance), 0)

  type Ev = { date: number; who: string; label: string; sub?: string; amount: number; red: boolean }
  const events: Ev[] = []
  sales?.forEach((s) => {
    const rem = s.total - s.paid
    events.push({
      date: s.date,
      who: nameOf.get(s.customerId!) ?? '',
      label: s.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، '),
      sub: `مجموع ${fmtMoney(s.total)} · نقد ${fmtMoney(s.paid)}`,
      amount: rem,
      red: rem > 0
    })
  })
  payments?.forEach((p) => {
    if (p.amount < 0) {
      events.push({ date: p.date, who: nameOf.get(p.partyId) ?? '', label: p.note ?? 'قرض قبلی', amount: -p.amount, red: true })
    } else {
      events.push({ date: p.date, who: nameOf.get(p.partyId) ?? '', label: 'دریافت پول', amount: p.amount, red: false })
    }
  })
  events.sort((a, b) => b.date - a.date)

  return (
    <Modal title={`👨‍👩‍👦 خانوادهٔ ${family}`} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">قرض مجموعی خانواده</p>
        <p className={`text-2xl font-bold ${famDebt > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(famDebt)}</p>
      </div>
      <p className="mb-1 text-sm font-bold text-slate-700">اعضا</p>
      <div className="mb-3">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => onMember(m)}
            className="mb-1 flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-right active:bg-teal-50"
          >
            <span className="font-bold text-slate-800">{m.name}</span>
            <span className={`text-sm font-bold ${m.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.max(0, m.balance))}</span>
          </button>
        ))}
      </div>
      <p className="mb-1 text-sm font-bold text-slate-700">تاریخچهٔ خانواده (همه اعضا)</p>
      {events.length === 0 && <p className="text-sm text-slate-400">هنوز سندی ثبت نشده.</p>}
      <div className="max-h-80 overflow-y-auto">
        {events.map((e, i) => (
          <div key={i} className="border-b border-slate-100 py-2 text-sm last:border-0">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">{e.who}</span>
              <span className={`font-bold ${e.red ? 'text-red-600' : 'text-teal-700'}`}>
                {e.red ? '+' : '−'}
                {fmtMoney(e.amount)}
              </span>
            </div>
            <p className="text-slate-600">{e.label}</p>
            {e.sub && <p className="text-xs text-slate-400">{e.sub}</p>}
            <p className="text-xs text-slate-400">{fmtDate(e.date)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">قرمز = قرض زیاد شد · سبز = پرداخت</p>
    </Modal>
  )
}

function CustomerModal({
  customer,
  defaultType,
  onClose
}: {
  customer: Customer | null
  defaultType?: 'retail' | 'wholesale'
  onClose: () => void
}) {
  const [name, setName] = useState(customer?.name ?? '')
  const [phone, setPhone] = useState(customer?.phone ?? '')
  const [type, setType] = useState<'retail' | 'wholesale'>(customer?.type ?? defaultType ?? 'retail')
  const [family, setFamily] = useState(customer?.family ?? '')
  const families = useLiveQuery(
    async () => [...new Set((await db.customers.filter((c) => !c.deleted && Boolean(c.family?.trim())).toArray()).map((c) => c.family!.trim()))],
    []
  )
  const [flag, setFlag] = useState<'good' | 'bad' | ''>(customer?.flag ?? '')
  const [promise, setPromise] = useState(customer?.promiseDate ? toDateInput(customer.promiseDate) : '')
  const [openingDebt, setOpeningDebt] = useState('')

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
      {type === 'retail' && (
        <Field label="خانواده (اختیاری — اعضای یک خانواده یکجا دیده می‌شوند)">
          <input className={inputCls} value={family} onChange={(e) => setFamily(e.target.value)} list="family-list" placeholder="مثلاً خانوادهٔ حاجی کریم" />
          <datalist id="family-list">
            {families?.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </Field>
      )}
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
      {!customer && (
        <>
          <Field label="قرض قبلی (اختیاری)">
            <input className={inputCls} inputMode="numeric" value={openingDebt} onChange={(e) => setOpeningDebt(e.target.value)} placeholder="۰" />
          </Field>
          {parseNum(openingDebt) > 0 && (
            <p className="-mt-2 mb-3 text-xs text-slate-400">قرض فروش‌های گذشته — در فروش، مفاد و صندوق حساب نمی‌شود.</p>
          )}
        </>
      )}
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          const data = {
            name: name.trim(),
            phone: phone.trim(),
            type,
            family: type === 'retail' && family.trim() ? family.trim() : undefined,
            flag: (flag || null) as 'good' | 'bad' | null,
            promiseDate: promise ? fromDateInput(promise) : undefined
          }
          if (customer?.id) await db.customers.update(customer.id, data)
          else {
            const id = (await db.customers.add({ ...data, balance: 0 })) as number
            const debt = parseNum(openingDebt)
            if (debt > 0) await addOpeningDebt('customer', id, data.name, debt)
          }
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

      <p className="mb-2 font-bold text-slate-700">تاریخچه</p>
      {payments?.map((p) =>
        p.amount < 0 ? (
          // قرض قبلی / بیلانس اولیه: قرض را بالا برده است
          <div key={`p${p.id}`} className="mb-2 flex justify-between rounded-lg bg-amber-50 p-2 text-sm">
            <span>
              {p.note === 'بیلانس اولیه' ? 'بیلانس اولیه' : (p.note ?? 'قرض قبلی')} — {fmtDate(p.date)}
            </span>
            <span className="font-bold text-red-600">+{fmtMoney(-p.amount)}</span>
          </div>
        ) : (
          <div key={`p${p.id}`} className="mb-2 flex justify-between rounded-lg bg-teal-50 p-2 text-sm">
            <span>دریافت پول — {fmtDate(p.date)}</span>
            <span className="font-bold text-teal-700">{fmtMoney(p.amount)}</span>
          </div>
        )
      )}
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
