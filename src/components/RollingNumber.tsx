import { useEffect, useRef } from 'react'
import { fmtMoney } from '../lib/format'
import { reducedMotion } from '../lib/feedback'

/**
 * A number whose changed digits roll in (up when it grew, down when it shrank) with a short green/red
 * flash. It never counts through in-between values: the true number is on screen from the first frame,
 * because in a money app even half a second of a wrong number is wrong.
 */
/** رنگ چشمکِ هنگام تغییر. پیش‌فرض برای زمینهٔ روشن است؛ روی زمینهٔ تیره باید رنگ‌های روشن داده شود، وگرنه عدد وسط چشمک تیره و ناخوانا می‌شود. */
export interface RollFlash { up: string; down: string }

export function RollingNumber({ value, format = fmtMoney, flash }: { value: number; format?: (n: number) => string; flash?: RollFlash }) {
  const text = format(value)
  const last = useRef<{ value: number; text: string } | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const before = last.current
  const dir = before && before.value !== value && !reducedMotion() ? (value > before.value ? 'up' : 'down') : null
  // Only the number itself is split into digits, inside a left-to-right box. Each digit is an
  // inline-block, and in the app's right-to-left page loose inline-blocks are laid out right to left:
  // 13,760 showed as «۰۶۷,۳۱». The «؋» and spaces stay plain text, where the page puts them anyway.
  const [lead, digits, tail] = splitNumber(text)
  const oldDigits = before ? splitNumber(before.text)[1] : digits
  // Compare from the end: the units digit is always the last digit, whatever the length.
  const chars = [...digits]
  const old = [...oldDigits]
  const offset = old.length - chars.length

  useEffect(() => {
    const prev = last.current
    last.current = { value, text }
    if (!prev || prev.value === value || reducedMotion() || !wrap.current) return
    const el = wrap.current
    const from = value > prev.value ? (flash?.up ?? 'var(--success)') : (flash?.down ?? 'var(--danger)')
    el.animate([{ color: from }, { color: getComputedStyle(el).color }], { duration: 900, easing: 'ease-out' })
  }, [value, text])

  return (
    <span ref={wrap} className="rolling-number">
      {lead}
      <span dir="ltr" className="rolling-digits">
        {chars.map((ch, i) => {
          const changed = dir !== null && old[i + offset] !== ch
          return <span key={changed ? `${i}-${ch}-${value}` : `${i}-${ch}`} className={changed ? `roll-${dir}` : undefined}>{ch}</span>
        })}
      </span>
      {tail}
    </span>
  )
}

/** Text before the number, the number (sign, digits and separators), and text after it. */
function splitNumber(text: string): [string, string, string] {
  const m = /[-−]?[0-9۰-۹][0-9۰-۹٬,٫.]*/.exec(text)
  if (!m) return [text, '', '']
  return [text.slice(0, m.index), m[0], text.slice(m.index + m[0].length)]
}
