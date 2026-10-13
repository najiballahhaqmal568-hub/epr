import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer, type Supplier } from '../db'
import { fmtMoney, fmtNum } from '../lib/format'
import { SIDE_LABEL, SIDE_TONE, netOfCreditor, netOfCustomer, sideOf, totals, type Side } from '../lib/accountWords'
import { Empty, inputCls } from '../components/ui'
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
      ...customers.map(person => ({ key: 'c:' + person.id, kind: 'customer', person, net: netOfCustomer(person.balance) })),
      ...suppliers.map(person => ({ key: 's:' + person.id, kind: person.kind || 'supplier', person, net: netOfCreditor(person.balance) }))
    ]
  }, [])
  const labels: Record<string, string> = { customer: 'مشتری', supplier: 'تأمین‌کننده', sarraf: 'صراف', lender: 'قرض‌دهنده', expenseCreditor: 'طلبکار مصارف' }
  const visible = accounts?.filter(a => (a.person.name + ' ' + (a.person.phone ?? '')).toLowerCase().includes(search.trim().toLowerCase()))
  const account = accounts?.find(a => a.key === selected)
  // دو گروه: اول آنچه باید بگیریم، بعد آنچه باید بدهیم؛ هر گروه بزرگ‌ترین عدد اول؛ تصفیه‌ها آخر
  const groups: { side: Side; rows: NonNullable<typeof visible> }[] = (['receive', 'pay', 'settled'] as Side[]).map(side => ({
    side,
    rows: (visible ?? []).filter(a => sideOf(a.net) === side).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.person.name.localeCompare(b.person.name, 'fa'))
  })).filter(g => g.rows.length > 0)
  const sums = totals((accounts ?? []).map(a => a.net))
  const close = () => setSelected(null)
  return <div className="p-4">
    <div className="page-heading"><div><h1>حساب‌ها</h1><p>شخص را جستجو کنید و دفتر حساب او را باز کنید.</p></div></div>
    <input className={inputCls} aria-label="جستجوی حساب" placeholder="نام یا شمارهٔ تماس…" value={search} onChange={e => setSearch(e.target.value)} />
    <details className="surface my-4 p-4"><summary className="font-bold">افزودن و مدیریت حساب‌ها</summary><div className="mt-3 grid grid-cols-2 gap-2">
      <button className="surface p-3" onClick={openCustomers}>مشتریان</button><button className="surface p-3" onClick={() => openPurchases('suppliers')}>تأمین‌کنندگان</button><button className="surface p-3" onClick={() => openPurchases('sarrafs')}>صراف‌ها</button><button className="surface p-3" onClick={() => openPurchases('lenders')}>قرض‌دهندگان</button><button className="surface p-3" onClick={openExpenses}>طلبکاران مصارف</button>
    </div></details>
    <dl className="summary-strip">

      <div><dt>در کل باید بگیریم</dt><dd className={SIDE_TONE.receive}>{fmtMoney(sums.receive)}</dd></div>
      <div><dt>در کل باید بدهیم</dt><dd className={SIDE_TONE.pay}>{fmtMoney(sums.pay)}</dd></div>
    </dl>
    <section className="surface" aria-label="فهرست حساب‌ها">
      {!accounts && <p className="p-6 text-center text-slate-500">در حال خواندن حساب‌ها…</p>}
      {visible?.length === 0 && (accounts?.length ?? 0) > 0 && <p className="p-6 text-center text-slate-500">حسابی پیدا نشد.</p>}
      {accounts?.length === 0 && <Empty text="هنوز هیچ حسابی نیست." hint="قرض قبلی مشتریان را از «مشتریان» بنویسید؛ قرض ما به دیگران را از «تأمین‌کنندگان»." action={{ label: 'باز کردن دفتر مشتریان', onClick: openCustomers }} />}
      {groups.map(g => <div key={g.side} role="group" aria-label={SIDE_LABEL[g.side]}>
        <p className="px-4 pb-1 pt-4 text-sm font-bold text-slate-600">{SIDE_LABEL[g.side]} <span className="font-normal text-slate-400">· {fmtNum(g.rows.length)} حساب</span></p>
        {g.rows.map(a => <button className="account-row" key={a.key} onClick={() => setSelected(a.key)}>
          <span className="min-w-0 flex-1"><strong className="break-words">{a.person.name}</strong><small>{labels[a.kind]}{a.person.phone ? ' · ' + a.person.phone : ''}</small></span>
          <span className="shrink-0 text-sm"><strong className={SIDE_TONE[g.side]}>{fmtMoney(Math.abs(a.net))}</strong><small>{SIDE_LABEL[g.side]}</small></span>
        </button>)}
      </div>)}
    </section>
    {account?.kind === 'customer' && <CustomerDetail customer={account.person as Customer} onClose={close} />}
    {account?.kind === 'lender' && <LenderDetailModal lender={account.person as Supplier} onClose={close} />}
    {account?.kind === 'expenseCreditor' && <CreditorDetail creditor={account.person as Supplier} onClose={close} />}
    {account && (account.kind === 'supplier' || account.kind === 'sarraf') && <SupplierDetailModal supplier={account.person as Supplier} onClose={close} />}
  </div>
}
