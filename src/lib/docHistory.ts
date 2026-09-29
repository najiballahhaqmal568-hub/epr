import type { Payment, ReturnDoc, Sale } from '../db'
import { fmtDateShort, fmtMoney, fmtNum, startOfDay } from './format'

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

/**
 * A payment and every correction of it, oldest first (`chain` follows correctionOfUuid back as far as the
 * documents exist on this phone). If the first version is not here, its amount and date still come from
 * `correctionPrevious`, which each replacement stores.
 */
export function paymentHistory(chain: Payment[], created: string): HistoryEvent[] {
  if (!chain.length) return []
  const first = chain[0]
  const amount = (n: number) => fmtMoney(Math.abs(n))
  const events: HistoryEvent[] = []
  if (first.correctionOfUuid && first.correctionPrevious) events.push({ at: first.correctionPrevious.date, title: created, detail: amount(first.correctionPrevious.amount), tone: 'good' })
  else events.push({ at: first.date, title: created, detail: join(amount(first.amount), first.note?.trim()), by: first.by, tone: 'good' })
  for (const v of chain) {
    if (!v.correctionOfUuid) continue
    const prev = v.correctionPrevious
    events.push({
      at: v.correctedAt ?? v.date,
      title: 'اصلاح شد',
      detail: join(
        prev ? `${amount(prev.amount)} ← ${amount(v.amount)}` : amount(v.amount),
        // only a different day is news; a few seconds' difference is not
        prev && startOfDay(prev.date) !== startOfDay(v.date) ? `تاریخ ${fmtDateShort(prev.date)} ← ${fmtDateShort(v.date)}` : undefined,
        reason(v.correctionReason)
      ),
      by: v.by,
      tone: 'warn'
    })
  }
  const last = chain[chain.length - 1]
  if (last.cancelledAt) events.push({ at: last.cancelledAt, title: 'لغو شد', detail: reason(last.cancelledReason), by: last.deletedBy, tone: 'bad' })
  else if (last.deleted && !last.correctedByUuid) events.push({ at: last.deletedAt, title: 'حذف شد — اثر پول و قرض برعکس شد', by: last.deletedBy, tone: 'bad' })
  return events.sort(byTime)
}
