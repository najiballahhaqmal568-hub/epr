import type { SyncTable } from '../db'
import { receiptCanonical } from './customerGoodsReceiptTypes'

type Row = Record<string, unknown>
interface ReceiptMarker {
  receiptUuid: string
  revision?: string
  status?: string
  signature: string
}

function markerOf(table: SyncTable, row: Row | undefined): ReceiptMarker | undefined {
  if (!row) return undefined
  const value = table === 'payments' ? row.goodsReceipt :
    (table === 'sales' || table === 'adjustments' || table === 'cashMovements') ? row.goodsReceiptChild : undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const marker = value as Record<string, unknown>
  if (typeof marker.receiptUuid !== 'string') return undefined
  return {
    receiptUuid: marker.receiptUuid,
    revision: typeof marker.revision === 'string' ? marker.revision : undefined,
    status: typeof marker.status === 'string' ? marker.status : undefined,
    signature: receiptCanonical(marker)
  }
}

export interface ReceiptReplayDecision {
  keepExisting: boolean
  conflict?: { receiptUuid: string; evidence: string[] }
}

/** Row transports are last-writer-wins, but a receipt is an aggregate. Keep a
 * deterministic row winner and retain evidence whenever equal-level receipt
 * metadata competes, so the aggregate can never silently become editable. */
export function receiptReplayDecision(table: SyncTable, existing: Row | undefined, incoming: Row): ReceiptReplayDecision {
  const oldMarker = markerOf(table, existing)
  const newMarker = markerOf(table, incoming)
  if (!oldMarker && !newMarker) return { keepExisting: false }
  if (oldMarker && !newMarker) return {
    keepExisting: true,
    conflict: { receiptUuid: oldMarker.receiptUuid, evidence: [oldMarker.signature, 'receipt-marker-stripped'].sort() }
  }
  if (!oldMarker || !newMarker) return { keepExisting: false }

  const sameIdentity = oldMarker.receiptUuid === newMarker.receiptUuid && oldMarker.revision === newMarker.revision
  if (sameIdentity && oldMarker.status === 'cancelled' && newMarker.status === 'active') return { keepExisting: true }
  if (sameIdentity && oldMarker.status === 'active' && newMarker.status === 'cancelled') return { keepExisting: false }
  if (oldMarker.signature === newMarker.signature) return { keepExisting: false }

  const evidence = [oldMarker.signature, newMarker.signature].sort()
  return {
    keepExisting: oldMarker.signature > newMarker.signature,
    conflict: { receiptUuid: oldMarker.receiptUuid, evidence }
  }
}
