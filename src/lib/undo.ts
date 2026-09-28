/**
 * «برگرداندن» کوتاه‌مدت: بعد از ثبت یک سند تازه، ۱۰ ثانیه فرصت است تا با یک
 * دست‌زدن برگردد. خود برگرداندن همان عملیات حذف موجود در ops.ts است — سند برای
 * رد حساب می‌ماند و اثر پول و قرضش با سند برعکس برمی‌گردد؛ قاعدهٔ تازه‌ای ساخته نمی‌شود.
 */
export const UNDO_SECONDS = 10

export interface UndoOffer {
  id: number
  label: string
  expiresAt: number
  run: () => Promise<void>
}

let current: UndoOffer | null = null
let nextId = 1
const listeners = new Set<(offer: UndoOffer | null) => void>()
let timer: ReturnType<typeof setTimeout> | undefined

function publish(offer: UndoOffer | null) {
  current = offer
  for (const listener of listeners) listener(offer)
}

/** Replaces any earlier offer: only the latest document can be undone this way. */
export function offerUndo(label: string, run: () => Promise<void>, seconds = UNDO_SECONDS): void {
  if (timer) clearTimeout(timer)
  const offer = { id: nextId++, label, expiresAt: Date.now() + seconds * 1000, run }
  publish(offer)
  timer = setTimeout(() => { if (current?.id === offer.id) publish(null) }, seconds * 1000)
}

export function dismissUndo(): void {
  if (timer) clearTimeout(timer)
  publish(null)
}

/** Runs the offer once; a second tap or an expired offer does nothing. */
export async function runUndo(id: number): Promise<boolean> {
  const offer = current
  if (!offer || offer.id !== id || Date.now() > offer.expiresAt) return false
  dismissUndo()
  await offer.run()
  return true
}

export function subscribeUndo(listener: (offer: UndoOffer | null) => void): () => void {
  listeners.add(listener)
  listener(current)
  return () => { listeners.delete(listener) }
}
