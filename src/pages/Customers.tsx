import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../db'
import { fmtNum, fmtMoney, fmtDateShort, startOfDay } from '../lib/format'
import { inputCls, Fab, Empty, Card } from '../components/ui'
import FamilyDetail from './customers/FamilyDetail'
import CustomerModal from './customers/CustomerModal'
import CustomerDetail from './customers/CustomerDetail'

type SortKey = 'name' | 'added' | 'debt' | 'promise' | 'quiet'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'حرف (الف–ی)' },
  { id: 'added', label: 'تازه ثبت‌شده' },
  { id: 'debt', label: 'بیشترین قرض' },
  { id: 'promise', label: 'وعدهٔ نزدیک' },
  { id: 'quiet', label: 'دیر آمده' }
]

export default function Customers() {
  const [view, setView] = useState<'retail' | 'wholesale'>('retail')
  const [showNew, setShowNew] = useState(false)
  const [selected, setSelected] = useState<Customer | null>(null)
  const [familySel, setFamilySel] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  // چیدمان انتخابی یادش می‌ماند
  const [sort, setSort] = useState<SortKey>(() => (localStorage.getItem('custSort') as SortKey) || 'name')
  const chooseSort = (k: SortKey) => {
    setSort(k)
    localStorage.setItem('custSort', k)
  }

  const customers = useLiveQuery(() => db.customers.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const inView = customers?.filter((c) => (c.type ?? 'retail') === view) ?? []
  const filtered = inView.filter(
    (c) => !search || c.name.includes(search) || (c.phone ?? '').includes(search) || (c.family ?? '').includes(search)
  )
  const viewDebt = inView.reduce((s, c) => s + Math.max(0, c.balance), 0)

  // آخرین معاملهٔ هر مشتری — برای «دیر آمده»
  const lastSeen = useLiveQuery(async () => {
    const [sales, payments] = await Promise.all([
      db.sales.filter((x) => !x.deleted && typeof x.customerId === 'number').toArray(),
      db.payments.filter((x) => !x.deleted && x.partyType === 'customer').toArray()
    ])
    const m = new Map<number, number>()
    const put = (id: number, d: number) => m.set(id, Math.max(m.get(id) ?? 0, d))
    for (const x of sales) put(x.customerId!, x.date)
    for (const x of payments) put(x.partyId, x.date)
    return m
  }, [])

  const seenOf = (c: Customer) => lastSeen?.get(c.id!) ?? 0
  // مشتریان قدیمی تاریخ ثبت ندارند — شمارهٔ ردیف همان ترتیب ثبت است
  const addedOf = (c: Customer) => c.createdAt ?? (c.id ?? 0)
  // وعده‌ای که نزدیک‌تر است اول؛ کسی که وعده ندارد آخر
  const promiseOf = (c: Customer) => (c.balance > 0 && c.promiseDate ? c.promiseDate : Number.MAX_SAFE_INTEGER)

  const byName = (a: string, b: string) => a.localeCompare(b, 'fa')

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

  // خانواده و تک‌نفره در یک فهرست چیده می‌شوند — وگرنه چیدمان فقط داخل هر
  // گروه کار می‌کرد و خانواده‌ها همیشه اول می‌آمدند
  const famDebtOf = (ms: Customer[]) => ms.reduce((s, m) => s + Math.max(0, m.balance), 0)

  type Row =
    | { kind: 'family'; key: string; fam: string; members: Customer[] }
    | { kind: 'single'; key: string; c: Customer }

  const rows: Row[] = [
    ...[...families.entries()].map(([fam, members]) => ({ kind: 'family' as const, key: `f-${fam}`, fam, members })),
    ...singles.map((c) => ({ kind: 'single' as const, key: `c-${c.id}`, c }))
  ]

  // هر سطر — چه خانواده و چه یک نفر — با همین چهار عدد سنجیده می‌شود
  const rowName = (r: Row) => (r.kind === 'family' ? r.fam : r.c.name)
  const rowAdded = (r: Row) => (r.kind === 'family' ? Math.max(...r.members.map(addedOf)) : addedOf(r.c))
  const rowDebt = (r: Row) => (r.kind === 'family' ? famDebtOf(r.members) : Math.max(0, r.c.balance))
  const rowPromise = (r: Row) => (r.kind === 'family' ? Math.min(...r.members.map(promiseOf)) : promiseOf(r.c))
  const rowSeen = (r: Row) => (r.kind === 'family' ? Math.max(...r.members.map(seenOf)) : seenOf(r.c))

  const sortedRows = [...rows].sort((a, b) => {
    // برابر که شدند، نام تصمیم می‌گیرد — تا ترتیب همیشه یکسان و قابل پیش‌بینی بماند
    const tie = byName(rowName(a), rowName(b))
    if (sort === 'added') return rowAdded(b) - rowAdded(a) || tie
    if (sort === 'debt') return rowDebt(b) - rowDebt(a) || tie
    if (sort === 'promise') return rowPromise(a) - rowPromise(b) || tie
    if (sort === 'quiet') return rowSeen(a) - rowSeen(b) || tie
    return tie
  })

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
      <div className="mt-2 flex gap-1 overflow-x-auto pb-1">
        <span className="shrink-0 self-center text-xs text-slate-400">چیدمان:</span>
        {SORTS.map((o) => (
          <button
            key={o.id}
            onClick={() => chooseSort(o.id)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              sort === o.id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {filtered.length === 0 && <Empty text="مشتری‌ای در این دفتر ثبت نشده." />}
        {sortedRows.map((r) =>
          r.kind === 'single' ? (
            customerRow(r.c)
          ) : (
            <Card key={r.key} onClick={() => setFamilySel(r.fam)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">👨‍👩‍👦 خانوادهٔ {r.fam}</p>
                  <p className="text-xs text-slate-500">{r.members.map((m) => m.name).join('، ')}</p>
                </div>
                <div className="text-left">
                  <p className={`font-bold ${famDebtOf(r.members) > 0 ? 'text-red-600' : 'text-teal-700'}`}>
                    {fmtMoney(famDebtOf(r.members))}
                  </p>
                  <p className="text-xs text-slate-400">قرض خانواده · {fmtNum(r.members.length)} نفر</p>
                </div>
              </div>
            </Card>
          )
        )}
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
