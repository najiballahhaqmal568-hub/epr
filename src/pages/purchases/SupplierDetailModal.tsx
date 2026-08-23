import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type Payment, type ReturnDoc, type Supplier } from '../../db'
import { addOpeningDebt, deletePayment, deletePaymentImpact, cancelSupplierReturn } from '../../lib/ops'
import { fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Empty } from '../../components/ui'
import { CorrectSupplierPaymentModal } from './SupplierModals'
import CorrectOpeningDebtModal from './CorrectOpeningDebtModal'

/** تاریخچهٔ کامل حساب یک تأمین‌کننده یا صراف */
export function SupplierDetailModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [showDebt, setShowDebt] = useState(false)
  const [debtStr, setDebtStr] = useState('')
  const [debtNote, setDebtNote] = useState('')
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null)
  const [editingOpening, setEditingOpening] = useState<Payment | null>(null)
  // سند اشتباهی (قرض قبلی) که مالک می‌خواهد کلاً پاک کند — اول اثرش نشان داده می‌شود
  const [toDelete, setToDelete] = useState<
    { id: number; label: string; before: number; after: number } | null
  >(null)
  // برگشت به تأمین‌کننده که مالک می‌خواهد ابطال کند
  const [cancellingRet, setCancellingRet] = useState<ReturnDoc | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const live = useLiveQuery(() => db.suppliers.get(supplier.id!), [supplier.id])
  const purchases = useLiveQuery(
    () => db.purchases.where('supplierId').equals(supplier.id!).filter((p) => !p.deleted).toArray(),
    [supplier.id]
  )
  const hawalas = useLiveQuery(() => db.purchases.filter((p) => !p.deleted && p.sarrafId === supplier.id).toArray(), [supplier.id])
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'supplier' && p.partyId === supplier.id).toArray(),
    [supplier.id]
  )
  const sarrafPays = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.via === 'sarraf' && p.sarrafId === supplier.id).toArray(),
    [supplier.id]
  )
  const returns = useLiveQuery(
    () => db.returns.filter((r) => !r.deleted && r.kind === 'supplier' && r.partyId === supplier.id).toArray(),
    [supplier.id]
  )

  if (editingPayment) {
    return <CorrectSupplierPaymentModal payment={editingPayment} onClose={() => setEditingPayment(null)} />
  }
  if (editingOpening) {
    return <CorrectOpeningDebtModal payment={editingOpening} onClose={() => setEditingOpening(null)} />
  }

  type Ev = { date: number; label: string; sub?: string; amount: number; plus: boolean; payment?: Payment; ret?: ReturnDoc }
  const events: Ev[] = []
  purchases?.forEach((p) => {
    const hawala = p.sarrafAmount ?? 0
    const rem = p.total - p.paid - hawala
    events.push({
      date: p.date,
      label: `خرید ${p.received === false ? '(در راه)' : ''}`,
      sub: `مجموع ${fmtMoney(p.total)} · نقد ${fmtMoney(p.paid)}${hawala > 0 ? ` · حواله ${fmtMoney(hawala)}` : ''}`,
      amount: rem,
      plus: rem > 0
    })
  })
  hawalas?.forEach((p) => {
    events.push({
      date: p.date,
      label: `حواله برای ${p.supplierName}`,
      amount: p.sarrafAmount ?? 0,
      plus: true
    })
  })
  payments?.forEach((p) => {
    if (p.amount < 0) {
      // بیلانس اولیه / قرض قبلی: قرض ما را بالا برده است — از اینجا قابل اصلاح و پاک‌کردن است
      events.push({
        date: p.date,
        label: p.note ?? 'قرض قبلی',
        sub: p.correctionReason ? `اصلاح‌شده — ${p.correctionReason}` : undefined,
        amount: -p.amount,
        plus: true,
        payment: p.via === 'opening' && !p.lenderAction && !p.groupUuid ? p : undefined
      })
    } else {
      const sarrafAmount = p.via === 'sarraf' ? (p.sarrafAmount ?? p.amount) : 0
      const cashAmount = p.amount - sarrafAmount
      const details = cashAmount > 0 && sarrafAmount > 0
        ? `صندوق ${fmtMoney(cashAmount)} · صراف ${fmtMoney(sarrafAmount)}${p.note ? ` · ${p.note}` : ''}`
        : p.note
      events.push({
        date: p.date,
        label: p.via === 'sarraf'
          ? cashAmount > 0
            ? `پرداخت ترکیبی با ${p.sarrafName ?? 'صراف'}`
            : `پرداخت از طریق صراف ${p.sarrafName ?? ''}`
          : 'پرداخت نقدی',
        sub: [details, p.correctionReason ? `اصلاح‌شده — ${p.correctionReason}` : ''].filter(Boolean).join(' · ') || undefined,
        amount: p.amount,
        plus: false,
        payment: p.lenderAction || p.groupUuid ? undefined : p
      })
    }
  })
  sarrafPays?.forEach((p) => {
    events.push({ date: p.date, label: `حواله برای ${p.partyName}`, amount: p.sarrafAmount ?? p.amount, plus: true })
  })
  returns?.forEach((r) => {
    if (r.settlement === 'reduceDebt') {
      events.push({
        date: r.date,
        label: `مرجوعی جنس (${r.reason})`,
        sub: r.cancelledReason ? `ابطال‌شده — ${r.cancelledReason}` : undefined,
        amount: r.amount,
        plus: false,
        ret: r
      })
    }
  })
  events.sort((a, b) => b.date - a.date)

  const bal = live?.balance ?? supplier.balance
  return (
    <Modal title={supplier.kind === 'sarraf' ? `💱 ${supplier.name}` : supplier.name} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">{bal > 0 ? 'قرض ما' : bal < 0 ? 'طلب ما (پیشکی)' : 'حساب تصفیه است'}</p>
        <p className={`text-2xl font-bold ${bal > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.abs(bal))}</p>
      </div>
      {!showDebt ? (
        <button className="mb-3 w-full rounded-xl bg-amber-100 py-2 text-sm font-bold text-amber-800" onClick={() => setShowDebt(true)}>
          ＋ ثبت قرض قبلی (پیش از اپ)
        </button>
      ) : (
        <div className="mb-3 rounded-xl border border-amber-200 p-3">
          <p className="mb-2 text-xs text-slate-500">قرض خریدهای گذشته — در خرید، مفاد و صندوق حساب نمی‌شود.</p>
          <Field label="مبلغ قرض قبلی">
            <input className={inputCls} inputMode="numeric" value={debtStr} onChange={(e) => setDebtStr(e.target.value)} />
          </Field>
          <Field label="یادداشت (اختیاری)">
            <input className={inputCls} value={debtNote} onChange={(e) => setDebtNote(e.target.value)} placeholder="مثلاً بابت حمل گذشته" />
          </Field>
          <PrimaryBtn
            disabled={parseNum(debtStr) <= 0}
            onClick={async () => {
              await addOpeningDebt('supplier', supplier.id!, supplier.name, parseNum(debtStr), debtNote)
              setDebtStr('')
              setDebtNote('')
              setShowDebt(false)
            }}
          >
            ثبت قرض قبلی
          </PrimaryBtn>
        </div>
      )}
      <p className="mb-2 text-sm font-bold text-slate-700">تاریخچهٔ حساب</p>
      {events.length === 0 && <Empty text="هنوز سندی ثبت نشده." />}
      <div className="max-h-96 overflow-y-auto">
        {events.map((e, i) => (
          <div key={e.payment?.uuid ?? i} className="border-b border-slate-100 py-2 text-sm last:border-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="font-bold text-slate-700">{e.label}</p>
                {e.sub && <p className="text-xs text-slate-400">{e.sub}</p>}
                <p className="text-xs text-slate-400">{fmtDate(e.date)}</p>
              </div>
              <span className={`shrink-0 font-bold ${e.plus ? 'text-red-600' : 'text-teal-700'}`}>
                {e.plus ? '+' : '−'}
                {fmtMoney(Math.abs(e.amount))}
              </span>
            </div>
            {!accessFlags.readOnly && e.ret && !e.ret.deleted && (
              <button
                className="mt-2 w-full rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700"
                onClick={async () => {
                  setCancelReason('')
                  setCancellingRet(e.ret!)
                }}
              >
                ابطال برگشت
              </button>
            )}
            {!accessFlags.readOnly && e.payment?.id && (
              <div className="mt-2 flex gap-2">
                <button
                  className="rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700"
                  onClick={() => (e.payment!.amount < 0 ? setEditingOpening(e.payment!) : setEditingPayment(e.payment!))}
                >
                  اصلاح سند
                </button>
                {e.payment.amount < 0 && (
                  <button
                    className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-bold text-red-700"
                    onClick={async () => {
                      const pid = e.payment!.id!
                      const im = await deletePaymentImpact(pid)
                      if (!im) return
                      setToDelete({ id: pid, label: e.label, before: im.before, after: im.after })
                    }}
                  >
                    اشتباه بود — پاک کن
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {toDelete && (
        <Modal title="پاک کردن سند اشتباهی" onClose={() => setToDelete(null)}>
          <p className="mb-3 text-sm text-slate-700">
            «{toDelete.label}» از حساب {supplier.name} پاک می‌شود. اثرش این است:
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
      {cancellingRet && (
        <Modal title="ابطال برگشت به تأمین‌کننده" onClose={() => setCancellingRet(null)}>
          <p className="mb-3 text-sm text-slate-700">
            مرجوعیِ «{fmtMoney(cancellingRet.amount)}» به {cancellingRet.partyName} ابطال می‌شود — انگار چنین برگشتی ثبت نشده بود:
          </p>
          <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
            <p className="flex justify-between">
              <span className="text-slate-500">جنس به گدام برمی‌گردد</span>
              <span className="font-bold">
                +{fmtMoney(cancellingRet.lines.reduce((s, l) => s + l.qty, 0))} جوړه
              </span>
            </p>
            {cancellingRet.settlement === 'reduceDebt' && (
              <p className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">قرض ما به او برمی‌گردد</span>
                <span className="font-bold text-red-600">+{fmtMoney(cancellingRet.amount)}</span>
              </p>
            )}
            {cancellingRet.settlement === 'cashRefund' && (
              <p className="mt-1 flex justify-between border-t border-slate-200 pt-1">
                <span className="text-slate-500">پول از صندوق بیرون می‌رود</span>
                <span className="font-bold text-red-600">−{fmtMoney(cancellingRet.amount)}</span>
              </p>
            )}
          </div>
          <Field label="دلیل ابطال *">
            <input className={inputCls} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="مثلاً مقدار یا تسویه اشتباه بود" />
          </Field>
          <p className="mb-3 mt-2 text-xs text-slate-500">سند پاک نمی‌شود؛ با دلیلش برای رد حساب می‌ماند.</p>
          <PrimaryBtn
            disabled={!cancelReason.trim()}
            onClick={async () => {
              await cancelSupplierReturn(cancellingRet.id!, cancelReason)
              setCancellingRet(null)
            }}
          >
            بلی، ابطال کن
          </PrimaryBtn>
        </Modal>
      )}
      <p className="mt-2 text-center text-xs text-slate-400">قرمز = قرض ما زیاد شد · سبز = پرداخت/کم شد</p>
    </Modal>
  )
}

export default SupplierDetailModal
