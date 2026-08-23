import { useEffect, useState } from 'react'
import { type Payment } from '../../db'
import { correctOpeningDebt, previewOpeningDebtCorrection } from '../../lib/ops'
import { fmtMoney, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/** اصلاح امن «قرض قبلی» تأمین‌کننده/صراف — رقم اولیهٔ اشتباه درست می‌شود، سند قبلی رد حساب می‌ماند. */
export function CorrectOpeningDebtModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const [amount, setAmount] = useState(String(Math.abs(payment.amount)))
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<{ partyName: string; before: number; after: number } | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const total = parseNum(amount)
  const formValid = total > 0 && Boolean(reason.trim())

  useEffect(() => {
    let cancelled = false
    if (!formValid || !payment.id) {
      setPreview(null)
      return () => {
        cancelled = true
      }
    }
    void previewOpeningDebtCorrection(payment.id, { amount: total, note, reason })
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
  }, [amount, note, reason, formValid, payment.id])

  return (
    <Modal title={`اصلاح قرض قبلی — ${payment.partyName}`} onClose={onClose}>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-bold text-amber-900">سند فعلی</p>
        <p className="mt-1 text-slate-700">مبلغ: {fmtMoney(Math.abs(payment.amount))}</p>
        {payment.note && <p className="text-xs text-slate-500">{payment.note}</p>}
      </div>

      <Field label="مبلغ درست *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="یادداشت نو (اختیاری)">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="اگر خالی بماند یادداشت قبلی می‌ماند" />
      </Field>
      <Field label="دلیل اصلاح *">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً رقم کم یا زیاد نوشته شده بود" />
      </Field>

      {preview && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="mb-2 font-bold text-slate-700">اثر قبل و بعد</p>
          <div className="flex items-center justify-between gap-2">
            <span>قرض {preview.partyName}</span>
            <span className="font-bold">فعلی {fmtMoney(preview.before)} · بعد {fmtMoney(preview.after)}</span>
          </div>
        </div>
      )}
      <p className="mb-3 text-xs text-slate-500">
        سند قبلی پاک نمی‌شود؛ با علامت «اصلاح‌شده» نگه داشته می‌شود. به صندوق و گدام هیچ اثری ندارد.
      </p>
      {error && <p className="mb-2 text-sm font-bold text-red-600">{error}</p>}
      <PrimaryBtn
        disabled={!formValid || !preview || saving}
        onClick={async () => {
          if (!payment.id) return
          try {
            setSaving(true)
            setError('')
            await correctOpeningDebt(payment.id, { amount: total, note, reason })
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

export default CorrectOpeningDebtModal
