import { useState } from 'react'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Customers from './pages/Customers'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'

const tabs = [
  { id: 'dashboard', label: 'داشبورد', icon: '🏠' },
  { id: 'sales', label: 'فروش', icon: '🧾' },
  { id: 'inventory', label: 'گدام', icon: '👞' },
  { id: 'purchases', label: 'خرید', icon: '📦' },
  { id: 'expenses', label: 'مصارف', icon: '💵' },
  { id: 'customers', label: 'مشتریان', icon: '👥' }
] as const

type TabId = (typeof tabs)[number]['id'] | 'settings'

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard')

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-20">
      {tab === 'dashboard' && <Dashboard goTo={(t) => setTab(t as TabId)} />}
      {tab === 'sales' && <Sales />}
      {tab === 'inventory' && <Inventory />}
      {tab === 'purchases' && <Purchases />}
      {tab === 'expenses' && <Expenses />}
      {tab === 'customers' && <Customers />}
      {tab === 'settings' && <Settings onBack={() => setTab('dashboard')} />}

      <nav className="fixed bottom-0 right-0 left-0 z-40 mx-auto flex max-w-lg border-t border-slate-200 bg-white">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-1 flex-col items-center py-2 text-[11px] ${
              tab === t.id ? 'font-bold text-teal-700' : 'text-slate-500'
            }`}
          >
            <span className="text-lg leading-6">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
