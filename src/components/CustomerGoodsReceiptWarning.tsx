import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { loadCustomerGoodsReceipt } from '../lib/customerGoodsReceiptState'

export interface CustomerGoodsReceiptReview {
  readyReceiptUuids: Set<string>
  blocked: Array<{ uuid: string; issues: string[] }>
}

export function useCustomerGoodsReceiptReview(): CustomerGoodsReceiptReview {
  return useLiveQuery(async () => {
    const [payments, adjustments, sales, cashMovements] = await Promise.all([db.payments.toArray(), db.adjustments.toArray(), db.sales.toArray(), db.cashMovements.toArray()])
    const uuids = new Set<string>()
    payments.forEach(row => { if (row.goodsReceipt?.receiptUuid) uuids.add(row.goodsReceipt.receiptUuid) })
    adjustments.forEach(row => { if (row.goodsReceiptChild?.receiptUuid) uuids.add(row.goodsReceiptChild.receiptUuid) })
    sales.forEach(row => { if (row.goodsReceiptChild?.receiptUuid) uuids.add(row.goodsReceiptChild.receiptUuid) })
    cashMovements.forEach(row => { if (row.goodsReceiptChild?.receiptUuid) uuids.add(row.goodsReceiptChild.receiptUuid) })
    const states = await Promise.all([...uuids].map(uuid => loadCustomerGoodsReceipt(uuid)))
    return {
      readyReceiptUuids: new Set(states.filter(state => state.status === 'ready').map(state => state.receiptUuid)),
      blocked: states.filter(state => state.status === 'incomplete' || state.status === 'conflict').map(state => ({ uuid: state.receiptUuid, issues: state.issues }))
    }
  }, []) ?? { readyReceiptUuids: new Set<string>(), blocked: [] }
}

export default function CustomerGoodsReceiptWarning({ review }: { review: CustomerGoodsReceiptReview }) {
  if (!review.blocked.length) return null
  return <div role="alert" className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p className="font-bold">{review.blocked.length} سند دریافت جنس هنوز کامل یا بدون تعارض نیست.</p><p>فروش پیوندی این سندها تا تکمیل همگام‌سازی در جمع تأییدشده حساب نمی‌شود.</p></div>
}
