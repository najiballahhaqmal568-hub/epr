import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { loadDirectTrade, type DirectTradeState } from '../lib/directTradeState'

export interface DirectTradeReview {
  loading: boolean
  error?: string
  states: DirectTradeState[]
  readyTradeUuids: ReadonlySet<string>
  unsafeTradeUuids: ReadonlySet<string>
}

export function useDirectTradeReview(): DirectTradeReview {
  const result = useLiveQuery(async () => {
    try {
      const [sales, purchases] = await Promise.all([
        db.sales.filter(row => Boolean(row.directTrade)).toArray(),
        db.purchases.filter(row => Boolean(row.directTrade)).toArray()
      ])
      const uuids = new Set<string>()
      for (const row of [...sales, ...purchases]) if (row.directTrade?.uuid) uuids.add(row.directTrade.uuid)
      const states = await Promise.all([...uuids].map(loadDirectTrade))
      return { states }
    } catch (error) {
      return { states: [] as DirectTradeState[], error: error instanceof Error ? error.message : 'بررسی معامله‌های مستقیم ناموفق شد.' }
    }
  }, [])
  const states = result?.states ?? []
  return {
    loading: result === undefined,
    error: result?.error,
    states,
    readyTradeUuids: new Set(states.filter(state => state.status === 'ready')
      .map(state => state.sale?.directTrade?.uuid).filter((uuid): uuid is string => Boolean(uuid))),
    unsafeTradeUuids: new Set(states.filter(state => state.status === 'incomplete' || state.status === 'conflict')
      .map(state => state.sale?.directTrade?.uuid ?? state.purchase?.directTrade?.uuid).filter((uuid): uuid is string => Boolean(uuid)))
  }
}

export default function DirectTradeWarning({ review }: { review: DirectTradeReview }) {
  if (review.loading) return <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">در حال بررسی کامل‌بودن معامله‌های مستقیم؛ جمع‌ها هنوز تأیید نشده‌اند.</div>
  if (review.error) return <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">بررسی معامله‌های مستقیم ناموفق شد؛ جمع‌ها تأیید نشده‌اند. {review.error}</div>
  if (!review.unsafeTradeUuids.size) return null
  return <div className="mb-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">⚠️ {review.unsafeTradeUuids.size} معاملهٔ مستقیم ناقص یا متعارض است؛ این معامله‌ها از جمع‌های تأییدشده کنار گذاشته شده‌اند.</div>
}
