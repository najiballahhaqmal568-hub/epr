import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { downloadBackupNow, readBackupNudge, snoozeBackupNudge } from '../../lib/backupReminder'
import { fmtNum } from '../../lib/format'

/**
 * «بکاپ بگیرید» — فقط وقتی چیزی برای محافظت هست و آخرین بکاپ کهنه است (قاعده در lib/backupReminder).
 * دکمه همان‌جا فایل را می‌سازد؛ بعد از موفقیت یک پیام سبز می‌ماند تا مالک بداند فایل کجا باید برود.
 */
export default function BackupNudgeCard() {
  const nudge = useLiveQuery(() => readBackupNudge(), [])
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  async function backup() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await downloadBackupNow()
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <section aria-label="بکاپ" role="status" className="mb-4 rounded-[22px] border-2 border-teal-600 bg-white p-4">
        <p className="text-base font-extrabold text-teal-700">✅ بکاپ آماده شد</p>
        <p className="mt-1 text-sm leading-7 text-slate-700">فایل را در جای امن نگه دارید: گوگل درایو، یا برای خودتان در واتساپ بفرستید. فقط در همین موبایل نماند.</p>
      </section>
    )
  }
  if (!nudge) return null

  return (
    <section aria-label="یادآوری بکاپ" className="mb-4 rounded-[22px] border-2 border-[#E0A43A] bg-white p-4">
      <p className="text-lg font-extrabold text-slate-900">
        {nudge.kind === 'never' ? 'هنوز از حساب‌ها بکاپ نگرفته‌اید' : `${fmtNum(nudge.days)} روز از آخرین بکاپ گذشته`}
      </p>
      <p className="mt-1 text-[0.9375rem] leading-8 text-slate-700">
        {nudge.kind === 'never' ? `${fmtNum(nudge.changes)} سند ثبت شده است. ` : `از آن وقت ${fmtNum(nudge.changes)} سند تازه ثبت شده. `}
        اگر موبایل گم یا خراب شود و بکاپ نباشد، این‌ها از بین می‌رود.
      </p>
      {error && <p role="alert" className="mt-1 text-sm font-bold text-red-700">{error}</p>}
      <div className="mt-3 flex gap-2.5">
        <button type="button" disabled={busy} onClick={() => void backup()} className="min-h-[52px] flex-1 rounded-2xl bg-[#E0A43A] px-4 text-base font-extrabold text-[#151A28] disabled:opacity-60">
          {busy ? 'در حال ساختن…' : 'بکاپ بگیر'}
        </button>
        <button type="button" onClick={() => void snoozeBackupNudge()} className="min-h-[52px] rounded-2xl border border-slate-300 px-4 text-[0.9375rem] font-bold text-slate-800">بعداً</button>
      </div>
    </section>
  )
}
