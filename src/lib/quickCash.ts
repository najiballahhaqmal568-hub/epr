import { toLatinDigits } from './format'

/**
 * Amounts a customer is likely to hand over for this total: the exact amount first, then the next
 * round notes (100, 500, 1000, and one thousand more). Whole afghani only; at most four choices.
 */
export function quickCashOptions(total: number): number[] {
  if (!Number.isFinite(total) || total <= 0) return []
  const exact = Math.round(total)
  const up = (step: number) => Math.ceil(exact / step) * step
  const extras = [up(100), up(500), up(1000), up(1000) + 1000].filter(v => v > exact)
  return [exact, ...[...new Set(extras)].sort((a, b) => a - b).slice(0, 3)]
}

/** One keypad press applied to the typed amount. `fresh` means the field still shows a suggestion. */
export function keypadPress(current: string, key: string, fresh: boolean): string {
  const base = fresh ? '' : toLatinDigits(current).replace(/[^\d]/g, '')
  if (key === 'back') return base.slice(0, -1)
  if (!/^\d+$/.test(key)) return base
  const next = (base + key).replace(/^0+(?=\d)/, '')
  return next.length > 9 ? base : next
}
