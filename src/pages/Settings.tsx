import { useRef, useState } from 'react'
import { exportBackup, importBackup, type BackupImportMode } from '../lib/ops'
import { hasPendingCloudRestore, syncNow } from '../lib/sync'
import { Card } from '../components/ui'
import DangerCard from './settings/DangerCard'
import ServerCard from './settings/ServerCard'
import AccountCard from './settings/AccountCard'
import PinCard from './settings/PinCard'
import FontSizeCard from './settings/FontSizeCard'
import ReminderCard from './settings/ReminderCard'
import IntegrityCard from './settings/IntegrityCard'
import YearStartCard from './settings/YearStartCard'

export default function Settings({
  onBack,
  isStaff,
  onLogout
}: {
  onBack?: () => void
  isStaff?: boolean
  onLogout?: () => void
}) {
  const mergeFileRef = useRef<HTMLInputElement>(null)
  const replaceFileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [restoreBusy, setRestoreBusy] = useState(false)

  function downloadJson(json: string, filename: string) {
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  async function backup() {
    const json = await exportBackup()
    downloadJson(json, `shoe-erp-backup-${new Date().toISOString().slice(0, 10)}.json`)
    setMsg('✅ فایل بکاپ آماده دانلود شد. آن را در جای امن (گوگل درایو، واتساپ خودتان...) نگه دارید.')
  }

  async function restore(file: File, mode: BackupImportMode) {
    if (mode === 'merge') {
      if (!confirm('ادغام امن: معلومات فعلی سرور پاک نمی‌شود؛ فقط موارد گمشدهٔ بکاپ اضافه می‌شود. ادامه می‌دهید؟')) return
    } else {
      const confirmed = confirm(
        'خطر: این بکاپ جای تمام معلومات فعلی سرور و همهٔ موبایل‌ها را می‌گیرد. یک بکاپ اضطراری هم خودکار دانلود می‌شود. برای ادامه «تأیید» را بزنید.'
      )
      if (!confirmed) {
        setMsg('جایگزینی لغو شد؛ هیچ معلوماتی تغییر نکرد.')
        return
      }
    }
    setRestoreBusy(true)
    setMsg('⏳ در حال برگرداندن بکاپ...')
    try {
      const json = await file.text()
      if (mode === 'replace') {
        // Pull once before the destructive restore so the emergency download
        // contains the latest cloud copy visible to this device. After a
        // failed attempt, ordinary sync is intentionally blocked; the local
        // copy is already the selected backup and can be retried safely.
        if (!(await hasPendingCloudRestore())) await syncNow(true)
        downloadJson(
          await exportBackup(),
          `atel-emergency-before-cloud-restore-${new Date().toISOString().slice(0, 10)}.json`
        )
      }
      await importBackup(json, mode)
      setMsg(
        mode === 'merge'
          ? '✅ بکاپ به شکل امن ادغام شد؛ معلومات فعلی سرور نگه داشته شد.'
          : '✅ بکاپ جای معلومات سرور را گرفت. موبایل‌های دیگر در همگام‌سازی بعدی خودکار تازه می‌شوند.'
      )
    } catch (e) {
      setMsg(`❌ خطا: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRestoreBusy(false)
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
      <FontSizeCard />
      {!isStaff && <ServerCard />}
      <ReminderCard />
      {!isStaff && <YearStartCard />}
      {!isStaff && <IntegrityCard />}
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
            <p className="mb-3 text-sm text-slate-500">
              حالت امن معلومات فعلی سرور را نگه می‌دارد و فقط موارد گمشدهٔ بکاپ را اضافه می‌کند.
            </p>
            <button
              disabled={restoreBusy}
              onClick={() => mergeFileRef.current?.click()}
              className="w-full rounded-xl bg-teal-50 py-3 font-bold text-teal-700 disabled:opacity-40"
            >
              ادغام امن بکاپ (پیشنهادی)
            </button>
            <input
              ref={mergeFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void restore(f, 'merge')
                e.target.value = ''
              }}
            />
            <div className="my-3 border-t border-slate-200" />
            <p className="mb-3 text-sm text-red-600">
              فقط وقتی بکاپ باید نسخهٔ رسمی همهٔ موبایل‌ها شود: معلومات فعلی سرور پاک و با بکاپ عوض می‌شود.
            </p>
            <button
              disabled={restoreBusy}
              onClick={() => replaceFileRef.current?.click()}
              className="w-full rounded-xl bg-red-50 py-3 font-bold text-red-700 disabled:opacity-40"
            >
              جایگزینی سرور و همهٔ موبایل‌ها
            </button>
            <input
              ref={replaceFileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void restore(f, 'replace')
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
