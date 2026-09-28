import { haptic, reducedMotion } from './feedback'

/**
 * Motion that tells the seller what happened without reading. Everything here is decoration on top of
 * a state change that has already happened: it never blocks input, never delays a write, and is skipped
 * entirely when the phone asks for reduced motion.
 */

/** A small pill with the size flies from the tapped tile to the cart bar, which then bumps. */
export function flyToCart(from: Element, label: string): void {
  haptic('tap')
  if (reducedMotion()) return
  const a = from.getBoundingClientRect()
  const target = document.querySelector<HTMLElement>('[data-cart-target]')
  const b = target?.getBoundingClientRect()
  const tx = b && b.width ? b.left + b.width / 2 : window.innerWidth / 2
  const ty = b && b.height ? b.top + b.height / 2 : window.innerHeight - 150
  const dot = document.createElement('div')
  dot.className = 'fly-dot'
  dot.textContent = label
  dot.setAttribute('aria-hidden', 'true')
  const sx = a.left + a.width / 2 - 22
  const sy = a.top + a.height / 2 - 22
  dot.style.left = `${sx}px`
  dot.style.top = `${sy}px`
  document.body.appendChild(dot)
  const dx = tx - 22 - sx
  const dy = ty - 22 - sy
  const flight = dot.animate([
    { transform: 'translate(0, 0) scale(1)', opacity: 1 },
    { transform: `translate(${dx * 0.55}px, ${dy * 0.55 - 70}px) scale(0.95)`, opacity: 1, offset: 0.55 },
    { transform: `translate(${dx}px, ${dy}px) scale(0.45)`, opacity: 0.15 }
  ], { duration: 440, easing: 'cubic-bezier(0.45, 0, 0.3, 1)' })
  const done = () => { dot.remove(); bump('[data-cart-target]') }
  flight.onfinish = done
  flight.oncancel = done
}

/** A short spring on an element that just changed (the cart bar, a count). */
export function bump(selector: string): void {
  if (reducedMotion()) return
  document.querySelector<HTMLElement>(selector)?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }],
    { duration: 280, easing: 'cubic-bezier(0.34, 1.4, 0.64, 1)' }
  )
}

/** Sale saved: a check mark grows in the middle of the screen and fades; the phone buzzes once. */
export function saleCheck(): void {
  haptic('success')
  if (reducedMotion()) return
  const mark = document.createElement('div')
  mark.className = 'sale-check'
  mark.setAttribute('aria-hidden', 'true')
  mark.innerHTML = '<svg viewBox="0 0 52 52" width="72" height="72"><circle cx="26" cy="26" r="24" fill="none" stroke="currentColor" stroke-width="3"/><path d="M15 27l7 7 15-16" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  const host = document.querySelector('dialog[open]') ?? document.body
  host.appendChild(mark)
  const show = mark.animate([
    { transform: 'translate(-50%, -50%) scale(0.6)', opacity: 0 },
    { transform: 'translate(-50%, -50%) scale(1.05)', opacity: 1, offset: 0.3 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 1, offset: 0.7 },
    { transform: 'translate(-50%, -50%) scale(1)', opacity: 0 }
  ], { duration: 900, easing: 'ease-out' })
  show.onfinish = () => mark.remove()
  show.oncancel = () => mark.remove()
}

/** Target reached: a short burst of paper from the card. Once, small, and gone in a second. */
export function celebrate(from: Element): void {
  haptic('success')
  if (reducedMotion()) return
  const r = from.getBoundingClientRect()
  const colors = ['var(--success)', 'var(--action)', 'var(--warning)', 'var(--danger)']
  for (let i = 0; i < 22; i++) {
    const bit = document.createElement('span')
    bit.className = 'confetti-bit'
    bit.setAttribute('aria-hidden', 'true')
    bit.style.left = `${r.left + r.width / 2}px`
    bit.style.top = `${r.top + r.height / 3}px`
    bit.style.background = colors[i % colors.length]
    document.body.appendChild(bit)
    const angle = (Math.PI * 2 * i) / 22 + Math.random() * 0.4
    const dist = 70 + Math.random() * 90
    const fly = bit.animate([
      { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist - 30}px)) rotate(${200 + i * 20}deg)`, opacity: 1, offset: 0.6 },
      { transform: `translate(calc(-50% + ${Math.cos(angle) * dist * 1.1}px), calc(-50% + ${Math.sin(angle) * dist + 60}px)) rotate(${320 + i * 25}deg)`, opacity: 0 }
    ], { duration: 1100 + Math.random() * 300, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' })
    fly.onfinish = () => bit.remove()
    fly.oncancel = () => bit.remove()
  }
}
