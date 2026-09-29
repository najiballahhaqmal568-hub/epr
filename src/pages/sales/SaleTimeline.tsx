import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale } from '../../db'
import { saleHistory } from '../../lib/docHistory'
import { DocTimeline } from '../../components/DocTimeline'

/** Everything that happened to one sale: returns, exchanges, shipping, cancellation — read from the documents. */
export default function SaleTimeline({ sale }: { sale: Sale }) {
  const data = useLiveQuery(async () => ({
    returns: sale.id === undefined ? [] : await db.returns.where('kind').equals('customer').filter((r) => r.refId === sale.id).toArray(),
    payments: sale.uuid ? await db.payments.filter((p) => p.shipping?.saleUuid === sale.uuid).toArray() : []
  }), [sale.id, sale.uuid])
  if (!data) return null
  return <DocTimeline events={saleHistory(sale, data.returns, data.payments)} />
}
