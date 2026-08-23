import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, accessFlags, type Customer, type Payment } from '../../db'
import { addPayment, addOpeningDebt, deletePayment, deletePaymentImpact, cancelCustomerReturn, cancelReturnImpact, type CancelReturnImpact } from '../../lib/ops'
import { fmtMoney, fmtDate, fmtDateShort, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { buildCustomerLedger, pageTotals } from '../../lib/ledger'
import CustomerModal from './CustomerModal'
import CorrectCustomerPaymentModal from './CorrectCustomerPaymentModal'

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
  // رسید اشتباهی که مالک می‌خواهد اصلاح کند (مبلغ/تاریخ/صفحه) — بدون پاک کردن
  const [toCorrect, setToCorrect] = useState<Payment | null>(null)
  // برگشتی که مالک می‌خواهد ابطال کند — همهٔ اثرهایش برمی‌گردد
  const [toCancel, setToCancel] = useState<{ id: number; impact: CancelReturnImpact } | null>(null)
  const [cancelReason, setCancelReason] = useState('')

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
    <Modal title={`حساب ${c.name}`} onClose={onClose}>
      <div className="mb-3 rounded-2xl bg-teal-700 p-4 text-white shadow-sm">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-sm text-teal-100">{c.balance > 0 ? 'قرض مشتری به دکان' : c.balance < 0 ? 'طلب مشتری از دکان' : 'حساب تصفیه است'}</p>
            <p className="mt-1 text-2xl font-bold">{fmtMoney(Math.abs(c.balance))}</p>
          </div>
          {c.promiseDate && c.balance > 0 && (
            <div className="rounded-xl bg-white/15 px-3 py-2 text-left">
              <p className="text-[11px] text-teal-100">وعدهٔ پرداخت</p>
              <p className="text-sm font-bold">{fmtDateShort(c.promiseDate)}</p>
            </div>
          )}
        </div>
        {c.bookPage?.trim() && (
          <p className="mt-2 text-xs font-bold text-teal-100">
            📖 دفتر {(c.type ?? 'retail') === 'retail' ? 'پرچون' : 'عمده'} — آخرین صفحه: {c.bookPage.trim()}
          </p>
        )}
      </div>

      {pages.some((p) => p.page) && (
        <details className="mb-3 rounded-xl border border-slate-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-bold text-slate-700">📖 دیدن قرض هر صفحهٔ دفتر</summary>
          <div className="mt-2 border-t border-slate-100 pt-2">
            {pages.map((p) => (
              <div key={p.page ?? '—'} className="flex justify-between border-b border-slate-100 py-1 text-sm last:border-0">
                <span className={p.page ? 'text-slate-700' : 'text-amber-700'}>{p.page ? `صفحهٔ ${p.page}` : 'بی‌صفحه'}</span>
                <span className={`font-bold ${p.total > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(p.total)}</span>
              </div>
            ))}
            <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm">
              <span className="font-bold text-slate-500">مجموع</span>
              <span className="font-bold text-slate-800">{fmtMoney(pages.reduce((s, p) => s + p.total, 0))}</span>
            </div>
          </div>
        </details>
      )}

      <div className="mb-4 grid grid-cols-3 gap-2">
        <button className="rounded-xl bg-teal-50 px-2 py-3 font-bold text-teal-800" onClick={() => setShowPay(true)}>
          <span className="text-xs">دریافت پول</span>
        </button>
        <button className="rounded-xl bg-amber-50 px-2 py-3 font-bold text-amber-800" onClick={() => setShowDebt(true)}>
          <span className="text-xs">قرض قبلی</span>
        </button>
        <button className="rounded-xl bg-slate-100 px-2 py-3 font-bold text-slate-700" onClick={() => setShowEdit(true)}>
          <span className="text-xs">ویرایش حساب</span>
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

      <div className="mb-2 flex items-baseline justify-between border-t border-slate-100 pt-3">
        <p className="font-bold text-slate-800">دفتر حساب</p>
        <span className="text-xs text-slate-400">تازه‌ترین سند اول</span>
      </div>
      {mismatch && (
        <p className="mb-2 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800">
          ⚠️ جمع دفتر ({fmtMoney(ledgerEnd)}) با عدد بالا برابر نیست — با «تصفیه» یا پشتیبان‌گیری بررسی کنید.
        </p>
      )}
      {[...ledger].reverse().map((r) => (
        <div key={r.key} className="mb-2 rounded-xl border border-slate-100 bg-white p-3 text-sm shadow-sm">
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
              <p className="text-xs text-slate-500">مانده: {fmtMoney(r.balance)}</p>
              {/* فقط سندهای دستی (دریافت پول و قرض قبلی) — فروش و مرجوعی از راه خودشان پاک می‌شوند */}
              {r.source?.table === 'payments' && (
                (() => {
                  const p = (payments ?? []).find((x) => x.id === r.source!.id)
                  const correctable = !!p && p.amount > 0 && !p.groupUuid && !p.lenderAction && !accessFlags.readOnly
                  return (
                    <>
                      {correctable && (
                        <button
                          className="mr-1 mt-1 rounded-lg bg-teal-50 px-2 py-1 text-xs font-bold text-teal-700"
                          onClick={() => setToCorrect(p!)}
                        >
                          اصلاح سند
                        </button>
                      )}
                      <button
                        className="mt-1 rounded-lg bg-red-50 px-2 py-1 text-xs font-bold text-red-700"
                        onClick={async () => {
                          const im = await deletePaymentImpact(r.source!.id)
                          if (im) setToDelete({ id: r.source!.id, ...im })
                        }}
                      >
                        اشتباه بود — پاک کن
                      </button>
                     </>
                   )
                 })()
               )}
              {r.source?.table === 'returns' && !accessFlags.readOnly && (
                <button
                  className="mt-1 rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700"
                  onClick={async () => {
                    const im = await cancelReturnImpact(r.source!.id)
                    if (im) {
                      setCancelReason('')
                      setToCancel({ id: r.source!.id, impact: im })
                    }
                  }}
                >
                  ابطال برگشت
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

      {toCorrect && <CorrectCustomerPaymentModal payment={toCorrect} onClose={() => setToCorrect(null)} />}

      {toCancel && (
        <Modal title="ابطال برگشت" onClose={() => setToCancel(null)}>
          <p className="mb-3 text-sm text-slate-700">
            برگشتِ «{toCancel.impact.partyName}» به مقدار {fmtMoney(toCancel.impact.amount)} ابطال می‌شود — یعنی انگار چنین برگشتی ثبت نشده بود:
          </p>
          <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
            {toCancel.impact.stockOut.map((s) => (
              <p key={s.variantId} className={`flex justify-between ${s.have < s.qty ? 'font-bold text-red-600' : ''}`}>
                <span>از گدام کم شود: {s.label}</span>
                <span>−{fmtMoney(s.qty)} جوړه (فعلی {fmtMoney(s.have)})</span>
              </p>
            ))}
            {toCancel.impact.cashDelta > 0 && (
              <p className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">صندوق (پول مرجوعی برمی‌گردد)</span>
                <span className="font-bold text-teal-700">+{fmtMoney(toCancel.impact.cashDelta)}</span>
              </p>
            )}
            {toCancel.impact.debtDelta > 0 && (
              <p className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">قرض مشتری برمی‌گردد</span>
                <span className="font-bold text-red-600">+{fmtMoney(toCancel.impact.debtDelta)}</span>
              </p>
            )}
            {toCancel.impact.stockOut.some((s) => s.have < s.qty) && (
              <p className="mt-2 font-bold text-red-600">⚠️ این جنس دوباره فروخته شده و موجودی نمی‌رسد — ابطال ممکن نیست.</p>
            )}
          </div>
          <Field label="دلیل ابطال *">
            <input className={inputCls} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="مثلاً مقدار یا تسویه اشتباه ثبت شده بود" />
          </Field>
          <p className="mb-3 mt-2 text-xs text-slate-500">سند پاک نمی‌شود؛ با دلیلش به‌عنوان رد حساب می‌ماند.</p>
          <PrimaryBtn
            disabled={!cancelReason.trim() || toCancel.impact.stockOut.some((s) => s.have < s.qty)}
            onClick={async () => {
              await cancelCustomerReturn(toCancel.id, cancelReason)
              setToCancel(null)
            }}
          >
            بلی، ابطال کن
          </PrimaryBtn>
        </Modal>
      )}

      {showEdit && <CustomerModal customer={c} onClose={() => setShowEdit(false)} />}
    </Modal>
  )
}

export default CustomerDetail
