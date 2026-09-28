import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../db'
import { fmtNum, fmtMoney, fmtDateShort, startOfDay, toLatinDigits, pageOrder, familyPages } from '../lib/format'
import { inputCls, Empty } from '../components/ui'
import FamilyDetail from './customers/FamilyDetail'
import CustomerModal from './customers/CustomerModal'
import CustomerDetail from './customers/CustomerDetail'
import { useFlipList } from '../lib/useFlipList'

type SortKey = 'name' | 'page' | 'added' | 'debt' | 'promise' | 'quiet'

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'name', label: 'حرف (الف–ی)' },
  { id: 'page', label: 'صفحهٔ دفتر' },
  { id: 'added', label: 'تازه ثبت‌شده' },
  { id: 'debt', label: 'بیشترین قرض' },
  { id: 'promise', label: 'وعدهٔ نزدیک' },
  { id: 'quiet', label: 'دیر آمده' }
]

export default function Customers({ onBack }: { onBack?: () => void }) {
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
    (c) =>
      !search ||
      c.name.includes(search) ||
      (c.phone ?? '').includes(search) ||
      (c.family ?? '').includes(search) ||
      // «۱۲» بنویسید تا ببینید کدام مشتری‌ها در آن صفحهٔ دفتر اند
      (Boolean(c.bookPage?.trim()) && toLatinDigits(c.bookPage!).includes(toLatinDigits(search)))
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
  // خانواده با کوچک‌ترین صفحهٔ اعضایش می‌آید — همان جایی که در دفتر اول به چشم می‌خورد
  const rowPage = (r: Row) =>
    r.kind === 'family'
      ? r.members.map((m) => pageOrder(m.bookPage)).sort((x, y) => x.num - y.num || x.rest.localeCompare(y.rest))[0]
      : pageOrder(r.c.bookPage)

  const sortedRows = [...rows].sort((a, b) => {
    // برابر که شدند، نام تصمیم می‌گیرد — تا ترتیب همیشه یکسان و قابل پیش‌بینی بماند
    const tie = byName(rowName(a), rowName(b))
    if (sort === 'added') return rowAdded(b) - rowAdded(a) || tie
    if (sort === 'debt') return rowDebt(b) - rowDebt(a) || tie
    if (sort === 'promise') return rowPromise(a) - rowPromise(b) || tie
    if (sort === 'quiet') return rowSeen(a) - rowSeen(b) || tie
    if (sort === 'page') {
      const pa = rowPage(a)
      const pb = rowPage(b)
      return pa.num - pb.num || pa.rest.localeCompare(pb.rest) || tie
    }
    return tie
  })

  const listRef = useRef<HTMLElement>(null)
  useFlipList(listRef)

  const customerRow = (c: Customer) => {
    const overdue = c.balance > 0 && c.promiseDate && c.promiseDate < startOfDay()
    return (
      <button key={c.id} data-flip-key={`c${c.id}`} onClick={() => setSelected(c)} className="customer-row">
        <span className="customer-row-main">
          <span className="customer-row-name">
            {c.flag === 'good' && '⭐ '}
            {c.flag === 'bad' && '⚠️ '}
            {c.name}
            {c.family?.trim() && <span className="customer-row-family"> ({c.family.trim()})</span>}
          </span>
          {c.bookPage?.trim() && <small className="font-bold">📖 صفحهٔ {c.bookPage.trim()}</small>}
          {c.phone && <small dir="ltr" className="customer-row-phone">{c.phone}</small>}
          {overdue && <small className="font-bold text-red-700">وعده گذشته: {fmtDateShort(c.promiseDate!)}</small>}
          {!overdue && c.balance > 0 && c.promiseDate && <small>وعده: {fmtDateShort(c.promiseDate)}</small>}
        </span>
        <span className="customer-row-amount">
          <strong className={`inventory-money ${c.balance > 0 ? 'text-red-700' : c.balance < 0 ? 'text-teal-700' : ''}`}>{fmtMoney(Math.abs(c.balance))}</strong>
          <small>{c.balance > 0 ? 'قرضدار' : c.balance < 0 ? 'بستانکار' : 'تصفیه'}</small>
        </span>
      </button>
    )
  }

  return (
    <div className="p-4 customers-directory">
      <div className="page-heading">
        <div><h1>مشتریان</h1><p>دفتر پرچون و عمده، خانواده‌ها و صفحهٔ دفتر</p></div>
        {onBack && <button onClick={onBack} className="customers-back" aria-label="برگشت">برگشت</button>}
      </div>
      <div className="segmented mb-4" role="group" aria-label="دفتر مشتریان">
        <button onClick={() => setView('retail')} aria-pressed={view === 'retail'}>دفتر پرچون</button>
        <button onClick={() => setView('wholesale')} aria-pressed={view === 'wholesale'}>دفتر عمده</button>
      </div>
      <dl className="surface customers-summary">
        <div><dt>مجموع قرض {view === 'retail' ? 'پرچون' : 'عمده'}</dt><dd className="inventory-money text-red-700">{fmtMoney(viewDebt)}</dd></div>
        <div><dt>مشتری در این دفتر</dt><dd>{fmtNum(inView.length)}</dd></div>
      </dl>
      <section className="inventory-management" aria-label="جستجو و چیدمان مشتریان">
        <input className={inputCls} type="search" aria-label="جستجوی مشتری" placeholder="جستجو نام، تلفن، خانواده یا صفحهٔ دفتر..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <p className="inventory-section-label mt-3">چیدمان:</p>
        <div className="inventory-sorts" role="group" aria-label="چیدمان مشتریان">
          {SORTS.map((o) => (
            <button key={o.id} onClick={() => chooseSort(o.id)} aria-pressed={sort === o.id} className={sort === o.id ? 'is-selected' : ''}>
              {o.label}
            </button>
          ))}
        </div>
        <button onClick={() => setShowNew(true)} className="primary-button mt-3">＋ مشتری جدید</button>
      </section>

      {filtered.length === 0 && <Empty text={search.trim() ? 'مشتری‌ای با این جستجو پیدا نشد.' : 'مشتری‌ای در این دفتر ثبت نشده.'} hint={search.trim() ? 'نام را کوتاه‌تر بنویسید یا با شمارهٔ تلفن جستجو کنید.' : 'مشتری قرضی را اینجا بسازید تا قرضش با صفحهٔ دفتر نگه داشته شود.'} action={search.trim() ? undefined : { label: '＋ مشتری جدید', onClick: () => setShowNew(true) }} />}
      {sortedRows.length > 0 && <section ref={listRef} className="surface customers-list" aria-label="فهرست مشتریان">
        {sortedRows.map((r) =>
          r.kind === 'single' ? (
            customerRow(r.c)
          ) : (
            <button key={r.key} data-flip-key={r.key} onClick={() => setFamilySel(r.fam)} className="customer-row">
              <span className="customer-row-main">
                <span className="customer-row-name">خانوادهٔ {r.fam}</span>
                {(() => {
                  // بعضی اعضا صفحه دارند و بعضی نه — هر دو باید دیده شوند
                  const { pages } = familyPages(r.members)
                  if (!pages.length) return null
                  return <small className="font-bold">📖 صفحهٔ {pages.join('، ')}</small>
                })()}
                <small>{r.members.map((m) => m.name).join('، ')}</small>
              </span>
              <span className="customer-row-amount">
                <strong className={`inventory-money ${famDebtOf(r.members) > 0 ? 'text-red-700' : ''}`}>{fmtMoney(famDebtOf(r.members))}</strong>
                <small>قرض خانواده · {fmtNum(r.members.length)} نفر</small>
              </span>
            </button>
          )
        )}
      </section>}
      {showNew && (
        <CustomerModal
          customer={null}
          defaultType={view}
          onCreated={(c) => setSelected(c)}
          onClose={() => setShowNew(false)}
        />
      )}
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
