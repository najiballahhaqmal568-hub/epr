import { useRef, useState } from 'react'
import { exportBackup, importBackup } from '../lib/ops'
import { Card } from '../components/ui'

export default function Settings() {
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
      <h1 className="mb-3 text-xl font-bold text-slate-800">تنظیمات</h1>

      <Card>
        <p className="mb-1 font-bold text-slate-800">بکاپ اطلاعات</p>
        <p className="mb-3 text-sm text-slate-500">
          همه اطلاعات فقط روی همین موبایل ذخیره است. هر چند روز یک بار بکاپ بگیرید تا اگر موبایل گم یا خراب شد، اطلاعات از بین نرود.
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

      {msg && <p className="mt-3 rounded-xl bg-white p-3 text-sm">{msg}</p>}

      <p className="mt-6 text-center text-xs text-slate-400">سیستم مدیریت بوت فروشی — نسخه ۱.۰</p>
    </div>
  )
}
