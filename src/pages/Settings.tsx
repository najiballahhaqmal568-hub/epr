import { useRef, useState } from 'react'
import { exportBackup, importBackup } from '../lib/ops'
import { Card } from '../components/ui'
import DangerCard from './settings/DangerCard'
import ServerCard from './settings/ServerCard'
import AccountCard from './settings/AccountCard'
import PinCard from './settings/PinCard'
import FontSizeCard from './settings/FontSizeCard'
import ReminderCard from './settings/ReminderCard'
import IntegrityCard from './settings/IntegrityCard'

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
      <FontSizeCard />
      {!isStaff && <ServerCard />}
      <ReminderCard />
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
