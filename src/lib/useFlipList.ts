import { useLayoutEffect, useRef, type RefObject } from 'react'
import { reducedMotion } from './feedback'

const EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'
const MAX_ANIMATED = 8 // more changes than this at once is a search or filter: no animation, just show it

/**
 * FLIP for a list: rows that stay slide to their new place, new rows fade in, removed rows fade out
 * where they were. Direct children marked data-flip-key take part. Pure decoration after the DOM
 * has already changed — nothing waits for it.
 */
export function useFlipList(container: RefObject<HTMLElement | null>): void {
  const rects = useRef(new Map<string, { top: number; left: number; width: number; height: number }>())
  const clones = useRef(new Map<string, HTMLElement>())
  useLayoutEffect(() => {
    const host = container.current
    if (!host) return
    const origin = host.getBoundingClientRect()
    const items = [...host.querySelectorAll<HTMLElement>(':scope > [data-flip-key]')]
    const now = new Map(items.map((item) => {
      const r = item.getBoundingClientRect()
      return [item.dataset.flipKey!, { top: r.top - origin.top, left: r.left - origin.left, width: r.width, height: r.height }]
    }))
    const previous = rects.current
    const removed = [...previous.keys()].filter((k) => !now.has(k))
    const added = items.filter((i) => !previous.has(i.dataset.flipKey!))
    const moved = items.filter((i) => {
      const a = previous.get(i.dataset.flipKey!)
      const b = now.get(i.dataset.flipKey!)!
      return a && (Math.abs(a.top - b.top) > 1 || Math.abs(a.left - b.left) > 1)
    })
    const animate = previous.size > 0 && !reducedMotion() && removed.length + added.length + moved.length <= MAX_ANIMATED
    if (animate) {
      for (const item of moved) {
        const a = previous.get(item.dataset.flipKey!)!
        const b = now.get(item.dataset.flipKey!)!
        item.animate([{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'none' }], { duration: 260, easing: EASE })
      }
      for (const item of added) item.animate([{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE })
      for (const key of removed) {
        const ghost = clones.current.get(key)
        const at = previous.get(key)
        if (!ghost || !at) continue
        ghost.removeAttribute('data-flip-key')
        ghost.setAttribute('aria-hidden', 'true')
        Object.assign(ghost.style, { position: 'absolute', top: `${at.top}px`, left: `${at.left}px`, width: `${at.width}px`, height: `${at.height}px`, margin: '0', pointerEvents: 'none', zIndex: '1' })
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative'
        host.appendChild(ghost)
        const out = ghost.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 240, easing: EASE })
        out.onfinish = () => ghost.remove()
        out.oncancel = () => ghost.remove()
      }
    }
    rects.current = now
    clones.current = items.length <= 60 ? new Map(items.map((i) => [i.dataset.flipKey!, i.cloneNode(true) as HTMLElement])) : new Map()
  })
}
