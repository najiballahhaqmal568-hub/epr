import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { exportBackup, resetAllData, resetLocalDevice } from '../../lib/ops'
import { getProfile } from '../../lib/supa'
import { syncNow } from '../../lib/sync'
import { Card, inputCls, Field } from '../../components/ui'

export function DangerCard() {
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

export default DangerCard
