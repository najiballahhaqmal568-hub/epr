import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { exportBackup, importBackup, resetAllData, resetLocalDevice } from '../lib/ops'
import { hashPin } from '../components/PinLock'
import { getServerConfig, setServerConfig, getProfile, logout, createStaff, type Profile } from '../lib/supa'
import { syncNow } from '../lib/sync'
import { Card, inputCls, Field, PrimaryBtn } from '../components/ui'

export default function Settings({
  onBack,
  isStaff,
  onLogout
}: {
  onBack?: () => void
  isStaff?: boolean
  onLogout?: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')

  async function backup() {
    const json = await exportBackup()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `shoe-erp-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    setMsg('✅ فایل بکاپ آماده دانلود شد. آن را در جای امن (گوگل درایو، واتساپ خودتان...) نگه دارید.')
  }

  async function restore(file: File) {
    if (!confirm('هوشدار: همه اطلاعات فعلی با اطلاعات فایل بکاپ عوض می‌شود. ادامه می‌دهید؟')) return
    try {
      await importBackup(await file.text())
      setMsg('✅ اطلاعات با موفقیت برگردانده شد.')
    } catch (e) {
      setMsg(`❌ خطا: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <div className="p-4">
      <div className="mb-3 flex items-center gap-2">
        {onBack && (
          <button onClick={onBack} className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            →
          </button>
        )}
        <h1 className="text-xl font-bold text-slate-800">تنظیمات</h1>
      </div>

      <AccountCard isStaff={isStaff} onLogout={onLogout} />
      {!isStaff && <ServerCard />}
      <ReminderCard />
      {!isStaff && <PinCard />}

      {!isStaff && (
        <>
          <Card>
            <p className="mb-1 font-bold text-slate-800">بکاپ اطلاعات</p>
            <p className="mb-3 text-sm text-slate-500">
              هر چند روز یک بار بکاپ بگیرید تا اگر موبایل گم یا خراب شد، اطلاعات از بین نرود.
            </p>
            <button onClick={backup} className="w-full rounded-xl bg-teal-700 py-3 font-bold text-white">
              دانلود فایل بکاپ
            </button>
          </Card>

          <Card>
            <p className="mb-1 font-bold text-slate-800">برگرداندن بکاپ</p>
            <p className="mb-3 text-sm text-slate-500">فایل بکاپ قبلی را انتخاب کنید تا اطلاعات برگردد.</p>
            <button onClick={() => fileRef.current?.click()} className="w-full rounded-xl bg-slate-100 py-3 font-bold text-slate-700">
              انتخاب فایل بکاپ
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) restore(f)
                e.target.value = ''
              }}
            />
          </Card>
        </>
      )}

      {!isStaff && <DangerCard />}

      {msg && <p className="mt-3 rounded-xl bg-white p-3 text-sm">{msg}</p>}

      <p className="mt-6 text-center text-xs text-slate-400">فروشگاه اتل — سیستم مدیریت</p>
    </div>
  )
}

function DangerCard() {
  const [mode, setMode] = useState<'closed' | 'local' | 'all'>('closed')
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const serverConfigured = useLiveQuery(async () => Boolean((await db.settings.get('supaUrl'))?.value), [])

  async function downloadBackup() {
    const json = await exportBackup()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `atel-backup-before-reset-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  async function run() {
    setBusy(true)
    setMsg('')
    try {
      await downloadBackup()
      if (mode === 'all') {
        if (serverConfigured) {
          const profile = await getProfile()
          if (!profile || profile.role !== 'owner') throw new Error('فقط مالک می‌تواند ریست کامل کند')
          if (!navigator.onLine) throw new Error('برای ریست کامل باید آنلاین باشید تا سرور هم پاک شود')
        }
        await resetAllData()
        await syncNow()
        setMsg('✅ همه اطلاعات پاک شد. اپ آمادهٔ شروع از صفر است. (یک فایل بکاپ هم دانلود شد — اگر پشیمان شدید قابل برگرداندن است)')
        setMode('closed')
        setConfirmText('')
      } else {
        await resetLocalDevice()
      }
    } catch (e) {
      setMsg(`❌ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <p className="mb-1 font-bold text-red-700">⚠️ منطقهٔ خطر — ریست</p>
      {mode === 'closed' ? (
        <>
          <p className="mb-3 text-sm text-slate-500">
            برای پاک کردن اطلاعات آزمایشی و شروع از صفر. قبل از پاک شدن، خودکار یک فایل بکاپ دانلود می‌شود.
          </p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setMode('all')} className="rounded-xl bg-red-50 px-4 py-2 font-bold text-red-700">
              ریست کامل (شروع از صفر)
            </button>
            {serverConfigured && (
              <button onClick={() => setMode('local')} className="rounded-xl bg-slate-100 px-4 py-2 font-bold text-slate-600">
                ریست فقط این موبایل
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="mb-2 text-sm font-bold text-red-700">
            {mode === 'all'
              ? 'همهٔ اجناس، فروش‌ها، مشتریان، مصارف و صندوق در همهٔ موبایل‌ها پاک می‌شود. حساب‌های کاربری و تنظیمات می‌مانند.'
              : 'اطلاعات این موبایل پاک می‌شود و با اولین همگام‌سازی دوباره از سرور برمی‌گردد.'}
          </p>
          <Field label="برای تأیید، کلمهٔ «حذف» را بنویسید">
            <input className={inputCls} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button
              onClick={() => {
                setMode('closed')
                setConfirmText('')
              }}
              className="flex-1 rounded-xl bg-slate-100 py-3 font-bold text-slate-600"
            >
              انصراف
            </button>
            <button
              onClick={run}
              disabled={confirmText.trim() !== 'حذف' || busy}
              className="flex-1 rounded-xl bg-red-600 py-3 font-bold text-white disabled:opacity-30"
            >
              {busy ? '...' : mode === 'all' ? 'پاک کن — شروع از صفر' : 'پاک کن — فقط این موبایل'}
            </button>
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

function ServerCard() {
  const [expanded, setExpanded] = useState(false)
  const [url, setUrl] = useState('')
  const [key, setKey] = useState('')
  const [msg, setMsg] = useState('')
  const configured = useLiveQuery(async () => Boolean((await db.settings.get('supaUrl'))?.value), [])

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">اتصال به سرور (همگام‌سازی ابری)</p>
      <p className="mb-3 text-sm text-slate-500">
        {configured
          ? '✅ سرور تنظیم شده است. اطلاعات بین موبایل‌ها همگام می‌شود.'
          : 'برای استفادهٔ چند نفره و بکاپ آنلاین، مشخصات پروژهٔ Supabase را وارد کنید.'}
      </p>
      {!expanded ? (
        <button onClick={() => setExpanded(true)} className="rounded-xl bg-slate-100 px-5 py-2 font-bold text-slate-700">
          {configured ? 'تغییر سرور' : 'تنظیم سرور'}
        </button>
      ) : (
        <>
          <Field label="Project URL">
            <input className={inputCls} dir="ltr" placeholder="https://xxxx.supabase.co" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Field label="Anon Key">
            <input className={inputCls} dir="ltr" placeholder="eyJhbGciOi..." value={key} onChange={(e) => setKey(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!url.trim().startsWith('https://') || key.trim().length < 20}
            onClick={async () => {
              await setServerConfig({ url, anonKey: key })
              setMsg('✅ ذخیره شد. حالا از صفحهٔ ورود، ثبت‌نام یا ورود کنید.')
              setExpanded(false)
            }}
          >
            ذخیره و اتصال
          </PrimaryBtn>
        </>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

function AccountCard({ isStaff, onLogout }: { isStaff?: boolean; onLogout?: () => void }) {
  const [profile, setProfile] = useState<Profile | null | 'loading'>('loading')
  const [showStaff, setShowStaff] = useState(false)
  const [sEmail, setSEmail] = useState('')
  const [sPass, setSPass] = useState('')
  const [sName, setSName] = useState('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getServerConfig().then(async (cfg) => {
      if (!cfg) return setProfile(null)
      setProfile(await getProfile())
    })
  }, [])

  if (profile === 'loading' || profile === null) return null

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">حساب کاربری</p>
      <p className="mb-3 text-sm text-slate-500">
        {profile.name} — {profile.role === 'owner' ? 'مالک' : 'کارمند'}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={async () => {
            await syncNow()
            await logout()
            await db.settings.delete('cachedProfile')
            onLogout?.()
          }}
          className="rounded-xl bg-slate-100 px-5 py-2 font-bold text-slate-700"
        >
          خروج از حساب
        </button>
        {profile.role === 'owner' && !isStaff && (
          <button onClick={() => setShowStaff(!showStaff)} className="rounded-xl bg-teal-700 px-5 py-2 font-bold text-white">
            ＋ کارمند جدید
          </button>
        )}
      </div>
      {showStaff && (
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <Field label="نام کارمند *">
            <input className={inputCls} value={sName} onChange={(e) => setSName(e.target.value)} />
          </Field>
          <Field label="ایمیل *">
            <input className={inputCls} dir="ltr" type="email" value={sEmail} onChange={(e) => setSEmail(e.target.value)} />
          </Field>
          <Field label="رمز عبور (حداقل ۶ حرف) *">
            <input className={inputCls} dir="ltr" value={sPass} onChange={(e) => setSPass(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!sName.trim() || !sEmail.trim() || sPass.length < 6}
            onClick={async () => {
              try {
                await createStaff(sEmail.trim(), sPass, sName.trim())
                setMsg(`✅ حساب کارمند ساخته شد. ایمیل و رمز را به ${sName} بدهید تا در موبایل خود وارد شود.`)
                setSName('')
                setSEmail('')
                setSPass('')
                setShowStaff(false)
              } catch (e) {
                setMsg(`❌ ${e instanceof Error ? e.message : String(e)}`)
              }
            }}
          >
            ساخت حساب کارمند
          </PrimaryBtn>
        </div>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

function PinCard() {
  const pinSet = useLiveQuery(async () => Boolean((await db.settings.get('pinHash'))?.value), [])
  const [editing, setEditing] = useState(false)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')

  async function save() {
    const clean = pin.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    if (!/^\d{4}$/.test(clean)) return setMsg('کود باید ۴ رقم باشد')
    await db.settings.put({ key: 'pinHash', value: await hashPin(clean) })
    setPin('')
    setEditing(false)
    setMsg('✅ قفل فعال شد. دفعهٔ بعد که اپ باز شود کود پرسیده می‌شود.')
  }

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">قفل اپ (کود ۴ رقمی)</p>
      <p className="mb-3 text-sm text-slate-500">با فعال کردن قفل، هر بار که اپ باز می‌شود کود پرسیده می‌شود.</p>
      {!editing ? (
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="rounded-xl bg-teal-700 px-5 py-2 font-bold text-white">
            {pinSet ? 'تغییر کود' : 'فعال کردن قفل'}
          </button>
          {pinSet && (
            <button
              onClick={async () => {
                await db.settings.delete('pinHash')
                setMsg('قفل غیرفعال شد.')
              }}
              className="rounded-xl bg-slate-100 px-5 py-2 font-bold text-slate-600"
            >
              غیرفعال کردن
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            className={inputCls}
            inputMode="numeric"
            maxLength={4}
            placeholder="کود ۴ رقمی"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button onClick={save} className="whitespace-nowrap rounded-xl bg-teal-700 px-4 font-bold text-white">
            ذخیره
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

function ReminderCard() {
  const on = useLiveQuery(async () => (await db.settings.get('expenseReminderOn'))?.value === true, [])
  const hour = useLiveQuery(async () => Number((await db.settings.get('expenseReminderHour'))?.value ?? 18), [])
  const debtOn = useLiveQuery(async () => (await db.settings.get('debtReminderOn'))?.value, [])

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">یادآوری روزانهٔ مصارف</p>
      <p className="mb-3 text-sm text-slate-500">
        اگر تا آخر روز مصرفی ثبت نکرده باشید، هنگام باز بودن اپ یادآوری نشان داده می‌شود.
      </p>
      <div className="flex items-center gap-3">
        <button
          onClick={async () => {
            const next = !on
            await db.settings.put({ key: 'expenseReminderOn', value: next })
            if (next && typeof Notification !== 'undefined' && Notification.permission === 'default') {
              try {
                await Notification.requestPermission()
              } catch {
                /* اجازهٔ اعلان اختیاری است */
              }
            }
          }}
          className={`rounded-xl px-5 py-2 font-bold ${on ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          {on ? 'فعال ✓' : 'غیرفعال'}
        </button>
        {on && (
          <label className="flex items-center gap-2 text-sm text-slate-600">
            از ساعت
            <select
              className={inputCls + ' w-20'}
              value={hour}
              onChange={(e) => db.settings.put({ key: 'expenseReminderHour', value: Number(e.target.value) })}
            >
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="mb-1 font-bold text-slate-800">یادآوری روزانهٔ قرضداران</p>
        <p className="mb-3 text-sm text-slate-500">
          هر روز یک بار مشتریان قرضدار با مجموع قرض یادآوری می‌شوند تا تقاضای قرض فراموش نشود.
        </p>
        <button
          onClick={() => void db.settings.put({ key: 'debtReminderOn', value: debtOn === false })}
          className={`rounded-xl px-5 py-2 font-bold ${debtOn !== false ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
        >
          {debtOn !== false ? 'فعال ✓' : 'غیرفعال'}
        </button>
      </div>
    </Card>
  )
}
