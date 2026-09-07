import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type Expense } from '../../db'
import { Modal } from '../../components/ui'
import { fmtDate, fmtMoney } from '../../lib/format'
import { deleteExpense, expenseCashPaid, expenseCreditAmount } from '../../lib/ops'
import { TYPE_LABELS } from './labels'

/** Shared list/calendar entry; accounting stays in ops, never in the view. */
export default function ExpenseDetails({ expenseId, onClose, onCorrect }: {
  expenseId: number
  onClose: () => void
  onCorrect: (expense: Expense) => void
}) {
  const result = useLiveQuery(async () => ({ expense: await db.expenses.get(expenseId) }), [expenseId])
  const expense = result?.expense
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  // A refreshed record must be reviewed again before a destructive action.
  useEffect(() => { setConfirmDelete(false); setError('') }, [expense])
  const close = () => { if (!busy.current) onClose() }
  const available = expense && !expense.deleted
  const canCorrect = available && expense.type === 'business' && !expense.shopClosed && expense.amount > 0

  return (
    <Modal title="جزئیات مصرف" onClose={close}>
      {!available ? <p role="status">{!result ? 'در حال خواندن سند…' : 'این سند در دسترس نیست یا حذف شده است.'}</p> : <>
        <div className="mb-4 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-bold text-slate-800">{expense.categoryName}</p>
          <p className="mt-1 text-slate-500">{TYPE_LABELS[expense.type]} · {fmtDate(expense.date)}</p>
          <p className="my-3 text-xl font-bold text-slate-800">{fmtMoney(expense.amount)}</p>
          <p>نقد: {fmtMoney(expenseCashPaid(expense))}</p>
          <p>قرض: {fmtMoney(expenseCreditAmount(expense))}{expense.creditorName ? ` — ${expense.creditorName}` : ''}</p>
          {expense.partnerName && <p className="mt-2">از سهم: {expense.partnerName}</p>}
          {expense.note && <p className="mt-2 whitespace-pre-wrap break-words text-slate-600">{expense.note}</p>}
        </div>
        {!accessFlags.readOnly && <>
          {confirmDelete ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm">
            <h3 className="font-bold text-red-800">اثر حذف همین سند</h3>
            <p className="mt-2">بخش نقدی به صندوق برمی‌گردد: {fmtMoney(expenseCashPaid(expense))}</p>
            {expenseCreditAmount(expense) > 0 && <>
              <p className="mt-2">قرض به {expense.creditorName || 'طلبکار سند'} کم می‌شود: {fmtMoney(expenseCreditAmount(expense))}</p>
              <p className="mt-2">تسویه‌های قبلی حذف نمی‌شوند؛ اگر بیشتر از قرض پرداخت کرده باشید، باقی طلب شما می‌شود.</p>
            </>}
            {expense.drawAmount !== undefined && <p className="mt-2">این مبلغ از برداشت ثبت‌شدهٔ مالک یا شریک نیز برداشته می‌شود.</p>}
            <p className="mt-2">سند از مصارف فعال و راپور مربوط خارج می‌شود؛ موجودی گدام تغییر نمی‌کند. رد سند در داده‌ها باقی می‌ماند.</p>
            <p className="mt-2 font-bold">اگر فقط رقم اشتباه است، {canCorrect ? 'از «اصلاح سند» استفاده کنید.' : 'حذف و ثبت دوباره را تنها پس از بررسی حساب انجام دهید.'}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button className="rounded-xl border border-slate-300 bg-white py-3 font-bold text-slate-700" disabled={saving} onClick={() => setConfirmDelete(false)}>انصراف</button>
              <button className="rounded-xl bg-red-700 py-3 font-bold text-white disabled:opacity-40" disabled={saving} onClick={async () => {
                if (busy.current || accessFlags.readOnly) return
                busy.current = true
                setSaving(true)
                setError('')
                try {
                  await deleteExpense(expenseId)
                  onClose()
                } catch (cause) {
                  setError(cause instanceof Error ? cause.message : String(cause))
                } finally {
                  busy.current = false
                  setSaving(false)
                }
              }}>{saving ? 'در حال حذف…' : 'تأیید حذف همین سند'}</button>
            </div>
          </div> : <div className="flex flex-col gap-2">
            {canCorrect && <button className="rounded-xl bg-teal-700 py-3 font-bold text-white" onClick={() => onCorrect(expense)}>اصلاح سند</button>}
            <button className="rounded-xl border border-red-200 py-3 font-bold text-red-700" onClick={() => setConfirmDelete(true)}>حذف سند اشتباهی</button>
          </div>}
          {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
        </>}
      </>}
    </Modal>
  )
}
