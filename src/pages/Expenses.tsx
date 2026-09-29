import { useState } from 'react'
import ExpenseStats from './expenses/ExpenseStats'
import ExpenseList from './expenses/ExpenseList'
import CashView from './expenses/CashView'

export default function Expenses({ onBack, openNew = false, start = 'expenses' }: { onBack?: () => void; openNew?: boolean; start?: 'expenses' | 'cash' | 'reconcile' }) {
  const [view, setView] = useState<'expenses' | 'cash' | 'stats'>(start === 'expenses' ? 'expenses' : 'cash')
  return (
    <div className="p-4">
      <div className="page-heading">
        <div><h1>پول و مصارف</h1><p>ثبت و بررسی پول‌های بیرون‌شده از دکان</p></div>
        {onBack && <button onClick={onBack} className="customers-back" aria-label="برگشت">برگشت</button>}
      </div>
      <div className="segmented mb-4" aria-label="بخش‌های پول و مصارف">
        {([{ id: 'expenses', label: 'مصارف' }, { id: 'cash', label: 'صندوق' }, { id: 'stats', label: 'راپور مصارف' }] as const).map(item => <button key={item.id} aria-pressed={view === item.id} onClick={() => setView(item.id)}>{item.label}</button>)}
      </div>
      {view === 'expenses' ? (
        <ExpenseList openNew={openNew} onOpenCash={() => setView('cash')} onOpenStats={() => setView('stats')} />
      ) : view === 'cash' ? (
        <CashView startReconcile={start === 'reconcile'} />
      ) : (
        <ExpenseStats />
      )}
    </div>
  )
}

