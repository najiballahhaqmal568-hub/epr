import { syncStatusLabel } from '../lib/syncStatusLabel'
import { useSyncStatus } from '../lib/sync'

export function SyncIndicator({ onDetails }: { onDetails: () => void }) {
  const status = useSyncStatus()
  const label = syncStatusLabel(status)
  const displayState = status.state === 'ok' && status.pending !== 0 ? 'pending' : status.state
  return <button className="sync-status" data-state={displayState} onClick={onDetails} aria-label={`وضعیت همگام‌سازی: ${label}`}><span className="sync-status-dot" /><span aria-live="polite">{label}</span></button>
}
