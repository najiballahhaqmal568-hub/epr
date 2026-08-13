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
import ResetPassword from './pages/ResetPassword'
import { useExpenseReminder } from './lib/useExpenseReminder'
import { useDebtReminder } from './lib/useDebtReminder'
import { useIntegrityCheck } from './lib/useIntegrityCheck'
import { fmtNum, fmtMoney } from './lib/format'
import { getSupa, getProfile, getServerConfig, isPasswordRecoveryUrl, type Profile } from './lib/supa'
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
  // سشن سرور تمام شده ولی اپ باید باز بماند — دکان با انترنت کار نمی‌کند
  const [relogin, setRelogin] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryUrl)
  const reminder = useExpenseReminder()
  const debtReminder = useDebtReminder()
  const integrity = useIntegrityCheck()

  const serverCfg = useLiveQuery(async () => Boolean(await getServerConfig()), [])

  useEffect(() => {
    if (!serverCfg) return
    let unsubscribe: (() => void) | undefined
    void getSupa().then((supa) => {
      if (!supa) return
      const { data } = supa.auth.onAuthStateChange((event) => {
        if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      })
      unsubscribe = () => data.subscription.unsubscribe()
    })
    return () => unsubscribe?.()
  }, [serverCfg])

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (serverCfg === undefined || passwordRecovery) return
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
          // سشن سرور تمام شده (توکن کهنه شده یا انترنت مدتی نبوده).
          // معلومات دکان در خودِ گوشی است، پس اپ نباید بسته شود و کار نو ایستاد —
          // فقط همگام‌سازی متوقف می‌شود و یک نوار می‌گوید دوباره وارد شوید.
          // «خروج» واقعی cachedProfile را پاک می‌کند، پس آن راه بسته نمی‌شود.
          if (cached) {
            setRelogin(true)
            return
          }
          setAuth('anon')
          return
        }
        setRelogin(false)
        let profile: Profile | null
        try {
          profile = await getProfile()
        } catch (e) {
          if (cancelled) return
          const message =
            typeof e === 'object' && e !== null && 'message' in e
              ? String((e as { message?: unknown }).message)
              : String(e)
          const authFailed = /(jwt|token|session|unauthori[sz]ed|not authenticated|401)/i.test(message)
          if (cached && authFailed) setRelogin(true)
          else if (!cached) setAuth('anon')
          return
        }
        if (cancelled) return
        if (profile) {
          await db.settings.put({ key: 'cachedProfile', value: profile })
          setAuth(profile)
          startSync()
        } else if (cached) {
          setRelogin(true)
        } else {
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
  }, [serverCfg, passwordRecovery])

  const cachedProfile = useLiveQuery(
    async () => ((await db.settings.get('cachedProfile'))?.value as Profile | undefined) ?? null,
    []
  )

  const pinHash = useLiveQuery(async () => {
    const s = await db.settings.get('pinHash')
    return (s?.value as string | undefined) ?? null
  }, [])

  // اگر هنگام باز شدن اپ قفلی نبود، فعال‌کردن قفل وسط کار نباید همان لحظه قفل کند
  useEffect(() => {
    if (pinHash === null) setUnlocked(true)
  }, [pinHash])

  if (passwordRecovery) {
    return (
      <ResetPassword
        onDone={() => {
          setPasswordRecovery(false)
          setRelogin(false)
          setAuth('anon')
        }}
      />
    )
  }

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
        // اگر پروفایل ذخیره‌شده داریم، راه برگشت باز است — دکان نباید پشت صفحهٔ ورود بماند
        onSkip={
          cachedProfile
            ? () => {
                setAuth(cachedProfile)
                setRelogin(true)
              }
            : undefined
        }
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
      {relogin && (
        <div className="flex items-center gap-2 bg-amber-500 p-2.5 text-white">
          <span className="flex-1 text-sm font-bold">
            🔄 همگام‌سازی متوقف است — کار شما ثبت می‌شود، ولی به موبایل دیگر نمی‌رود.
          </span>
          <button
            className="rounded-lg bg-white/25 px-3 py-1 text-sm font-bold"
            onClick={() => {
              setRelogin(false)
              setAuth('anon')
            }}
          >
            ورود دوباره
          </button>
        </div>
      )}
      {(reminder.show || debtReminder.show || integrity.show) && (
        <div className="pointer-events-none fixed right-0 left-0 bottom-36 z-50 mx-auto flex max-w-lg flex-col gap-2 px-3">
          {integrity.show && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-purple-700 p-3 text-white shadow-lg">
              <span className="flex-1 text-sm font-bold">
                ⚠️ کنترل حساب‌ها: {fmtNum(integrity.count)} عدد با اسناد نمی‌خواند
              </span>
              <button
                className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
                onClick={() => {
                  setTab('settings')
                  integrity.dismiss()
                }}
              >
                دیدن
              </button>
              <button className="px-1" onClick={() => integrity.dismiss()}>
                ✕
              </button>
            </div>
          )}
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
              <span className="flex-1 text-sm font-bold">💵 {fmtNum(reminder.count)} مصرف روزانه ثبت نشده است!</span>
              <button
                className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
                onClick={() => {
                  setTab('expenses')
                }}
              >
                دیدن فهرست
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
      {tab === 'sales' && <Sales isStaff={isStaff} />}
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
