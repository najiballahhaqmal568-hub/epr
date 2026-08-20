import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { fmtDateShort, fmtMoney, fmtNum, startOfDay } from '../lib/format'

type PurchaseView = 'history' | 'suppliers' | 'sarrafs' | 'lenders' | 'candidates'

export default function Accounts({
  openCustomers,
  openPurchases,
  openExpenses
}: {
  openCustomers: () => void
  openPurchases: (view: PurchaseView) => void
  openExpenses: () => void
}) {
  const summary = useLiveQuery(async () => {
    const [customers, suppliers] = await Promise.all([
      db.customers.filter((row) => !row.deleted).toArray(),
      db.suppliers.filter((row) => !row.deleted).toArray()
    ])

    const vendors = suppliers.filter(
      (row) => !row.kind || row.kind === 'supplier'
    )
    const lenders = suppliers.filter((row) => row.kind === 'lender')
    const expenseCreditors = suppliers.filter((row) => row.kind === 'expenseCreditor')
    const sarrafs = suppliers.filter((row) => row.kind === 'sarraf')
    const promises = customers
      .filter((row) => row.balance > 0 && Boolean(row.promiseDate))
      .sort((a, b) => a.promiseDate! - b.promiseDate!)
      .slice(0, 4)

    return {
      customers: customers.length,
      customerDebt: customers.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      vendors: vendors.length,
      vendorDebt: vendors.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      lenders: lenders.length,
      lenderDebt: lenders.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      expenseCreditors: expenseCreditors.length,
      expenseDebt: expenseCreditors.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      sarrafs: sarrafs.length,
      sarrafDebt: sarrafs.reduce((sum, row) => sum + Math.max(0, row.balance), 0),
      promises
    }
  }, [])

  const accountCard =
    'rounded-2xl border border-slate-100 bg-white p-3 text-right shadow-sm active:bg-slate-50'
  const totalDebt =
    (summary?.customerDebt ?? 0) +
    (summary?.vendorDebt ?? 0) +
    (summary?.lenderDebt ?? 0) +
    (summary?.expenseDebt ?? 0) +
    (summary?.sarrafDebt ?? 0)
  const today = startOfDay()

  return (
    <div className="p-4">
      <h1 className="mb-1 text-xl font-bold text-slate-800">حساب‌ها</h1>
      <p className="mb-4 text-sm text-slate-500">حساب مورد نظر را انتخاب کنید؛ دفتر هر شخص جدا و محفوظ است.</p>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button onClick={openCustomers} className={accountCard}>
          <span className="block font-bold text-slate-800">مشتریان</span>
          <span className="block text-xs text-slate-500">{fmtNum(summary?.customers ?? 0)} حساب</span>
          <span className="mt-2 block text-sm font-bold text-red-600">{fmtMoney(summary?.customerDebt ?? 0)}</span>
        </button>

        <button onClick={() => openPurchases('suppliers')} className={accountCard}>
          <span className="block font-bold text-slate-800">تأمین‌کنندگان</span>
          <span className="block text-xs text-slate-500">{fmtNum(summary?.vendors ?? 0)} حساب</span>
          <span className="mt-2 block text-sm font-bold text-amber-700">{fmtMoney(summary?.vendorDebt ?? 0)}</span>
        </button>

        <button onClick={() => openPurchases('lenders')} className={accountCard}>
          <span className="block font-bold text-slate-800">قرض‌دهندگان</span>
          <span className="block text-xs text-slate-500">{fmtNum(summary?.lenders ?? 0)} حساب</span>
          <span className="mt-2 block text-sm font-bold text-purple-700">{fmtMoney(summary?.lenderDebt ?? 0)}</span>
        </button>

        <button onClick={openExpenses} className={accountCard}>
          <span className="block font-bold text-slate-800">طلبکاران مصارف</span>
          <span className="block text-xs text-slate-500">{fmtNum(summary?.expenseCreditors ?? 0)} حساب</span>
          <span className="mt-2 block text-sm font-bold text-red-600">{fmtMoney(summary?.expenseDebt ?? 0)}</span>
        </button>
      </div>

      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white shadow-sm">
        <p className="text-sm text-teal-100">مجموع طلب و قرض ثبت‌شده</p>
        <p className="mt-1 text-2xl font-bold">{fmtMoney(totalDebt)}</p>
        <p className="mt-1 text-xs text-teal-100">برای جزئیات، یکی از حساب‌های بالا را باز کنید.</p>
      </div>

      <button onClick={() => openPurchases('sarrafs')} className="mb-3 flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white p-3 text-right shadow-sm">
        <span>
          <span className="block font-bold text-slate-800">صراف‌ها</span>
          <span className="text-xs text-slate-500">{fmtNum(summary?.sarrafs ?? 0)} حساب حواله و اسعار</span>
        </span>
        <span className="font-bold text-amber-700">{fmtMoney(summary?.sarrafDebt ?? 0)}</span>
      </button>

      <div className="rounded-2xl bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-center justify-between">
          <p className="font-bold text-slate-800">وعده‌های نزدیک مشتریان</p>
          <button onClick={openCustomers} className="text-xs font-bold text-teal-700">دیدن مشتریان</button>
        </div>
        {!summary?.promises.length && <p className="py-3 text-center text-sm text-slate-400">وعده‌ای ثبت نشده.</p>}
        {summary?.promises.map((customer) => {
          const overdue = customer.promiseDate! < today
          return (
            <button key={customer.id} onClick={openCustomers} className="flex w-full items-center justify-between border-b border-slate-100 py-2 text-right last:border-0">
              <span>
                <span className="block text-sm font-bold text-slate-700">{customer.name}</span>
                <span className={`text-xs ${overdue ? 'font-bold text-red-600' : 'text-slate-500'}`}>
                  {overdue ? 'وعده گذشته' : 'وعده'}: {fmtDateShort(customer.promiseDate!)}
                </span>
              </span>
              <span className="text-sm font-bold text-red-600">{fmtMoney(customer.balance)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
