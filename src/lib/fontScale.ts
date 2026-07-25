/**
 * اندازهٔ فونت اپ — تنظیم هر موبایل جداگانه است و همگام نمی‌شود،
 * چون چشم هر کس فرق دارد. با تغییر font-size ریشه، همهٔ اپ بزرگ/کوچک می‌شود.
 */
export const FONT_SCALES = [
  { id: 'sm', label: 'کوچک', px: 14 },
  { id: 'md', label: 'عادی', px: 16 },
  { id: 'lg', label: 'بزرگ', px: 18 },
  { id: 'xl', label: 'خیلی بزرگ', px: 21 }
] as const

export type FontScaleId = (typeof FONT_SCALES)[number]['id']

const KEY = 'fontScale'

export function getFontScale(): FontScaleId {
  const v = localStorage.getItem(KEY)
  return FONT_SCALES.some((s) => s.id === v) ? (v as FontScaleId) : 'md'
}

export function applyFontScale(id: FontScaleId = getFontScale()): void {
  const s = FONT_SCALES.find((x) => x.id === id) ?? FONT_SCALES[1]
  document.documentElement.style.fontSize = `${s.px}px`
}

export function setFontScale(id: FontScaleId): void {
  localStorage.setItem(KEY, id)
  applyFontScale(id)
}
