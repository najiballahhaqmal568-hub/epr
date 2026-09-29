import { useEffect, useRef } from 'react'
import { fmtMoney } from '../lib/format'
import { reducedMotion } from '../lib/feedback'

/**
 * A number whose changed digits roll in (up when it grew, down when it shrank) with a short green/red
 * flash. It never counts through in-between values: the true number is on screen from the first frame,
 * because in a money app even half a second of a wrong number is wrong.
 */
export function RollingNumber({ value, format = fmtMoney }: { value: number; format?: (n: number) => string }) {
  const text = format(value)
  const last = useRef<{ value: number; text: string } | null>(null)
  const wrap = useRef<HTMLSpanElement>(null)
  const before = last.current
  const dir = before && before.value !== value && !reducedMotion() ? (value > before.value ? 'up' : 'down') : null
  // Compare from the end: the units digit is always the last digit, whatever the length.
  const chars = [...text]
  const old = before ? [...before.text] : chars
  const offset = old.length - chars.length

  useEffect(() => {
    const prev = last.current
    last.current = { value, text }
    if (!prev || prev.value === value || reducedMotion() || !wrap.current) return
    const el = wrap.current
    const flash = value > prev.value ? 'var(--success)' : 'var(--danger)'
    el.animate([{ color: flash }, { color: getComputedStyle(el).color }], { duration: 900, easing: 'ease-out' })
  }, [value, text])

  return (
    <span ref={wrap} className="rolling-number">
      {chars.map((ch, i) => {
        const changed = dir !== null && old[i + offset] !== ch
        return <span key={changed ? `${i}-${ch}-${value}` : `${i}-${ch}`} className={changed ? `roll-${dir}` : undefined}>{ch}</span>
      })}
    </span>
  )
}
