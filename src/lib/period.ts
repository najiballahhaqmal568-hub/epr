/** دوره‌های آماری مشترک بین تب‌های فروش و مصارف */
import { startOfDay, startOfMonth } from './format'

export type StatsPeriod = 'today' | 'week' | 'month' | 'prevMonth'

export const STATS_PERIODS: { id: StatsPeriod; label: string }[] = [
  { id: 'today', label: 'امروز' },
  { id: 'week', label: '۷ روز' },
  { id: 'month', label: 'این ماه' },
  { id: 'prevMonth', label: 'ماه گذشته' }
]

export const periodLabel = (p: StatsPeriod): string => STATS_PERIODS.find((x) => x.id === p)?.label ?? ''

/**
 * مرز شروع و پایان دوره.
 * از تاریخ «همین حالا» حساب می‌شود و بین رندرها ثابت می‌ماند تا liveQuery درست کار کند.
 */
export function periodBounds(period: StatsPeriod): { from: number; to: number } {
  const now = new Date()
  switch (period) {
    case 'today':
      return { from: startOfDay(), to: Number.MAX_SAFE_INTEGER }
    case 'week':
      return { from: startOfDay() - 6 * 86400000, to: Number.MAX_SAFE_INTEGER }
    case 'month':
      return { from: startOfMonth(), to: Number.MAX_SAFE_INTEGER }
    case 'prevMonth':
      return {
        from: new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(),
        to: new Date(now.getFullYear(), now.getMonth(), 1).getTime() - 1
      }
  }
}
