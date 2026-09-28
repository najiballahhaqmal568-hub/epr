import { db } from '../db'

/**
 * «سرعت فروش» — the before/after number for the redesign: how long a sale takes on this phone, from the
 * first pair in the cart to «ثبت فروش», and how many taps. Kept per device in settings; never part of
 * the accounts and never synced.
 */
export interface SaleTiming { at: number; ms: number; taps: number; pairs: number }
export interface SpeedWindow { count: number; seconds: number; taps: number }

export const SALE_TIMINGS_KEY = 'saleTimings'
const KEEP = 300
const DAY = 86_400_000
/** A cart left open for half an hour is not a timed sale (the customer went to fetch money). */
const MAX_MS = 30 * 60_000

const median = (xs: number[]) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function windowOf(list: SaleTiming[], from: number, to: number): SpeedWindow {
  const rows = list.filter((t) => t.at >= from && t.at < to && t.ms > 0 && t.ms <= MAX_MS)
  return { count: rows.length, seconds: Math.round(median(rows.map((t) => t.ms)) / 1000), taps: Math.round(median(rows.map((t) => t.taps))) }
}

/** Median seconds and taps per sale: the last 7 days and the 7 days before them. */
export function speedSummary(list: SaleTiming[], now = Date.now()): { thisWeek: SpeedWindow; lastWeek: SpeedWindow } {
  return { thisWeek: windowOf(list, now - 7 * DAY, now + 1), lastWeek: windowOf(list, now - 14 * DAY, now - 7 * DAY) }
}

export function appendTiming(list: SaleTiming[], timing: SaleTiming): SaleTiming[] {
  return [...list, timing].slice(-KEEP)
}

/** Fire-and-forget after a sale is committed: a failure here must never touch the sale. */
export async function recordSaleTiming(timing: SaleTiming): Promise<void> {
  try {
    const current = ((await db.settings.get(SALE_TIMINGS_KEY))?.value as SaleTiming[] | undefined) ?? []
    await db.settings.put({ key: SALE_TIMINGS_KEY, value: appendTiming(current, timing) })
  } catch { /* speed is a convenience; the sale is already safe */ }
}
