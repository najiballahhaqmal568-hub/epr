import { fmtNum } from '../lib/format'
import { useSyncStatus } from '../lib/sync'

export function SyncIndicator({ onDetails }: { onDetails: () => void }) {
  const status = useSyncStatus()
  const label = status.state === 'off' ? 'فقط این دستگاه' : status.state === 'offline' ? 'آفلاین' : status.state === 'error' ? 'نیاز به بررسی همگام‌سازی' : status.state === 'syncing' ? 'در حال همگام‌سازی' : status.pending > 0 ? `${fmtNum(status.pending)} تغییر در انتظار` : 'همگام شد'
  return <button className="sync-status" data-state={status.state} onClick={onDetails} aria-label={`وضعیت همگام‌سازی: ${label}`}><span className="sync-status-dot" /><span aria-live="polite">{label}</span></button>
}
