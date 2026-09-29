import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Payment } from '../db'
import { paymentHistory } from '../lib/docHistory'
import { DocTimeline } from './DocTimeline'

/** Follows the correction chain back through the documents on this phone, then shows it oldest first. */
export function PaymentTimeline({ payment, created }: { payment: Payment; created: string }) {
  const chain = useLiveQuery(async () => {
    const out: Payment[] = [payment]
    const seen = new Set([payment.uuid])
    let prevUuid = payment.correctionOfUuid
    while (prevUuid && !seen.has(prevUuid) && out.length < 50) {
      seen.add(prevUuid)
      const prev = await db.payments.where('uuid').equals(prevUuid).first()
      if (!prev) break
      out.unshift(prev)
      prevUuid = prev.correctionOfUuid
    }
    return out
  }, [payment.uuid, payment.correctionOfUuid, payment.deleted])
  if (!chain) return null
  return <DocTimeline events={paymentHistory(chain, created)} />
}
