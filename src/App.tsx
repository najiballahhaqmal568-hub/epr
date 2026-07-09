import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import { PinPad, hashPin } from './components/PinLock'
import Reports from './pages/Reports'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Customers from './pages/Customers'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import { useExpenseReminder } from './lib/useExpenseReminder'

const tabs = [
  { id: 'dashboard', label: 'داشبورد', icon: '🏠' },
  { id: 'sales', label: 'فروش', icon: '🧾' },
  { id: 'inventory', label: 'گدام', icon: '👞' },
  { id: 'purchases', label: 'خرید', icon: '📦' },
  { id: 'expenses', label: 'مصارف', icon: '💵' },
  { id: 'customers', label: 'مشتریان', icon: '👥' }
] as const

type TabId = (typeof tabs)[number]['id'] | 'settings' | 'reports'

export default function App() {
  const [tab, setTab] = useState<TabId>('dashboard')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState('')
  const reminder = useExpenseReminder()

  const pinHash = useLiveQuery(async () => {
    const s = await db.settings.get('pinHash')
    return (s?.value as string | undefined) ?? null
  }, [])

  // اگر هنگام باز شدن اپ قفلی نبود، فعال‌کردن قفل وسط کار نباید همان لحظه قفل کند
  useEffect(() => {
    if (pinHash === null) setUnlocked(true)
  }, [pinHash])

  if (pinHash === undefined) return null
  if (pinHash && !unlocked) {
    return (
      <PinPad
        title="کود قفل را وارد کنید"
        error={pinError}
        onSubmit={async (pin) => {
          if ((await hashPin(pin)) === pinHash) {
            setUnlocked(true)
            setPinError('')
          } else {
            setPinError('کود اشتباه است')
          }
        }}
      />
    )
  }

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-20">
      {reminder.show && (
        <div className="fixed right-0 left-0 bottom-16 z-50 mx-auto max-w-lg px-3">
          <div className="flex items-center gap-2 rounded-xl bg-amber-500 p-3 text-white shadow-lg">
            <span className="flex-1 text-sm font-bold">💵 مصارف امروز را ثبت نکرده‌اید!</span>
            <button
              className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
              onClick={() => {
                setTab('expenses')
                reminder.dismissToday()
              }}
            >
              ثبت مصرف
            </button>
            <button className="px-1" onClick={() => reminder.dismissToday()}>
              ✕
            </button>
          </div>
        </div>
      )}
      {tab === 'dashboard' && <Dashboard goTo={(t) => setTab(t as TabId)} />}
      {tab === 'sales' && <Sales />}
      {tab === 'inventory' && <Inventory />}
      {tab === 'purchases' && <Purchases />}
      {tab === 'expenses' && <Expenses />}
      {tab === 'customers' && <Customers />}
      {tab === 'settings' && <Settings onBack={() => setTab('dashboard')} />}
      {tab === 'reports' && <Reports onBack={() => setTab('dashboard')} />}

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
