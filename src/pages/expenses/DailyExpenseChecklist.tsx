import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { dailyExpenseItems, isShopClosed, setShopClosed, type DailyExpenseItem } from '../../lib/dailyExpenses'
import { fmtDateShort, fmtMoney, startOfDay } from '../../lib/format'
import NewExpenseModal from './NewExpenseModal'

export default function DailyExpenseChecklist() {
  const [selected, setSelected] = useState<DailyExpenseItem | null>(null)
  const today = startOfDay()
  const missing = useLiveQuery(() => dailyExpenseItems(), [])
  const closed = useLiveQuery(() => isShopClosed(), []) ?? false
  const todayItems = missing?.filter((item) => item.day === today) ?? []
  const overdue = missing?.filter((item) => item.day < today) ?? []
  const hasDaily = useLiveQuery(() => db.expenseCategories.filter((category) => !category.deleted && category.dailyEnabled === true).count(), [])
  if (!hasDaily) return null

  return (
    <>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="font-bold text-amber-900">مصارف روزانه</p>
            <p className="text-xs text-amber-700">ثبت خودکار نیست؛ مبلغ واقعی را تأیید کنید.</p>
          </div>
          <button
            className={`rounded-lg px-3 py-1.5 text-xs font-bold ${closed ? 'bg-slate-700 text-white' : 'bg-white text-slate-600'}`}
            onClick={() => void setShopClosed(Date.now(), !closed)}
          >
            {closed ? 'امروز بسته است ✓' : 'امروز دکان بسته است'}
          </button>
        </div>
        {!closed && todayItems.length === 0 && <p className="rounded-lg bg-teal-50 p-2 text-sm font-bold text-teal-700">مصارف روزانهٔ امروز تکمیل است ✓</p>}
        {!closed && todayItems.map((item) => <DailyRow key={`${item.day}:${item.category.id}`} item={item} onSelect={setSelected} />)}
        {overdue.length > 0 && (
          <div className="mt-2 border-t border-amber-200 pt-2">
            <p className="mb-1 text-xs font-bold text-red-600">عقب‌مانده از روزهای گذشته: {overdue.length}</p>
            {overdue.map((item) => <DailyRow key={`${item.day}:${item.category.id}`} item={item} onSelect={setSelected} />)}
          </div>
        )}
      </div>
      {selected && <NewExpenseModal preset={{ date: selected.day, category: selected.category }} onClose={() => setSelected(null)} />}
    </>
  )
}

function DailyRow({ item, onSelect }: { item: DailyExpenseItem; onSelect: (item: DailyExpenseItem) => void }) {
  return (
    <button className="mb-1 flex w-full items-center justify-between rounded-lg bg-white p-2 text-right last:mb-0" onClick={() => onSelect(item)}>
      <span>
        <span className="block font-bold text-slate-700">{item.category.name}</span>
        <span className="text-xs text-slate-500">{fmtDateShort(item.day)}</span>
      </span>
      <span className="text-xs font-bold text-teal-700">{item.category.dailyDefaultAmount ? `${fmtMoney(item.category.dailyDefaultAmount)} پیشنهادی` : 'ثبت مبلغ'}</span>
    </button>
  )
}
