// Shared text-contrast audit: every visible text element must meet WCAG AA against the colour it
// is actually drawn on (ancestor backgrounds blended, opacity included). Returns the failures.
export const contrastFailures = (page, scope = 'body') => page.evaluate(scope => {
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = 1
  const ctx = cvs.getContext('2d', { willReadFrequently: true })
  const rgba = c => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255] }
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1] }
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]) }
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05) }
  function background(el) {
    const layers = []
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n)
      const c = rgba(cs.backgroundColor)
      if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break }
      if (n.tagName === 'DIALOG' && n.open) break
    }
    let base = rgba(getComputedStyle(document.body).backgroundColor)
    if (base[3] < 1) base = over(base, [255, 255, 255, 1])
    for (const layer of layers.reverse()) base = over(layer, base)
    return base
  }
  const opacity = el => { let o = 1; for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o }
  const root = document.querySelector(scope) ?? document.body
  const top = document.querySelectorAll('dialog[open]')
  const within = top.length ? top[top.length - 1] : root
  const failures = []
  for (const el of within.querySelectorAll('*')) {
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue
    if (el.closest('[aria-hidden="true"], svg, canvas, img, option') || el.matches(':disabled') || el.closest(':disabled, [aria-disabled="true"]')) continue
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue
    const bg = background(el)
    const fg = rgba(cs.color); fg[3] *= opacity(el)
    const shown = over(fg, bg)
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5
    const got = ratio(shown, bg)
    if (got + 0.01 < need) failures.push(`${got.toFixed(2)}<${need} «${el.textContent.trim().slice(0, 40)}» ${cs.color} on rgb(${bg.slice(0, 3).map(Math.round)})`)
  }
  return failures
}, scope)
