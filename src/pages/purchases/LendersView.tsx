import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { netWorth } from '../../lib/networth'
import { db, type Supplier } from '../../db'
import {
  addLender,
  addLoan,
  addPayment,
  convertLoanToCapital,
  deleteLender,
  deletePayment,
  deletePaymentImpact,
  repayLoan,
  updateLender,
  type LoanReceiptMode
} from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, fmtDateShort, parseNum, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../../components/ui'
import { buildLenderLedger } from '../../lib/ledger'

/** قرض‌دهنده: کسی که به دکان پول قرض داده — نه تأمین‌کننده است نه شریک */
function LendersView() {
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState<Supplier | null>(null)

  const lenders = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted && x.kind === 'lender').toArray(), [])
  const total = lenders?.reduce((s, l) => s + Math.max(0, l.balance), 0) ?? 0

  return (
    <>
      <div className="mb-3 rounded-xl bg-white p-3 shadow-sm">
        <div className="flex justify-between">
          <span className="text-sm text-slate-500">مجموع قرض ما از اشخاص</span>
          <span className="font-bold text-red-600">{fmtMoney(total)}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          تا وقتی شریک نشده، پولش قرض است — از دارایی کم می‌شود و از مفاد سهم نمی‌برد.
        </p>
      </div>

      {lenders?.length === 0 && <Empty text="قرض‌دهنده‌ای ثبت نشده. کسی که به دکان پول قرض داده اینجا ثبت می‌شود." />}
      {lenders?.map((l) => (
        <Card key={l.id} onClick={() => setDetail(l)}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800">🤝 {l.name}</p>
              {l.phone && (
                <p className="text-sm text-slate-500" dir="ltr">
                  {l.phone}
                </p>
              )}
            </div>
            <div className="text-left">
              <p className="font-bold text-red-600">{fmtMoney(Math.abs(l.balance))}</p>
              <p className="text-xs text-slate-400">{l.balance > 0 ? 'قرض ما به او' : 'تصفیه'}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">جزئیات و قسط‌ها ←</p>
        </Card>
      ))}

      <Fab onClick={() => setShowNew(true)} label="قرض‌دهندهٔ جدید" />
      {showNew && <NewLenderModal onClose={() => setShowNew(false)} />}
      {detail && <LenderDetailModal lender={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

function NewLenderModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  return (
    <Modal title="🤝 قرض‌دهندهٔ جدید" onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}
      <p className="mb-3 text-sm text-slate-500">کسی که به دکان پول قرض داده. اگر بعداً شریک شد، با یک دکمه قرضش سرمایه می‌شود.</p>
      <Field label="نام *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="تلفن">
        <input className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً شرایط پرداخت" />
      </Field>
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          try {
            await addLender({ name, phone, note })
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

function LenderDetailModal({ lender, onClose }: { lender: Supplier; onClose: () => void }) {
  const [mode, setMode] = useState<'none' | 'loan' | 'repay' | 'direct' | 'partner' | 'edit'>('none')
  const [amount, setAmount] = useState('')
  const [dateStr, setDateStr] = useState(toDateInput(Date.now()))
  const [note, setNote] = useState('')
  const [loanReceipt, setLoanReceipt] = useState<LoanReceiptMode>('cash')
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [shareStr, setShareStr] = useState('')
  const [editName, setEditName] = useState(lender.name)
  const [editPhone, setEditPhone] = useState(lender.phone ?? '')
  const [editNote, setEditNote] = useState(lender.note ?? '')
  const [error, setError] = useState('')

  const live = useLiveQuery(() => db.suppliers.get(lender.id!), [lender.id])
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'supplier' && (p.partyId === lender.id || p.lenderId === lender.id)).toArray(),
    [lender.id]
  )
  const suppliers = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && (s.kind === undefined || s.kind === 'supplier')).toArray(),
    []
  )
  // دارایی خالص امروز — برای پیشنهاد سهم عادلانه
  const assets = useLiveQuery(async () => (await netWorth()).assets, [])

  const l = live ?? lender
  const owed = l.balance
  // اگر قرضش سرمایه شود: دارایی خالص فعلی + پول او = مجموع سرمایه
  const totalAfter = (assets ?? 0) + owed
  const fairShare = totalAfter > 0 ? Math.round((owed / totalAfter) * 100) : 0

  // دفتر: هر قسط و هر پرداخت با «قرض ما شد: …»
  const ledger = buildLenderLedger(payments ?? [], l.id!)

  const reset = () => {
    setAmount('')
    setNote('')
    setSupplierId('')
    setLoanReceipt('cash')
    setError('')
    setDateStr(toDateInput(Date.now()))
  }

  return (
    <Modal title={`🤝 ${l.name}`} onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}

      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">قرض ما به او</p>
        <p className="text-2xl font-bold text-red-600">{fmtMoney(owed)}</p>
      </div>

      <button
        className="mb-3 w-full rounded-xl border border-slate-300 py-2 text-sm font-bold text-slate-700"
        onClick={() => {
          setEditName(l.name)
          setEditPhone(l.phone ?? '')
          setEditNote(l.note ?? '')
          setMode(mode === 'edit' ? 'none' : 'edit')
          setError('')
        }}
      >
        ✏️ ویرایش مشخصات قرض‌دهنده
      </button>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          className="flex-1 rounded-xl bg-teal-700 py-2 text-sm font-bold text-white"
          onClick={() => {
            setMode(mode === 'loan' ? 'none' : 'loan')
            reset()
          }}
        >
          ＋ دریافت قسط
        </button>
        <button
          className="flex-1 rounded-xl bg-amber-100 py-2 text-sm font-bold text-amber-800"
          onClick={() => {
            setMode(mode === 'repay' ? 'none' : 'repay')
            reset()
          }}
        >
          پرداخت قرض
        </button>
        <button
          className="col-span-2 rounded-xl bg-blue-100 py-2 text-sm font-bold text-blue-800"
          onClick={() => {
            setMode(mode === 'direct' ? 'none' : 'direct')
            reset()
          }}
        >
          پرداخت مستقیم به فروشنده
        </button>
      </div>

      {mode === 'edit' && (
        <div className="mb-3 rounded-xl border border-slate-300 p-3">
          <Field label="نام *">
            <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Field>
          <Field label="تلفن">
            <input className={inputCls} dir="ltr" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={editNote} onChange={(e) => setEditNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!editName.trim()}
            onClick={async () => {
              try {
                await updateLender(l.id!, { name: editName, phone: editPhone, note: editNote })
                setMode('none')
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ذخیرهٔ تغییرات
          </PrimaryBtn>
          <button
            className="mt-3 w-full rounded-xl border border-red-300 py-2 text-sm font-bold text-red-700"
            onClick={async () => {
              if (!confirm('این قرض‌دهنده حذف شود؟ فقط وقتی حساب و سند زنده ندارد حذف می‌شود.')) return
              try {
                await deleteLender(l.id!)
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            حذف قرض‌دهنده
          </button>
        </div>
      )}

      {mode === 'loan' && (
        <div className="mb-3 rounded-xl border border-teal-200 p-3">
          <Field label="این قرض چگونه بوده؟">
            <select className={inputCls} value={loanReceipt} onChange={(e) => setLoanReceipt(e.target.value as LoanReceiptMode)}>
              <option value="cash">پول اکنون وارد صندوق شد</option>
              <option value="opening">قرض قبلی — پول قبلاً برای جنس مصرف شده</option>
            </select>
          </Field>
          <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            {loanReceipt === 'cash'
              ? 'صندوق به همین مبلغ زیاد می‌شود و قرض ما به او بالا می‌رود.'
              : 'برای جنس موجودی اولیه یا بکاپ: فقط قرض ثبت می‌شود و صندوق تغییر نمی‌کند.'}
          </p>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="تاریخ (برای قسط‌های گذشته هم می‌شود عقب برد)">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                await addLoan(l.id!, l.name, parseNum(amount), fromDateInput(dateStr), note, loanReceipt)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {loanReceipt === 'cash' ? 'ثبت دریافت نقدی قرض' : 'ثبت قرض قبلی بدون تغییر صندوق'}
          </PrimaryBtn>
        </div>
      )}

      {mode === 'direct' && (
        <div className="mb-3 rounded-xl border border-blue-200 p-3">
          <p className="mb-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
            برای خرید آینده که این شخص مستقیماً فروشنده را پرداخت کرده است. صندوق تغییر نمی‌کند.
          </p>
          <p className="mb-2 text-xs font-bold text-amber-700">
            برای جنس موجودی اولیه/بکاپ این گزینه را نزنید؛ همان «قرض قبلی» را ثبت کنید.
          </p>
          <Field label="فروشنده *">
            <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — قرض فعلی {fmtMoney(s.balance)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="تاریخ">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!supplierId || parseNum(amount) <= 0}
            onClick={async () => {
              const supplier = suppliers?.find((s) => s.id === supplierId)
              if (!supplier) return
              try {
                await addPayment({
                  date: fromDateInput(dateStr),
                  partyType: 'supplier',
                  partyId: supplier.id!,
                  partyName: supplier.name,
                  amount: parseNum(amount),
                  note: note.trim() || undefined,
                  via: 'lender',
                  lenderId: l.id!,
                  lenderName: l.name
                })
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت پرداخت مستقیم
          </PrimaryBtn>
        </div>
      )}

      {mode === 'repay' && (
        <div className="mb-3 rounded-xl border border-amber-200 p-3">
          <Field label="مبلغ پرداختی *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                await repayLoan(l.id!, l.name, parseNum(amount), note)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت پرداخت
          </PrimaryBtn>
        </div>
      )}

      {owed > 0 && (
        <button
          onClick={() => {
            setMode(mode === 'partner' ? 'none' : 'partner')
            setShareStr(String(fairShare))
            setError('')
          }}
          className="mb-3 w-full rounded-xl border-2 border-dashed border-purple-400 py-2.5 text-sm font-bold text-purple-700"
        >
          🤝 شریک شدن — تبدیل قرض به سرمایه
        </button>
      )}

      {mode === 'partner' && (
        <div className="mb-3 rounded-xl border border-purple-300 bg-purple-50 p-3">
          <p className="mb-2 text-sm font-bold text-purple-900">حساب امروز</p>
          <div className="mb-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">دارایی خالص دکان (بدون پول او)</span>
              <span className="font-bold">{fmtMoney(assets ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">سرمایه‌ای که او می‌آورد</span>
              <span className="font-bold">{fmtMoney(owed)}</span>
            </div>
            <div className="flex justify-between border-t border-purple-200 pt-1">
              <span className="text-slate-600">مجموع سرمایه بعد از شراکت</span>
              <span className="font-bold">{fmtMoney(totalAfter)}</span>
            </div>
          </div>
          <p className="mb-2 rounded-lg bg-white p-2 text-sm">
            سهم عادلانه بر اساس پول: <span className="font-bold text-purple-800">{fmtNum(fairShare)}٪</span> برای او،{' '}
            <span className="font-bold text-purple-800">{fmtNum(100 - fairShare)}٪</span> برای شما
          </p>
          <Field label="فیصدی سهم او از مفاد (خودتان تعیین می‌کنید)">
            <input className={inputCls} inputMode="numeric" value={shareStr} onChange={(e) => setShareStr(e.target.value)} />
          </Field>
          <p className="mb-2 text-xs text-slate-500">
            ⚠️ زحمت روزانهٔ خودتان را هم در نظر بگیرید — یا فیصدی‌تان بیشتر باشد، یا برای خود معاش ماهانه تعیین کنید.
            شراکت از امروز شروع می‌شود و مفاد پیش از امروز مالِ شماست.
          </p>
          <PrimaryBtn
            disabled={parseNum(shareStr) <= 0 || parseNum(shareStr) >= 100}
            onClick={async () => {
              if (!confirm(`قرض ${fmtMoney(owed)} به سرمایهٔ شریک تبدیل شود و شراکت از امروز شروع شود؟`)) return
              try {
                await convertLoanToCapital(l.id!, parseNum(shareStr))
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            تأیید — از امروز شریک است
          </PrimaryBtn>
        </div>
      )}

      <p className="mb-2 font-bold text-slate-700">دفتر حساب — این عدد از کجا آمد</p>
      {ledger.length === 0 && <p className="text-sm text-slate-400">هنوز قسطی ثبت نشده.</p>}
      {[...ledger].reverse().map((r) => (
        <div key={r.key} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-slate-800">{r.delta > 0 ? 'دریافت قرض' : r.label}</p>
              <p className="text-xs text-slate-400">{fmtDate(r.date)}</p>
              {r.note && <p className="mt-1 text-xs text-slate-500">{r.note}</p>}
            </div>
            <div className="shrink-0 text-left">
              <p className={`font-bold ${r.delta > 0 ? 'text-red-600' : 'text-teal-700'}`}>
                {r.delta > 0 ? '+' : '−'}
                {fmtMoney(Math.abs(r.delta))}
              </p>
              <p className="text-xs text-slate-500">قرض ما شد: {fmtMoney(r.balance)}</p>
            </div>
          </div>
          {r.source?.table === 'payments' && (
            <button
              className="mt-2 w-full border-t border-red-100 pt-2 text-xs font-bold text-red-600"
              onClick={async () => {
                try {
                  const impact = await deletePaymentImpact(r.source!.id)
                  if (!impact) return
                  const changes = [
                    `${impact.partyName}: ${fmtMoney(impact.before)} ← ${fmtMoney(impact.after)}`,
                    ...(impact.related
                      ? [`${impact.related.partyName}: ${fmtMoney(impact.related.before)} ← ${fmtMoney(impact.related.after)}`]
                      : []),
                    impact.cash === 0
                      ? 'صندوق تغییر نمی‌کند.'
                      : `تغییر صندوق: ${impact.cash > 0 ? '+' : '−'}${fmtMoney(Math.abs(impact.cash))}`
                  ].join('\n')
                  if (!confirm(`این سند اشتباه بود و حذف شود؟\n\n${changes}`)) return
                  await deletePayment(r.source!.id)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              اشتباه بود — حذف سند
            </button>
          )}
        </div>
      ))}
      {l.note && <p className="mt-3 text-xs text-slate-400">یادداشت: {l.note}</p>}
      {ledger.length > 0 && <p className="mt-2 text-xs text-slate-400">اولین قسط: {fmtDateShort(ledger[0].date)}</p>}
    </Modal>
  )
}

export default LendersView
