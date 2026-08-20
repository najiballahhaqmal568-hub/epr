import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, accessFlags } from './db'
import { PinPad, hashPin } from './components/PinLock'
import Reports from './pages/Reports'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Inventory from './pages/Inventory'
import Purchases, { type PurchaseView } from './pages/Purchases'
import Customers from './pages/Customers'
import Expenses from './pages/Expenses'
import Accounts from './pages/Accounts'
import More from './pages/More'
import Settings, { type SettingsSection } from './pages/Settings'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import { useExpenseReminder } from './lib/useExpenseReminder'
import { useDebtReminder } from './lib/useDebtReminder'
import { useIntegrityCheck } from './lib/useIntegrityCheck'
import { fmtNum, fmtMoney } from './lib/format'
import { getSupa, getProfile, getServerConfig, isPasswordRecoveryUrl, type Profile } from './lib/supa'
import { startSync, syncNow } from './lib/sync'

const tabs = [
  { id: 'dashboard', label: 'خانه' },
  { id: 'sales', label: 'فروش' },
  { id: 'inventory', label: 'گدام' },
  { id: 'accounts', label: 'حساب‌ها' },
  { id: 'more', label: 'بیشتر' }
] as const

type NavTabId = (typeof tabs)[number]['id']
type TabId = NavTabId | 'purchases' | 'expenses' | 'customers' | 'settings' | 'reports'

export default function App() {
  const uiPreview = import.meta.env.DEV && new URLSearchParams(window.location.search).has('ui-preview')
  const [tab, setTab] = useState<TabId>('dashboard')
  const [openNewSale, setOpenNewSale] = useState(false)
  const [openNewPurchase, setOpenNewPurchase] = useState(false)
  const [openNewExpense, setOpenNewExpense] = useState(false)
  const [purchaseView, setPurchaseView] = useState<PurchaseView>('history')
  const [purchaseBack, setPurchaseBack] = useState<'inventory' | 'accounts'>('inventory')
  const [openInventoryReorder, setOpenInventoryReorder] = useState(false)
  const [expensesBack, setExpensesBack] = useState<'dashboard' | 'accounts' | 'more'>('more')
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('all')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState('')
  // auth: 'none' = بدون سرور، 'anon' = سرور هست ولی وارد نشده
  const [auth, setAuth] = useState<'loading' | 'none' | 'anon' | Profile>(uiPreview ? 'none' : 'loading')
  // سشن سرور تمام شده ولی اپ باید باز بماند — دکان با انترنت کار نمی‌کند
  const [relogin, setRelogin] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryUrl)
  const reminder = useExpenseReminder()
  const debtReminder = useDebtReminder()
  const integrity = useIntegrityCheck()

  const openPurchases = (view: PurchaseView, back: 'inventory' | 'accounts', startNew = false) => {
    setPurchaseView(view)
    setPurchaseBack(back)
    setOpenNewPurchase(startNew)
    setTab('purchases')
  }

  const goTo = (target: string) => {
    if (target === 'sales-new') {
      setOpenNewSale(true)
      setTab('sales')
      return
    }
    if (target === 'purchases-new') {
      openPurchases('history', 'inventory', true)
      return
    }
    if (target === 'expenses-new') {
      setExpensesBack('dashboard')
      setOpenNewExpense(true)
      setTab('expenses')
      return
    }
    if (target === 'purchases') {
      openPurchases('history', 'inventory')
      return
    }
    if (target === 'expenses') {
      setExpensesBack('dashboard')
      setOpenNewExpense(false)
    }
    setTab(target as TabId)
  }

  const activeNav: NavTabId =
    tab === 'customers' ||
    (tab === 'purchases' && purchaseBack === 'accounts') ||
    (tab === 'expenses' && expensesBack === 'accounts')
      ? 'accounts'
      : tab === 'expenses' || tab === 'settings' || tab === 'reports'
        ? 'more'
        : tab === 'purchases'
          ? 'inventory'
          : tab

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
      if (uiPreview) return
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
  }, [serverCfg, passwordRecovery, uiPreview])

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
      {(integrity.show || (tab !== 'dashboard' && (reminder.show || debtReminder.show))) && (
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
          {tab !== 'dashboard' && debtReminder.show && (
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
          {tab !== 'dashboard' && reminder.show && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-amber-500 p-3 text-white shadow-lg">
              <span className="flex-1 text-sm font-bold">💵 {fmtNum(reminder.count)} مصرف روزانه ثبت نشده است!</span>
              <button
                className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
                onClick={() => {
                  setExpensesBack('more')
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
      {tab === 'dashboard' && (
        <Dashboard
          goTo={goTo}
          isStaff={isStaff}
          pendingExpenseCount={reminder.show ? reminder.count : 0}
          debtCount={debtReminder.show ? debtReminder.count : 0}
          debtTotal={debtReminder.show ? debtReminder.total : 0}
        />
      )}
      {tab === 'sales' && <Sales isStaff={isStaff} openNew={openNewSale} />}
      {tab === 'inventory' && (
        <Inventory
          onOpenPurchases={() => openPurchases('history', 'inventory')}
          openReorder={openInventoryReorder}
          onReorderClosed={() => setOpenInventoryReorder(false)}
        />
      )}
      {tab === 'accounts' && (
        <Accounts
          openCustomers={() => setTab('customers')}
          openPurchases={(view) => openPurchases(view, 'accounts')}
          openExpenses={() => {
            setExpensesBack('accounts')
            setOpenNewExpense(false)
            setTab('expenses')
          }}
        />
      )}
      {tab === 'more' && (
        <More
          isStaff={isStaff}
          goTo={(target) => {
            if (target === 'expenses') {
              setExpensesBack('more')
              setOpenNewExpense(false)
              setTab('expenses')
              return
            }
            if (target === 'reports') {
              setTab('reports')
              return
            }
            setSettingsSection(target.slice('settings:'.length) as SettingsSection)
            setTab('settings')
          }}
        />
      )}
      {tab === 'purchases' && (
        <Purchases
          initialView={purchaseView}
          openNew={openNewPurchase}
          onBack={() => setTab(purchaseBack)}
          onOpenReorder={() => {
            setOpenInventoryReorder(true)
            setTab('inventory')
          }}
          onOpenAccounts={() => setTab('accounts')}
        />
      )}
      {tab === 'expenses' && <Expenses openNew={openNewExpense} onBack={() => setTab(expensesBack)} />}
      {tab === 'customers' && <Customers onBack={() => setTab('accounts')} />}
      {tab === 'settings' && <Settings section={settingsSection} onBack={() => setTab('more')} isStaff={isStaff || readOnly} onLogout={() => setAuth('anon')} />}
      {tab === 'reports' && !isStaff && <Reports onBack={() => setTab('more')} />}

      <nav className="fixed bottom-0 right-0 left-0 z-40 mx-auto flex max-w-lg border-t border-slate-200 bg-white">
        {tabs.map((t) => (
          <button
            key={t.id}
            aria-current={activeNav === t.id ? 'page' : undefined}
            onClick={() => {
              if (t.id === 'sales') setOpenNewSale(false)
              setTab(t.id)
            }}
            onPointerUp={(event) => event.currentTarget.blur()}
            className={`m-1 flex min-h-12 flex-1 items-center justify-center rounded-2xl px-1 py-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 ${
              activeNav === t.id ? 'bg-teal-50 font-bold text-teal-800' : 'text-slate-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
