import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Customer } from '../../db'
import { Modal, Skeleton, inputCls } from '../../components/ui'
import { fmtMoney, fmtNum } from '../../lib/format'

/** «از کدام مشتری پول گرفتید؟» — بعد از انتخاب، همان پنجرهٔ حساب مشتری با فرم دریافت باز می‌شود. */
export default function ReceivePicker({ onPick, onClose }: { onPick: (customer: Customer) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const debtors = useLiveQuery(
    async () => (await db.customers.filter((c) => !c.deleted && c.balance > 0).toArray()).sort((a, b) => b.balance - a.balance),
    []
  )
  const q = query.trim()
  const shown = (debtors ?? []).filter((c) => !q || c.name.includes(q)).slice(0, 30)
  return (
    <Modal title="از کدام مشتری پول گرفتید؟" onClose={onClose}>
      <input aria-label="جستجوی مشتری" className={`${inputCls} mb-3`} placeholder="نام مشتری…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {debtors === undefined && <Skeleton rows={4} label="در حال خواندن مشتریان…" />}
      {debtors !== undefined && debtors.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">هیچ مشتری قرضدار ندارید.</p>}
      {debtors !== undefined && debtors.length > 0 && shown.length === 0 && <p role="status" className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-600">مشتریِ قرضدار با این نام پیدا نشد.</p>}
      <div className="flex flex-col gap-2">
        {shown.map((c) => (
          <button key={c.id} type="button" onClick={() => onPick(c)} className="flex min-h-[56px] items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-right">
            <span className="font-bold text-slate-800">{c.name}</span>
            <span className="whitespace-nowrap text-sm font-bold text-blue-700">قرض {fmtMoney(c.balance)}</span>
          </button>
        ))}
      </div>
      {debtors !== undefined && debtors.length > shown.length && !q && <p className="mt-2 text-xs text-slate-500">{fmtNum(debtors.length - shown.length)} مشتری دیگر — نامش را بنویسید.</p>}
    </Modal>
  )
}
