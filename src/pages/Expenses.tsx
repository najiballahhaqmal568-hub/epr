import { useState } from 'react'
import ExpenseStats from './expenses/ExpenseStats'
import ExpenseList from './expenses/ExpenseList'
import CashView from './expenses/CashView'

export default function Expenses() {
  const [view, setView] = useState<'expenses' | 'cash' | 'stats'>('expenses')
  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`
  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">مصارف و صندوق</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('expenses')} className={tabCls('expenses')}>
          مصارف
        </button>
        <button onClick={() => setView('cash')} className={tabCls('cash')}>
          صندوق
        </button>
        <button onClick={() => setView('stats')} className={tabCls('stats')}>
          آمار
        </button>
      </div>
      {view === 'expenses' ? <ExpenseList /> : view === 'cash' ? <CashView /> : <ExpenseStats />}
    </div>
  )
}

