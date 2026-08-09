import { useEffect, useState } from 'react'
import { db } from '../../db'
import { getServerConfig, getProfile, logout, createStaff, type Profile } from '../../lib/supa'
import { syncNow } from '../../lib/sync'
import { Card, inputCls, Field, PrimaryBtn } from '../../components/ui'

export function AccountCard({ isStaff, onLogout }: { isStaff?: boolean; onLogout?: () => void }) {
  const [profile, setProfile] = useState<Profile | null | 'loading'>('loading')
  const [showStaff, setShowStaff] = useState(false)
  const [sEmail, setSEmail] = useState('')
  const [sPass, setSPass] = useState('')
  const [sName, setSName] = useState('')
  const [sRole, setSRole] = useState<'staff' | 'viewer'>('staff')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getServerConfig()
      .then(async (cfg) => {
        if (!cfg) return setProfile(null)
        const cached = ((await db.settings.get('cachedProfile'))?.value as Profile | undefined) ?? null
        try {
          setProfile((await getProfile()) ?? cached)
        } catch {
          // Keep account controls available while the server/session is unhealthy.
          setProfile(cached)
        }
      })
      .catch(() => setProfile(null))
  }, [])

  if (profile === 'loading' || profile === null) return null

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">حساب کاربری</p>
      <p className="mb-3 text-sm text-slate-500">
        {profile.name} — {profile.role === 'owner' ? 'مالک' : profile.role === 'viewer' ? 'شریک (فقط مشاهده)' : 'کارمند'}
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
            ＋ حساب جدید (کارمند / شریک)
          </button>
        )}
      </div>
      {showStaff && (
        <div className="mt-3 rounded-xl border border-slate-200 p-3">
          <Field label="نوع حساب">
            <div className="flex gap-2">
              <button
                onClick={() => setSRole('staff')}
                className={`flex-1 rounded-xl py-2 text-sm font-bold ${sRole === 'staff' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                کارمند (فروش/خرید)
              </button>
              <button
                onClick={() => setSRole('viewer')}
                className={`flex-1 rounded-xl py-2 text-sm font-bold ${sRole === 'viewer' ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-600'}`}
              >
                شریک (فقط مشاهده)
              </button>
            </div>
          </Field>
          <p className="-mt-2 mb-3 text-xs text-slate-400">
            {sRole === 'staff'
              ? 'کارمند می‌تواند فروش و خرید ثبت کند اما راپور و تنظیمات را نمی‌بیند.'
              : 'شریک همه‌چیز از جمله راپورها و مفاد را می‌بیند ولی هیچ رقمی را تغییر داده نمی‌تواند.'}
          </p>
          <Field label="نام *">
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
                await createStaff(sEmail.trim(), sPass, sName.trim(), sRole)
                setMsg(
                  `✅ حساب ${sRole === 'viewer' ? 'شریک (فقط مشاهده)' : 'کارمند'} ساخته شد. ایمیل و رمز را به ${sName} بدهید تا در موبایل خود وارد شود.`
                )
                setSName('')
                setSEmail('')
                setSPass('')
                setShowStaff(false)
              } catch (e) {
                setMsg(`❌ ${e instanceof Error ? e.message : String(e)}`)
              }
            }}
          >
            {sRole === 'viewer' ? 'ساخت حساب شریک' : 'ساخت حساب کارمند'}
          </PrimaryBtn>
        </div>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

export default AccountCard
