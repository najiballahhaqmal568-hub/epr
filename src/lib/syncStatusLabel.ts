import type { SyncStatus } from './sync'
import { fmtNum } from './format'

/** Shared wording for the header, dashboard, and detailed status. */
export function syncStatusLabel(status: SyncStatus): string {
  if (status.restorePending) return 'بازیابی نیمه‌تمام'
  if (status.state === 'offline') return 'آفلاین'
  if (status.state === 'off') return 'فقط این دستگاه'
  if (status.state === 'error') return 'نیاز به بررسی همگام‌سازی'
  if (status.state === 'syncing') return 'در حال همگام‌سازی'
  if (status.pending === null) return 'در حال بررسی تغییرات'
  if (status.pending > 0) return `${fmtNum(status.pending)} ثبت در انتظار ارسال`
  return status.lastSync ? 'همگام‌سازی موفق' : 'هنوز همگام‌سازی تأیید نشده'
}
