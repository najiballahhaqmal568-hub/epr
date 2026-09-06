import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer, type Supplier } from '../db'
import { fmtMoney } from '../lib/format'
import { inputCls } from '../components/ui'
import { CustomerDetail } from './customers/CustomerDetail'
import { SupplierDetailModal } from './purchases/SupplierDetailModal'
import { LenderDetailModal } from './purchases/LendersView'
import { CreditorDetail } from './expenses/ExpenseCreditors'

type PurchaseView = 'history' | 'suppliers' | 'sarrafs' | 'lenders' | 'candidates'
export default function Accounts({ openCustomers, openPurchases, openExpenses }: {
  openCustomers: () => void; openPurchases: (view: PurchaseView) => void; openExpenses: () => void
}) {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const accounts = useLiveQuery(async () => {
    const [customers, suppliers] = await Promise.all([db.customers.filter(p => !p.deleted).toArray(), db.suppliers.filter(p => !p.deleted && p.kind !== 'partner').toArray()])
    return [
      ...customers.map(person => ({ key: 'c:' + person.id, kind: 'customer', person, receivable: Math.max(0, person.balance), payable: Math.max(0, -person.balance) })),
      ...suppliers.map(person => ({ key: 's:' + person.id, kind: person.kind || 'supplier', person, receivable: Math.max(0, -person.balance), payable: Math.max(0, person.balance) }))
    ].sort((a, b) => a.person.name.localeCompare(b.person.name, 'fa'))
  }, [])
  const labels: Record<string, string> = { customer: 'مشتری', supplier: 'تأمین‌کننده', sarraf: 'صراف', lender: 'قرض‌دهنده', expenseCreditor: 'طلبکار مصارف' }
  const visible = accounts?.filter(a => (a.person.name + ' ' + (a.person.phone ?? '')).toLowerCase().includes(search.trim().toLowerCase()))
  const account = accounts?.find(a => a.key === selected)
  const close = () => setSelected(null)
  return <div className="p-4">
    <div className="page-heading"><div><h1>حساب‌ها</h1><p>شخص را جستجو کنید و دفتر حساب او را باز کنید.</p></div></div>
    <input className={inputCls} aria-label="جستجوی حساب" placeholder="نام یا شمارهٔ تماس…" value={search} onChange={e => setSearch(e.target.value)} />
    <dl className="summary-strip">
      <div><dt>طلب ما — تمام حساب‌ها</dt><dd className="text-teal-700">{fmtMoney(accounts?.reduce((n, a) => n + a.receivable, 0) ?? 0)}</dd></div>
      <div><dt>قرض ما — تمام حساب‌ها</dt><dd>{fmtMoney(accounts?.reduce((n, a) => n + a.payable, 0) ?? 0)}</dd></div>
    </dl>
    <section className="surface" aria-label="فهرست حساب‌ها">
      {!accounts && <p className="p-6 text-center text-slate-500">در حال خواندن حساب‌ها…</p>}
      {visible?.length === 0 && <p className="p-6 text-center text-slate-500">حسابی پیدا نشد.</p>}
      {visible?.map(a => <button className="account-row" key={a.key} onClick={() => setSelected(a.key)}>
        <span className="min-w-0 flex-1"><strong className="break-words">{a.person.name}</strong><small>{labels[a.kind]}{a.person.phone ? ' · ' + a.person.phone : ''}</small></span>
        <span className="shrink-0 text-sm"><strong>{fmtMoney(a.receivable || a.payable)}</strong><small>{a.receivable > 0 ? 'طلب ما' : a.payable > 0 ? 'قرض ما' : 'تصفیه'}</small></span>
      </button>)}
    </section>
    <details className="surface mt-5 p-4"><summary className="font-bold">افزودن و مدیریت حساب‌ها</summary><div className="mt-3 grid grid-cols-2 gap-2">
      <button className="surface p-3" onClick={openCustomers}>مشتریان</button><button className="surface p-3" onClick={() => openPurchases('suppliers')}>تأمین‌کنندگان</button><button className="surface p-3" onClick={() => openPurchases('sarrafs')}>صراف‌ها</button><button className="surface p-3" onClick={() => openPurchases('lenders')}>قرض‌دهندگان</button><button className="surface p-3" onClick={openExpenses}>طلبکاران مصارف</button>
    </div></details>
    {account?.kind === 'customer' && <CustomerDetail customer={account.person as Customer} onClose={close} />}
    {account?.kind === 'lender' && <LenderDetailModal lender={account.person as Supplier} onClose={close} />}
    {account?.kind === 'expenseCreditor' && <CreditorDetail creditor={account.person as Supplier} onClose={close} />}
    {account && (account.kind === 'supplier' || account.kind === 'sarraf') && <SupplierDetailModal supplier={account.person as Supplier} onClose={close} />}
  </div>
}
