import { useEffect, useState } from 'react'
import { type Payment } from '../../db'
import {
  correctLenderPayment,
  previewLenderPaymentCorrection,
  type LenderPaymentCorrectionPreview
} from '../../lib/ops'
import { fmtMoney, parseNum, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/** اصلاح امن سند پول قرض‌دار — قرض گرفته‌شده، پرداخت به او یا قرض قبلی پولی */
export function CorrectLenderPaymentModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const [amount, setAmount] = useState(String(Math.abs(payment.amount)))
  const [dateStr, setDateStr] = useState(toDateInput(payment.date))
  const [note, setNote] = useState(payment.note ?? '')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<LenderPaymentCorrectionPreview | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const total = parseNum(amount)
  const formValid = total > 0 && Boolean(dateStr) && Boolean(reason.trim())

  useEffect(() => {
    let cancelled = false
    if (!formValid || !payment.id) {
      setPreview(null)
      return () => {
        cancelled = true
      }
    }
    void previewLenderPaymentCorrection(payment.id, { date: fromDateInput(dateStr), amount: total, note, reason })
      .then((next) => {
        if (!cancelled) setPreview(next)
      })
      .catch((e) => {
        if (!cancelled) {
          setPreview(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, dateStr, note, reason, formValid, payment.id])

  const hasNegativeCash = preview?.cash.some((row) => row.after < 0) ?? false
  const isLoan = payment.amount < 0
  return (
    <Modal title={`اصلاح سند — ${payment.partyName}`} onClose={onClose}>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-bold text-amber-900">سند فعلی</p>
        <p className="mt-1 text-slate-700">
          {isLoan ? 'قرض گرفته‌شده' : payment.via === 'opening' ? 'قرض قبلی (پیش از اپ)' : 'پرداخت/قرض به او'}: {fmtMoney(Math.abs(payment.amount))}
        </p>
        {payment.note && <p className="text-xs text-slate-500">{payment.note}</p>}
      </div>

      <Field label="مبلغ درست *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="تاریخ درست *">
        <input className={inputCls} type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </Field>
      <Field label="یادداشت سند">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="دلیل اصلاح *">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً رقم کم یا زیاد نوشته شده بود" />
      </Field>

      {preview && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="mb-2 font-bold text-slate-700">اثر قبل و بعد</p>
          <div className="mb-1 flex items-center justify-between gap-2">
            <span>حساب {preview.lenderName}</span>
            <span className="font-bold">فعلی {fmtMoney(preview.before)} · بعد {fmtMoney(preview.after)}</span>
          </div>
          {preview.cash.map((row) => (
            <div key={`cash-${row.box}`} className={`flex items-center justify-between gap-2 ${row.after < 0 ? 'font-bold text-red-600' : ''}`}>
              <span>صندوق «{row.box}»</span>
              <span>فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {hasNegativeCash && <p className="mt-2 font-bold text-red-600">پول صندوق برای این اصلاح کافی نیست.</p>}
        </div>
      )}
      <p className="mb-3 text-xs text-slate-500">
        سند قبلی پاک نمی‌شود؛ با علامت «اصلاح‌شده» نگه داشته می‌شود. اسناد کفش از اینجا اصلاح نمی‌شوند.
      </p>
      {error && <p className="mb-2 text-sm font-bold text-red-600">{error}</p>}
      <PrimaryBtn
        disabled={!formValid || !preview || saving || hasNegativeCash}
        onClick={async () => {
          if (!payment.id) return
          try {
            setSaving(true)
            setError('')
            await correctLenderPayment(payment.id, { date: fromDateInput(dateStr), amount: total, note, reason })
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setSaving(false)
          }
        }}
      >
        {saving ? 'در حال ثبت…' : 'ثبت اصلاح سند'}
      </PrimaryBtn>
    </Modal>
  )
}

export default CorrectLenderPaymentModal
