import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, accessFlags } from './db'
import { PinPad, hashPin } from './components/PinLock'
import Reports from './pages/Reports'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Purchases from './pages/Purchases'
import Customers from './pages/Customers'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import Login from './pages/Login'
import { useExpenseReminder } from './lib/useExpenseReminder'
import { useDebtReminder } from './lib/useDebtReminder'
import { fmtNum, fmtMoney } from './lib/format'
import { getSupa, getProfile, type Profile } from './lib/supa'
import { startSync, syncNow } from './lib/sync'

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
  // auth: 'none' = بدون سرور، 'anon' = سرور هست ولی وارد نشده
  const [auth, setAuth] = useState<'loading' | 'none' | 'anon' | Profile>('loading')
  const reminder = useExpenseReminder()
  const debtReminder = useDebtReminder()

  const serverCfg = useLiveQuery(async () => {
    const url = (await db.settings.get('supaUrl'))?.value
    const key = (await db.settings.get('supaKey'))?.value
    return Boolean(url && key)
  }, [])

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (serverCfg === undefined) return
      if (!serverCfg) {
        setAuth('none')
        return
      }
      // پروفایل ذخیره‌شده: اپ باید فوراً باز شود (آفلاین یا انترنت کند)؛
      // بررسی سرور در پس‌زمینه انجام می‌شود و لازم نیست کاربر منتظر بماند
      const cached = ((await db.settings.get('cachedProfile'))?.value as Profile | undefined) ?? null
      if (cached && !cancelled) {
        setAuth(cached)
        startSync()
      }
      try {
        const supa = await getSupa()
        const { data } = await supa!.auth.getSession()
        if (cancelled) return
        if (!data.session) {
          // سشن یافت نشد: آفلاین با پروفایل ذخیره‌شده ادامه می‌دهیم، آنلاین یعنی واقعاً خارج شده
          if (cached && !navigator.onLine) return
          setAuth('anon')
          return
        }
        const profile = await getProfile().catch(() => null)
        if (cancelled) return
        if (profile) {
          await db.settings.put({ key: 'cachedProfile', value: profile })
          setAuth(profile)
          startSync()
        } else if (!cached) {
          setAuth('anon')
        }
      } catch {
        // خطای شبکه: اگر پروفایل ذخیره‌شده داریم اپ از قبل باز است؛ وگرنه صفحهٔ ورود
        if (cancelled) return
        if (!cached) setAuth('anon')
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [serverCfg])

  const pinHash = useLiveQuery(async () => {
    const s = await db.settings.get('pinHash')
    return (s?.value as string | undefined) ?? null
  }, [])

  // اگر هنگام باز شدن اپ قفلی نبود، فعال‌کردن قفل وسط کار نباید همان لحظه قفل کند
  useEffect(() => {
    if (pinHash === null) setUnlocked(true)
  }, [pinHash])

  if (pinHash === undefined || auth === 'loading') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 text-slate-500">
        <span className="text-4xl">👞</span>
        <p className="font-bold">فروشگاه اتل</p>
        <p className="animate-pulse text-sm">در حال باز شدن...</p>
      </div>
    )
  }

  if (auth === 'anon') {
    return (
      <Login
        onDone={async () => {
          setTab('dashboard')
          const profile = await getProfile().catch(() => null)
          if (profile) await db.settings.put({ key: 'cachedProfile', value: profile })
          setAuth(profile ?? 'anon')
          if (profile) {
            startSync()
            void syncNow()
          }
        }}
      />
    )
  }

  const role = typeof auth === 'object' ? auth.role : null
  const isStaff = role === 'staff'
  const readOnly = role === 'viewer'
  accessFlags.readOnly = readOnly

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
      {(reminder.show || debtReminder.show) && (
        <div className="pointer-events-none fixed right-0 left-0 bottom-36 z-50 mx-auto flex max-w-lg flex-col gap-2 px-3">
          {debtReminder.show && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-red-600 p-3 text-white shadow-lg">
              <span className="flex-1 text-sm font-bold">
                ⏰ {fmtNum(debtReminder.count)} مشتری قرضدار — {fmtMoney(debtReminder.total)}. امروز تقاضا کنید!
              </span>
              <button
                className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
                onClick={() => {
                  setTab('customers')
                  void debtReminder.dismissToday()
                }}
              >
                قرضداران
              </button>
              <button className="px-1" onClick={() => void debtReminder.dismissToday()}>
                ✕
              </button>
            </div>
          )}
          {reminder.show && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-amber-500 p-3 text-white shadow-lg">
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
          )}
        </div>
      )}
      {readOnly && (
        <div className="bg-purple-600 px-4 py-1.5 text-center text-xs font-bold text-white">👁️ حالت فقط مشاهده (شریک) — تغییر ارقام ممکن نیست</div>
      )}
      {tab === 'dashboard' && <Dashboard goTo={(t) => setTab(t as TabId)} isStaff={isStaff} />}
      {tab === 'sales' && <Sales />}
      {tab === 'inventory' && <Inventory />}
      {tab === 'purchases' && <Purchases />}
      {tab === 'expenses' && <Expenses />}
      {tab === 'customers' && <Customers />}
      {tab === 'settings' && <Settings onBack={() => setTab('dashboard')} isStaff={isStaff || readOnly} onLogout={() => setAuth('anon')} />}
      {tab === 'reports' && !isStaff && <Reports onBack={() => setTab('dashboard')} />}

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
