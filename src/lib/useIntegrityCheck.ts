import { useEffect, useState } from 'react'
import { db, accessFlags } from '../db'
import { toDateInput } from './format'
import { runIntegrityCheck, type IntegrityReport } from './integrity'

/**
 * کنترل خودکار روزانهٔ حساب‌ها.
 * روزی یک بار عددهای ذخیره‌شده را با اسناد مقایسه می‌کند و اگر جایی نخواند خبر می‌دهد.
 * در حالت «فقط مشاهده» اجرا نمی‌شود.
 */
export function useIntegrityCheck() {
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        if (accessFlags.readOnly) return
        const today = toDateInput(Date.now())
        const last = (await db.settings.get('integrityCheckedOn'))?.value
        if (last === today) return
        const rep = await runIntegrityCheck()
        await db.settings.put({ key: 'integrityCheckedOn', value: today })
        if (!cancelled && rep.mismatches.length > 0) setReport(rep)
      } catch {
        /* کنترل نباید جلوی کار روزمره را بگیرد */
      }
      // بعد از باز شدن اپ اجرا شود تا شروع کند نشود
    }, 4000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  return {
    show: Boolean(report) && !dismissed,
    count: report?.mismatches.length ?? 0,
    dismiss: () => setDismissed(true)
  }
}
