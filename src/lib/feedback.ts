/** Small physical feedback: vibration on Android and a reduced-motion check. Never throws, never blocks. */
export function reducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

const PATTERNS = { tap: 12, success: [18, 60, 28], warning: [40, 50, 40] } as const

export function haptic(kind: keyof typeof PATTERNS): void {
  try { navigator.vibrate?.(PATTERNS[kind] as number | number[]) } catch { /* no vibration motor or blocked */ }
}
