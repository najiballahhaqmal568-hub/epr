import { fmtDate } from '../lib/format'
import type { HistoryEvent } from '../lib/docHistory'

/** A vertical line of what happened to one document: when, who, what and why. */
export function DocTimeline({ events }: { events: HistoryEvent[] }) {
  if (!events.length) return null
  return (
    <section aria-label="تاریخچهٔ این سند" className="doc-timeline">
      <h3>تاریخچهٔ این سند</h3>
      <ol>
        {events.map((e, i) => (
          <li key={i} data-tone={e.tone}>
            <p className="doc-timeline-title">{e.title}</p>
            {e.detail && <p className="doc-timeline-detail">{e.detail}</p>}
            <p className="doc-timeline-meta">{e.at ? fmtDate(e.at) : 'وقتش ثبت نشده'}{e.by ? ` · ${e.by}` : ''}</p>
          </li>
        ))}
      </ol>
    </section>
  )
}
