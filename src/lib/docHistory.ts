import type { Payment, ReturnDoc, Sale } from '../db'
import { fmtMoney, fmtNum } from './format'

/**
 * «تاریخچهٔ این سند» — only what the documents themselves record: when, who (if stored), what changed
 * and why. Nothing is inferred; a step whose time was never stored says so.
 */
export interface HistoryEvent { at?: number; title: string; detail?: string; by?: string; tone: 'plain' | 'good' | 'warn' | 'bad' }

interface Auditable {
  date: number
  by?: string
  deleted?: boolean
  deletedAt?: number
  deletedBy?: string
  cancelledAt?: number
  cancelledReason?: string
  correctionOfUuid?: string
  correctedByUuid?: string
  correctionReason?: string
  correctedAt?: number
}

const reason = (text?: string) => (text?.trim() ? `دلیل: ${text.trim()}` : undefined)
const join = (...parts: (string | undefined)[]) => parts.filter(Boolean).join(' — ') || undefined

export function documentHistory(doc: Auditable, created: { title: string; detail?: string; tone?: HistoryEvent['tone'] }): HistoryEvent[] {
  const out: HistoryEvent[] = [{
    at: doc.date,
    title: doc.correctionOfUuid ? `${created.title} (به جای سند اشتباه)` : created.title,
    detail: join(created.detail, doc.correctionOfUuid ? reason(doc.correctionReason) : undefined),
    by: doc.by,
    tone: created.tone ?? 'plain'
  }]
  if (doc.correctedByUuid) out.push({ at: doc.correctedAt, title: 'اصلاح شد — سند تازه جای آن را گرفت', detail: reason(doc.correctionReason), by: doc.deletedBy, tone: 'warn' })
  else if (doc.cancelledAt) out.push({ at: doc.cancelledAt, title: 'لغو شد', detail: reason(doc.cancelledReason), by: doc.deletedBy, tone: 'bad' })
  else if (doc.deleted) out.push({ at: doc.deletedAt, title: 'حذف شد — اثر پول و جنس برعکس شد', by: doc.deletedBy, tone: 'bad' })
  return out
}

function payLabel(sale: Sale): string {
  if (sale.paid >= sale.total) return `نقد ${fmtMoney(sale.total)}`
  if (sale.paid <= 0) return `قرض ${fmtMoney(sale.total)}`
  return `نقد ${fmtMoney(sale.paid)} و قرض ${fmtMoney(sale.total - sale.paid)}`
}

const byTime = (a: HistoryEvent, b: HistoryEvent) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER)

/** A sale, its returns and exchanges, and its shipping — in the order they happened. */
export function saleHistory(sale: Sale, returns: ReturnDoc[], payments: Payment[]): HistoryEvent[] {
  const pairs = sale.lines.reduce((n, l) => n + l.qty, 0)
  const events = documentHistory(sale, { title: 'فروش ثبت شد', detail: `${fmtNum(pairs)} جوړه · ${payLabel(sale)}`, tone: 'good' })
  for (const r of returns) {
    if (r.kind !== 'customer' || sale.id === undefined || r.refId !== sale.id) continue
    const qty = r.lines.reduce((n, l) => n + l.qty, 0)
    const exchange = r.reason === 'تبادله'
    events.push(...documentHistory(r, { title: exchange ? 'تبادله' : 'مرجوعی', detail: join(`${fmtNum(qty)} جوړه — ${fmtMoney(r.amount)}`, exchange ? undefined : reason(r.reason)), tone: 'warn' }))
  }
  for (const p of payments) {
    if (!p.shipping || !sale.uuid || p.shipping.saleUuid !== sale.uuid) continue
    events.push(...documentHistory(p, { title: 'کرایهٔ بار', detail: `کرایه ${fmtMoney(p.shipping.total)} · سهم مشتری ${fmtMoney(p.shipping.customerShare)}` }))
  }
  return events.sort(byTime)
}
