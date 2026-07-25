import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../db'
import { fmtNum, fmtMoney, fmtDateShort, startOfDay } from '../lib/format'
import { inputCls, Fab, Empty, Card } from '../components/ui'
import FamilyDetail from './customers/FamilyDetail'
import CustomerModal from './customers/CustomerModal'
import CustomerDetail from './customers/CustomerDetail'

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
