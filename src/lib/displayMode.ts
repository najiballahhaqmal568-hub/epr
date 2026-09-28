/**
 * نمای اپ — «عادی»، «آفتاب» (تضاد بیشتر برای بیرون دکان)، «شب» (تاریک) یا «مثل گوشی».
 * مثل اندازهٔ نوشته، تنظیم هر موبایل جداگانه است و همگام نمی‌شود. رنگ‌ها در src/themes.css اند.
 */
export const DISPLAY_MODES = [
  { id: 'light', label: 'عادی', hint: 'روشن' },
  { id: 'sun', label: 'آفتاب', hint: 'تضاد بیشتر' },
  { id: 'dark', label: 'شب', hint: 'تاریک' },
  { id: 'auto', label: 'مثل گوشی', hint: 'خودکار' }
] as const

export type DisplayModeId = (typeof DISPLAY_MODES)[number]['id']
type Theme = 'light' | 'sun' | 'dark'

const KEY = 'displayMode'
const BAR_COLOR: Record<Theme, string> = { light: '#FFFFFF', sun: '#FFFFFF', dark: '#1C1C1E' }
let systemListener: (() => void) | null = null

export function getDisplayMode(): DisplayModeId {
  try {
    const v = localStorage.getItem(KEY)
    return DISPLAY_MODES.some((m) => m.id === v) ? (v as DisplayModeId) : 'light'
  } catch {
    return 'light'
  }
}

function systemDark(): boolean {
  try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
}

export function resolveTheme(mode: DisplayModeId): Theme {
  return mode === 'auto' ? (systemDark() ? 'dark' : 'light') : mode
}

export function applyDisplayMode(mode: DisplayModeId = getDisplayMode()): void {
  const theme = resolveTheme(mode)
  const root = document.documentElement
  if (theme === 'light') delete root.dataset.theme
  else root.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR_COLOR[theme])
  const media = window.matchMedia?.('(prefers-color-scheme: dark)')
  if (systemListener) { media?.removeEventListener('change', systemListener); systemListener = null }
  if (mode === 'auto' && media) {
    systemListener = () => applyDisplayMode('auto')
    media.addEventListener('change', systemListener)
  }
}

export function setDisplayMode(mode: DisplayModeId): void {
  try { localStorage.setItem(KEY, mode) } catch { /* storage unavailable: still applies for this visit */ }
  applyDisplayMode(mode)
}
