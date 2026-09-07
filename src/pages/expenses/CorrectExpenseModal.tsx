import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Expense } from '../../db'
import {
  correctExpense,
  previewExpenseCorrection,
  expenseCashPaid,
  type ExpenseCorrectionInput,
  type ExpenseCorrectionPreview
} from '../../lib/ops'
import { fmtMoney, parseNum, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { TYPE_LABELS } from './labels'

/** اصلاح امن مصرف — مبلغ، تقسیم نقد/قرض، طلبکار، تاریخ و یادداشت با رد حساب و دلیل. */
export function CorrectExpenseModal({ expense, onClose }: { expense: Expense; onClose: () => void }) {
  const creditors = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && s.kind === 'expenseCreditor').toArray(),
    []
  )
  const oldCash = expenseCashPaid(expense)
  const [amount, setAmount] = useState(String(expense.amount))
  const [cashPart, setCashPart] = useState(String(oldCash))
  const [creditorId, setCreditorId] = useState<number | ''>(expense.creditorId ?? '')
  const [dateStr, setDateStr] = useState(toDateInput(expense.date))
  const [note, setNote] = useState(expense.note ?? '')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<ExpenseCorrectionPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)

  const total = parseNum(amount)
  const cash = parseNum(cashPart)
  const credit = total - cash
  // طلبکار فقط وقتی لازم است که بخش قرضی در کار باشد؛ اگر عوضش نکنیم همان قبلی می‌ماند
  const needsCreditor = credit > 0 && !expense.creditorId
  const formValid =
    total > 0 && cash >= 0 && cash <= total && Boolean(dateStr) && Boolean(reason.trim()) && (!needsCreditor || Boolean(creditorId))

  const input = (): ExpenseCorrectionInput => ({
    date: fromDateInput(dateStr),
    amount: total,
    cashPaid: cash,
    ...(credit > 0 ? { creditorId: creditorId !== '' ? Number(creditorId) : undefined } : {}),
    note,
    reason
  })

  useEffect(() => {
    let cancelled = false
    if (!formValid || !expense.id) {
      setPreview(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)
    setPreview(null)
    setError('')
    void previewExpenseCorrection(expense.id, input())
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
  }, [amount, cashPart, creditorId, dateStr, note, reason, formValid, expense.id])

  const hasNegativeCash = preview?.cash.some((row) => row.after < 0) ?? false
  return (
    <Modal title={`اصلاح مصرف — ${expense.categoryName}`} onClose={() => { if (!busy.current) onClose() }}>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-bold text-amber-900">سند فعلی</p>
        <p className="mt-1 text-slate-700">نوع مصرف: {TYPE_LABELS[expense.type]} (ثابت)</p>
        {(expense.type === 'home' || expense.type === 'personal') && <p className="mt-1 text-slate-700">صاحب سهم: {expense.partnerName || 'مالک (بی‌نام)'} (ثابت)</p>}
        <p className="mt-1 text-slate-700">مبلغ: {fmtMoney(expense.amount)}</p>
        <p className="text-xs text-slate-500">
          نقد {fmtMoney(oldCash)}
          {(expense.creditAmount ?? 0) > 0 ? ` · قرض ${fmtMoney(expense.creditAmount ?? 0)} به ${expense.creditorName}` : ''}
        </p>
      </div>

      <fieldset disabled={saving}>
      <Field label="مبلغ درست *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="بخش نقدی (باقی قرض می‌شود) *">
        <input className={inputCls} inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value)} />
      </Field>
      {(credit > 0 || (expense.creditAmount ?? 0) > 0) && (
        <Field label="طلبکار بخش قرضی">
          <select
            className={inputCls}
            value={creditorId}
            onChange={(e) => setCreditorId(e.target.value ? Number(e.target.value) : '')}
          >
            {!expense.creditorId && <option value="">انتخاب کنید...</option>}
            {creditors?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {credit > 0 && creditorId === '' && expense.creditorId && (
        <p className="mb-3 -mt-2 text-xs font-bold text-amber-700">اگر انتخاب نکنید، قرض به نام «{expense.creditorName}» می‌ماند.</p>
      )}
      <Field label="تاریخ درست *">
        <input className={inputCls} type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </Field>
      <Field label="یادداشت سند">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="دلیل اصلاح *">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً مبلغ یا تقسیم نقد و قرض اشتباه بود" />
      </Field>
      </fieldset>

      {loading && <p className="mb-3 text-center text-sm text-slate-400">در حال محاسبهٔ اثر اصلاح…</p>}
      {preview && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="mb-2 font-bold text-slate-700">اثر قبل و بعد</p>
          {preview.accounts.map((row) => (
            <div key={`party-${row.partyId}`} className={`mb-1 flex items-center justify-between gap-2 ${row.after < 0 ? 'text-red-600' : ''}`}>
              <span>{row.partyName}</span>
              <span className="font-bold">فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {preview.cash.map((row) => (
            <div key={`cash-${row.box}`} className={`mb-1 flex items-center justify-between gap-2 ${row.after < 0 ? 'text-red-600' : ''}`}>
              <span>صندوق «{row.box}»</span>
              <span className="font-bold">فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {preview.draw && (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="font-bold">برداشت همین سند از سهم {preview.draw.partnerName || 'مالک (بی‌نام)'}</p>
              <p>فعلی {fmtMoney(preview.draw.before)} · بعد {fmtMoney(preview.draw.after)}</p>
              <p className="mt-1 text-xs text-slate-500">کل مبلغ، شامل نقد و قرض، برداشت است؛ مصرف تجارت و مفاد فروش تغییر نمی‌کند.</p>
            </div>
          )}
          {preview.accounts.some((row) => row.after < 0) && (
            <p className="mt-2 text-xs font-bold text-slate-500">منفی یعنی از این شخص بیش از قرضش پرداخت شده — طلب ما می‌شود.</p>
          )}
          {hasNegativeCash && <p className="mt-1 font-bold text-red-600">پول صندوق برای این اصلاح کافی نیست.</p>}
        </div>
      )}
      <p className="mb-3 text-xs text-slate-500">
        سند قبلی پاک نمی‌شود؛ با علامت «اصلاح‌شده» نگه داشته می‌شود و سند درست جای آن ثبت می‌گردد. تسویه‌های قبلی طلبکار سالم می‌مانند.
      </p>
      {error && <p role="alert" className="mb-2 text-sm font-bold text-red-600">{error}</p>}
      <div className="sticky -bottom-8 -mx-4 -mb-8 border-t border-slate-100 bg-white px-4 pb-8 pt-3">
        <PrimaryBtn
          disabled={!formValid || !preview || loading || saving || hasNegativeCash}
          onClick={async () => {
            if (!expense.id || busy.current) return
            busy.current = true
            try {
              setSaving(true)
              setError('')
              await correctExpense(expense.id, input())
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              busy.current = false
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

export default CorrectExpenseModal
