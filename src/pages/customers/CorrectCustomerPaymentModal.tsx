import { useEffect, useState } from 'react'
import { type Payment } from '../../db'
import {
  correctCustomerPayment,
  previewCustomerPaymentCorrection,
  type CustomerPaymentCorrectionInput,
  type CustomerPaymentCorrectionPreview
} from '../../lib/ops'
import { fmtMoney, parseNum, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/** اصلاح امن دریافت پول از مشتری — همان الگوی «اصلاح سند» پرداخت فروشنده. */
export function CorrectCustomerPaymentModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const [amount, setAmount] = useState(String(payment.amount))
  const [dateStr, setDateStr] = useState(toDateInput(payment.date))
  const [bookPage, setBookPage] = useState(payment.bookPage ?? '')
  const [note, setNote] = useState(payment.note ?? '')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<CustomerPaymentCorrectionPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const total = parseNum(amount)
  const formValid = total > 0 && Boolean(dateStr) && Boolean(reason.trim())

  const input = (): CustomerPaymentCorrectionInput => ({
    date: fromDateInput(dateStr),
    amount: total,
    bookPage,
    note,
    reason
  })

  useEffect(() => {
    let cancelled = false
    if (!formValid || !payment.id) {
      setPreview(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)
    setError('')
    void previewCustomerPaymentCorrection(payment.id, input())
      .then((next) => {
        if (!cancelled) setPreview(next)
      })
      .catch((e) => {
        if (!cancelled) {
          setPreview(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, dateStr, bookPage, note, reason, formValid, payment.id])

  const hasNegativeCash = preview?.cash.some((row) => row.after < 0) ?? false
  return (
    <Modal title={`اصلاح دریافت — ${payment.partyName}`} onClose={onClose}>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-bold text-amber-900">سند فعلی</p>
        <p className="mt-1 text-slate-700">مبلغ: {fmtMoney(payment.amount)}</p>
        <p className="text-xs text-slate-500">
          {payment.bookPage?.trim() ? `📖 صفحهٔ ${payment.bookPage.trim()}` : 'بدون صفحهٔ دفتر'}
          {payment.note?.trim() ? ` · ${payment.note.trim()}` : ''}
        </p>
      </div>

      <Field label="مبلغ درست *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="تاریخ درست *">
        <input className={inputCls} type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </Field>
      <Field label="صفحهٔ دفتر (اختیاری)">
        <input className={inputCls} value={bookPage} onChange={(e) => setBookPage(e.target.value)} placeholder="مثلاً ۱۲" />
      </Field>
      <Field label="یادداشت سند">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="دلیل اصلاح *">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً مبلغ کم یا زیاد نوشته شده بود" />
      </Field>

      {loading && <p className="mb-3 text-center text-sm text-slate-400">در حال محاسبهٔ اثر اصلاح…</p>}
      {preview && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="mb-2 font-bold text-slate-700">اثر قبل و بعد</p>
          {preview.accounts.map((row) => (
            <div key={`party-${row.partyId}`} className="mb-1 flex items-center justify-between gap-2">
              <span>قرض {row.partyName}</span>
              <span className="font-bold">فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {preview.cash.map((row) => (
            <div key={`cash-${row.box}`} className={`mb-1 flex items-center justify-between gap-2 ${row.after < 0 ? 'text-red-600' : ''}`}>
              <span>صندوق «{row.box}»</span>
              <span className="font-bold">فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {hasNegativeCash && <p className="mt-2 font-bold text-red-600">پول صندوق برای این اصلاح کافی نیست.</p>}
        </div>
      )}
      <p className="mb-3 text-xs text-slate-500">
        سند قبلی پاک نمی‌شود؛ با علامت «اصلاح‌شده» نگه داشته می‌شود و سند درست جای آن ثبت می‌گردد.
      </p>
      {error && <p className="mb-2 text-sm font-bold text-red-600">{error}</p>}
      <div className="sticky -bottom-8 -mx-4 -mb-8 border-t border-slate-100 bg-white px-4 pb-8 pt-3">
        <PrimaryBtn
          disabled={!formValid || !preview || loading || saving || hasNegativeCash}
          onClick={async () => {
            if (!payment.id) return
            try {
              setSaving(true)
              setError('')
              await correctCustomerPayment(payment.id, input())
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
      </div>
    </Modal>
  )
}

export default CorrectCustomerPaymentModal
