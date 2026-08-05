import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../../db'
import { addPayment, addOpeningDebt, deletePayment, deletePaymentImpact } from '../../lib/ops'
import { fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { buildCustomerLedger, pageTotals } from '../../lib/ledger'
import CustomerModal from './CustomerModal'

export function CustomerDetail({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [showPay, setShowPay] = useState(false)
  const [showEdit, setShowEdit] = useState(false)
  const [showDebt, setShowDebt] = useState(false)
  const [amount, setAmount] = useState('')
  const [debtStr, setDebtStr] = useState('')
  const [debtNote, setDebtNote] = useState('')
  const [payPage, setPayPage] = useState('')
  const [debtPage, setDebtPage] = useState('')
  // سند اشتباهی که مالک می‌خواهد پاک کند — اول اثرش نشان داده می‌شود
  const [toDelete, setToDelete] = useState<
    { id: number; label: string; partyName: string; before: number; after: number; cash: number } | null
  >(null)

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
  // «کدام صفحه چقدر است» — از روی همان سندها، پس جمعش همیشه با عدد بالا برابر است
  const pages = pageTotals(ledger)
  const mismatch = Math.abs(ledgerEnd - c.balance) > 0.5

  return (
    <Modal title={c.name} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">{c.balance > 0 ? 'قرض مشتری' : c.balance < 0 ? 'بستانکاری مشتری' : 'حساب تصفیه است'}</p>
        <p className={`text-2xl font-bold ${c.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(c.balance))}</p>
        {c.bookPage?.trim() && (
          <p className="mt-1 text-xs font-bold text-slate-500">
            📖 دفتر {(c.type ?? 'retail') === 'retail' ? 'پرچون' : 'عمده'} — آخرین صفحه: {c.bookPage.trim()}
          </p>
        )}
      </div>

      {pages.some((p) => p.page) && (
        <div className="mb-3 rounded-xl border border-slate-200 p-3">
          <p className="mb-2 text-sm font-bold text-slate-700">📖 قرض هر صفحهٔ دفتر</p>
          {pages.map((p) => (
            <div key={p.page ?? '—'} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
              <span className={p.page ? 'text-slate-700' : 'text-amber-700'}>
                {p.page ? `صفحهٔ ${p.page}` : 'بی‌صفحه'}
              </span>
              <span className={`font-bold ${p.total > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(p.total)}</span>
            </div>
          ))}
          <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm">
            <span className="font-bold text-slate-500">مجموع</span>
            <span className="font-bold text-slate-800">{fmtMoney(pages.reduce((s, p) => s + p.total, 0))}</span>
          </div>
        </div>
      )}

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
          <Field label="صفحهٔ دفتر (اختیاری)">
            <input className={inputCls} value={debtPage} onChange={(e) => setDebtPage(e.target.value)} placeholder={c.bookPage?.trim() || 'مثلاً ۱۲'} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(debtStr) <= 0}
            onClick={async () => {
              await addOpeningDebt('customer', c.id!, c.name, parseNum(debtStr), debtNote, debtPage.trim() || c.bookPage?.trim())
              setDebtStr('')
              setDebtNote('')
              setDebtPage('')
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
          <Field label="صفحهٔ دفتر (پول بابت کدام ورق گرفته شد)">
            <input className={inputCls} value={payPage} onChange={(e) => setPayPage(e.target.value)} placeholder={c.bookPage?.trim() || 'مثلاً ۱۲'} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              await addPayment({
                date: Date.now(),
                partyType: 'customer',
                partyId: c.id!,
                partyName: c.name,
                amount: parseNum(amount),
                bookPage: payPage.trim() || c.bookPage?.trim()
              })
              setAmount('')
              setPayPage('')
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
              {/* بوت اول می‌آید — «از بابت چه قرضدار است» */}
              {r.items ? (
                <>
                  <p className="font-bold text-slate-800">{r.items}</p>
                  <p className="text-xs text-slate-500">
                    {r.label}
                    {r.note ? ` · ${r.note}` : ''}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-slate-800">{r.label}</p>
                  {r.note && <p className="truncate text-xs text-slate-500">{r.note}</p>}
                </>
              )}
              <p className="text-xs text-slate-400">
                {fmtDate(r.date)}
                {r.page && <span className="mr-2 font-bold text-slate-500">📖 صفحهٔ {r.page}</span>}
              </p>
            </div>
            <div className="shrink-0 text-left">
              <p className={`font-bold ${r.delta > 0 ? 'text-red-600' : 'text-teal-700'}`}>
                {r.delta > 0 ? '+' : '−'}
                {fmtMoney(Math.abs(r.delta))}
              </p>
              <p className="text-xs text-slate-500">قرض شد: {fmtMoney(r.balance)}</p>
              {/* فقط سندهای دستی (دریافت پول و قرض قبلی) — فروش و مرجوعی از راه خودشان پاک می‌شوند */}
              {r.source?.table === 'payments' && (
                <button
                  className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                  onClick={async () => {
                    const im = await deletePaymentImpact(r.source!.id)
                    if (im) setToDelete({ id: r.source!.id, ...im })
                  }}
                >
                  اشتباه بود — پاک کن
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
      {ledger.length === 0 && <p className="text-sm text-slate-400">هنوز سندی نیست.</p>}

      {toDelete && (
        <Modal title="پاک کردن سند اشتباهی" onClose={() => setToDelete(null)}>
          <p className="mb-3 text-sm text-slate-700">
            «{toDelete.label}» در حساب {toDelete.partyName} پاک می‌شود. اثرش این است:
          </p>
          <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
            <p className="flex justify-between">
              <span className="text-slate-500">قرض حالا</span>
              <span className="font-bold">{fmtMoney(toDelete.before)}</span>
            </p>
            <p className="flex justify-between">
              <span className="text-slate-500">قرض بعد از پاک کردن</span>
              <span className="font-bold text-teal-700">{fmtMoney(toDelete.after)}</span>
            </p>
            {toDelete.cash !== 0 && (
              <p className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">صندوق</span>
                <span className="font-bold">
                  {toDelete.cash > 0 ? '+' : '−'}
                  {fmtMoney(Math.abs(toDelete.cash))}
                </span>
              </p>
            )}
          </div>
          <p className="mb-3 text-xs text-slate-500">
            سند پاک می‌شود ولی نشانش در پشتیبان می‌ماند — هیچ عددی بی‌سند تغییر نمی‌کند.
          </p>
          <PrimaryBtn
            onClick={async () => {
              await deletePayment(toDelete.id)
              setToDelete(null)
            }}
          >
            بلی، پاک کن
          </PrimaryBtn>
        </Modal>
      )}

      {showEdit && <CustomerModal customer={c} onClose={() => setShowEdit(false)} />}
    </Modal>
  )
}

export default CustomerDetail
