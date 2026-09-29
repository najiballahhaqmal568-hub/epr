import { useState, type ReactNode } from 'react'

/** «تاریخچه» under a ledger row: closed by default so the ledger stays short, one tap to see the story. */
export function HistoryToggle({ label, children }: { label: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="history-toggle">
      <button type="button" aria-expanded={open} aria-label={`تاریخچهٔ ${label}`} onClick={() => setOpen((v) => !v)}>
        {open ? 'بستن تاریخچه' : 'تاریخچه'}
      </button>
      {open && children()}
    </div>
  )
}
