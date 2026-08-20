import { useState } from 'react'
import ExpenseStats from './expenses/ExpenseStats'
import ExpenseList from './expenses/ExpenseList'
import CashView from './expenses/CashView'

export default function Expenses({ onBack, openNew = false }: { onBack?: () => void; openNew?: boolean }) {
  const [view, setView] = useState<'expenses' | 'cash' | 'stats'>('expenses')
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="rounded-full bg-slate-100 px-3 py-1 text-slate-600" aria-label="برگشت">
            برگشت
          </button>
        )}
        <div>
          <h1 className="text-xl font-bold text-slate-800">{view === 'expenses' ? 'مصارف' : view === 'cash' ? 'صندوق' : 'راپور مصارف'}</h1>
          <p className="text-xs text-slate-500">ثبت و بررسی پول‌های بیرون‌شده از دکان</p>
        </div>
      </div>
      {view !== 'expenses' && (
        <button onClick={() => setView('expenses')} className="mb-3 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-bold text-slate-600">
          برگشت به مصارف
        </button>
      )}
      {view === 'expenses' ? (
        <ExpenseList openNew={openNew} onOpenCash={() => setView('cash')} onOpenStats={() => setView('stats')} />
      ) : view === 'cash' ? (
        <CashView />
      ) : (
        <ExpenseStats />
      )}
    </div>
  )
}

