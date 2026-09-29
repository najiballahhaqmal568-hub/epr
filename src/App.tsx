import { useEffect, useRef, useState } from 'react'
import { pushTab, registerTabBack } from './lib/appHistory'
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
import { Icon } from './components/Icon'
import { SyncIndicator } from './components/SyncIndicator'
import { UndoToast } from './components/UndoToast'

// «فروش» وسط نوار پایین است، زیر شست؛ چپ و راستش دو دکمه — همان چیدمانِ طرح خانهٔ نو
const tabs = [
  { id: 'dashboard', label: 'خانه', icon: 'chart' },
  { id: 'accounts', label: 'حساب‌ها', icon: 'accounts' },
  { id: 'sales', label: 'فروش', icon: 'sale' },
  { id: 'inventory', label: 'گدام', icon: 'stock' },
  { id: 'more', label: 'بیشتر', icon: 'settings' }
] as const

type NavTabId = (typeof tabs)[number]['id']
type TabId = NavTabId | 'inventory' | 'expenses' | 'purchases' | 'customers' | 'settings' | 'reports'
// Travel order for the tab-change animation: deeper pages count as «forward».
const TAB_ORDER: Record<TabId, number> = { dashboard: 0, accounts: 1, customers: 2, sales: 3, inventory: 4, more: 5, expenses: 6, purchases: 6, settings: 6, reports: 6 }

export default function App() {
  // VITE_UI_PREVIEW فقط برای build آزمایشی روی همین کمپیوتر است؛ حتی اگر اشتباهی
  // در build عمومی تنظیم شود، میزبان GitHub هرگز اجازهٔ دورزدن ورود را ندارد.
  const previewRequested = new URLSearchParams(window.location.search).has('ui-preview')
  const localPreviewHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  const uiPreview = previewRequested && (import.meta.env.DEV || (localPreviewHost && import.meta.env.VITE_UI_PREVIEW === '1'))
  const [tab, setTab] = useState<TabId>('dashboard')
  const [salePending, setSalePending] = useState(false)
  const salePendingRef = useRef(false)
  salePendingRef.current = salePending
  const [openNewSale, setOpenNewSale] = useState(false)
  const [openNewPurchase, setOpenNewPurchase] = useState(false)
  const [openNewExpense, setOpenNewExpense] = useState(false)
  const [purchaseView, setPurchaseView] = useState<PurchaseView>('history')
  const [purchaseBack, setPurchaseBack] = useState<'inventory' | 'accounts'>('inventory')
  const [openInventoryReorder, setOpenInventoryReorder] = useState(false)
  const [expensesBack, setExpensesBack] = useState<'dashboard' | 'accounts' | 'more'>('more')
  // صفحهٔ پول و مصارف از کجا شروع شود: مصارف، صندوق، یا مستقیم پنجرهٔ «شمارش نقد»
  const [expensesStart, setExpensesStart] = useState<'expenses' | 'cash' | 'reconcile'>('expenses')
  // فروشی که از صفحهٔ خانه انتخاب شده تا سندش باز شود
  const [openSaleId, setOpenSaleId] = useState<number | null>(null)
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('all')
  const [unlocked, setUnlocked] = useState(false)
  const [pinError, setPinError] = useState('')
  // auth: 'none' = بدون سرور، 'anon' = سرور هست ولی وارد نشده
  const [auth, setAuth] = useState<'loading' | 'none' | 'anon' | Profile>(uiPreview ? 'none' : 'loading')
  // سشن سرور تمام شده ولی اپ باید باز بماند — دکان با انترنت کار نمی‌کند
  const [relogin, setRelogin] = useState(false)
  const [passwordRecovery, setPasswordRecovery] = useState(isPasswordRecoveryUrl)
  const reminder = useExpenseReminder()
  const shownTab = useRef<TabId>(tab)
  const tabDir = useRef<'forward' | 'back'>('forward')
  if (shownTab.current !== tab) {
    tabDir.current = TAB_ORDER[tab] >= TAB_ORDER[shownTab.current] ? 'forward' : 'back'
    shownTab.current = tab
  }

  // دکمهٔ برگشتِ تلیفون = یک قدم عقب داخل اپ (نه خروج) — هماهنگ در lib/appHistory
  useEffect(() => {
    pushTab(tab)
  }, [tab])
  useEffect(() => registerTabBack((t) => {
    if (salePendingRef.current) { pushTab('sales'); return }
    if (typeof t === 'string') setTab(t as TabId)
  }), [])
  const debtReminder = useDebtReminder()
  const integrity = useIntegrityCheck()

  const openPurchases = (view: PurchaseView, back: 'inventory' | 'accounts', startNew = false) => {
    setPurchaseView(view)
    setPurchaseBack(back)
    setOpenNewPurchase(startNew)
    setTab('purchases')
  }

  const goTo = (target: string) => {
    if (target.startsWith('sale:')) {
      const id = Number(target.slice('sale:'.length))
      if (Number.isInteger(id) && id > 0) setOpenSaleId(id)
      setOpenNewSale(false)
      setTab('sales')
      return
    }
    if (target === 'cash-count') {
      setExpensesBack('dashboard')
      setOpenNewExpense(false)
      setExpensesStart('reconcile')
      setTab('expenses')
      return
    }
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
      setExpensesStart('expenses')
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
      setExpensesStart('expenses')
    }
    setTab(target as TabId)
  }

  const activeNav: NavTabId =
    tab === 'customers' ||
    (tab === 'purchases' && purchaseBack === 'accounts')
      ? 'accounts'
      : tab === 'purchases'
        ? 'inventory'
        : tab === 'expenses' || tab === 'settings' || tab === 'reports'
          ? 'more'
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

  const role = typeof auth === 'object' ? auth.role : null
  const isStaff = role === 'staff'
  const readOnly = role === 'viewer'
  accessFlags.readOnly = readOnly
  accessFlags.actor = typeof auth === 'object' ? auth.name?.trim() ?? '' : ''
  // Each role opens on its own screen: staff on the sale counter, a partner on the reports.
  // Only the first screen after opening, and only if nothing has been tapped yet.
  const landed = useRef(false)
  useEffect(() => {
    if (landed.current || !role) return
    landed.current = true
    if (role === 'staff') setTab((t) => (t === 'dashboard' ? 'sales' : t))
    if (role === 'viewer') setTab((t) => (t === 'dashboard' ? 'reports' : t))
  }, [role])

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
        <Icon name="sale" width="40" height="40" />
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
    <div className="app-shell">
      <header className="app-header">
        <div className="app-brand">اتل<small>فروشگاه کفش</small></div>
        <SyncIndicator onDetails={() => { if (salePending) return; setSettingsSection('account'); setTab('settings') }} />
      </header>
      <main className="app-content" id="main-content">
      {relogin && (
        <div className="flex items-center gap-2 bg-[#FFB340] p-2.5 text-[#1D1D1F]">
          <span className="flex-1 text-sm font-bold">
            همگام‌سازی متوقف است — کار شما ثبت می‌شود، ولی به موبایل دیگر نمی‌رود.
          </span>
          <button
            className="min-h-[44px] rounded-lg bg-black/15 px-3 py-1 text-sm font-bold text-[#1D1D1F]"
            onClick={() => {
              setRelogin(false)
              setAuth('anon')
            }}
          >
            ورود دوباره
          </button>
        </div>
      )}
      {(tab === 'more' || tab === 'dashboard') && (integrity.show || reminder.show || debtReminder.show) && (
        <div className="flex flex-col gap-2 px-4 pt-4">
          {integrity.show && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <span className="flex-1 text-sm font-bold">
                کنترل حساب‌ها: {fmtNum(integrity.count)} عدد با اسناد نمی‌خواند
              </span>
              <button
                className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
                onClick={() => {
                  setSettingsSection('integrity')
                  setTab('settings')
                  integrity.dismiss()
                }}
              >
                دیدن
              </button>
              <button className="px-1" aria-label="بستن یادآوری کنترل حساب‌ها" onClick={() => integrity.dismiss()}>
                <Icon name="close" />
              </button>
            </div>
          )}
          {tab !== 'dashboard' && debtReminder.show && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <span className="flex-1 text-sm font-bold">
                {fmtNum(debtReminder.count)} مشتری قرضدار — {fmtMoney(debtReminder.total)}
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
              <button className="px-1" aria-label="بستن یادآوری قرضداران" onClick={() => void debtReminder.dismissToday()}>
                <Icon name="close" />
              </button>
            </div>
          )}
          {tab !== 'dashboard' && reminder.show && (
            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <span className="flex-1 text-sm font-bold">{fmtNum(reminder.count)} مصرف روزانه ثبت نشده است</span>
              <button
                className="rounded-lg bg-white/20 px-3 py-1 text-sm font-bold"
                onClick={() => {
                  setExpensesBack('more')
                  setTab('expenses')
                }}
              >
                دیدن فهرست
              </button>
              <button className="px-1" aria-label="بستن یادآوری مصارف" onClick={() => reminder.dismissToday()}>
                <Icon name="close" />
              </button>
            </div>
          )}
        </div>
      )}
      {readOnly && (
        <div className="bg-slate-700 px-4 py-1.5 text-center text-xs font-bold text-white">حالت فقط مشاهده (شریک) — تغییر ارقام ممکن نیست</div>
      )}
      <div key={tab} className="tab-enter" data-dir={tabDir.current}>
      {tab === 'dashboard' && (
        <Dashboard
          goTo={goTo}
          isStaff={isStaff}
          pendingExpenseCount={reminder.show ? reminder.count : 0}
        />
      )}
      {tab === 'sales' && <Sales isStaff={isStaff} openNew={openNewSale} pending={salePending} onPendingChange={setSalePending} openSaleId={openSaleId} onSaleOpened={() => setOpenSaleId(null)} />}
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
            setExpensesStart('expenses')
            setTab('expenses')
          }}
        />
      )}
      {tab === 'more' && (
        <More
          isStaff={isStaff}
          pendingExpenseCount={reminder.show ? reminder.count : 0}
          goTo={(target) => {
            if (target === 'dashboard') { setTab('dashboard'); return }
            if (target === 'inventory') { setTab('inventory'); return }
            if (target === 'purchases') { openPurchases('history', 'inventory'); return }
            if (target === 'expenses') {
              setExpensesBack('more')
              setOpenNewExpense(false)
              setExpensesStart('expenses')
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
      {tab === 'expenses' && <Expenses openNew={openNewExpense} start={expensesStart} onBack={() => setTab(expensesBack)} />}
      {tab === 'customers' && <Customers onBack={() => setTab('accounts')} />}
      {tab === 'settings' && <Settings section={settingsSection} onBack={() => setTab('more')} isStaff={isStaff || readOnly} onLogout={() => { try { sessionStorage.removeItem('epr_sale_working_v1') } catch { /* storage unavailable */ } setAuth('anon') }} />}
      {tab === 'reports' && !isStaff && <Reports onBack={() => setTab('more')} />}
      </div>
      </main>
      <UndoToast />
      <nav className="app-nav" aria-label="بخش‌های اصلی">
        <div className="app-nav-brand app-brand">اتل<small>فروشگاه کفش</small></div>
        {tabs.map((t) => (
          <button
            key={t.id}
            disabled={salePending}
            className={t.id === 'sales' ? 'app-nav-sell' : undefined}
            aria-current={activeNav === t.id ? 'page' : undefined}
            onClick={() => {
              if (t.id === 'sales') setOpenNewSale(false)
              setTab(t.id)
            }}
            onPointerUp={(event) => event.currentTarget.blur()}
          >
            <Icon name={t.icon} /><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
