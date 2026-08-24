/**
 * هماهنگ‌کنندهٔ دکمهٔ برگشتِ تلیفون:
 * هر تب و هر مودال یک پله در تاریخ تلیفون ثبت می‌شود؛ برگشتِ تلیفون یک پله
 * داخل اپ عقب می‌رود (بستن مودال، یا تب قبلی) — و از خانه که خروج عادی است.
 *
 * یک شنوندهٔ popstate برای کل اپ همین‌جاست تا ترتیب و عمق از دست نرود.
 * StrictMode (فقط محیط توسعه) افکت‌ها را دوبار می‌راند؛ pendingBack و suppress
 * همین‌جا مانع دوپاره‌شدن پله‌ها می‌شوند.
 */

type TabBack = (tab: string | null) => void
type CloseFn = () => void

let depth = 0
let tabBack: TabBack | null = null
let suppress = false
let pendingBack: ReturnType<typeof setTimeout> | null = null
const modalStack: { close: CloseFn; popped: () => void }[] = []

function stateInfo(): { tab: string | null; modal: boolean } {
  const st = history.state as { tab?: string; modal?: number } | null
  return { tab: typeof st?.tab === 'string' ? st.tab : null, modal: typeof st?.modal === 'number' }
}

window.addEventListener('popstate', () => {
  if (suppress) {
    suppress = false
    return
  }
  if (depth > 0) depth--
  // بعد از Back، history.state مربوط به مقصد است و دیگر modal ندارد؛ منبع درست
  // این استکِ مودال‌های واقعاً باز است. این تفاوت فقط در build تولیدی آشکار می‌شد.
  const top = modalStack[modalStack.length - 1]
  if (top) {
    top.popped()
    modalStack.pop()
    top.close()
    return
  }
  // به تب قبلی برگرد
  const { tab } = stateInfo()
  suppress = true
  tabBack?.(tab)
})

/** ثبت پلهٔ تب — از افکت [tab] در App صدا زده می‌شود؛ suppress یعنی خودِ popstate این تغییر را ساخت */
export function pushTab(tab: string): void {
  if (suppress) {
    suppress = false
    return
  }
  depth++
  history.pushState({ tab }, '')
}

export function registerTabBack(fn: TabBack): () => void {
  tabBack = fn
  return () => {
    if (tabBack === fn) tabBack = null
  }
}

/** ثبت پلهٔ مودال — اگر پلهٔ معوقی از StrictMode مانده، همان دوباره استفاده می‌شود */
export function pushModal(): void {
  if (pendingBack != null) {
    clearTimeout(pendingBack)
    pendingBack = null
    return
  }
  depth++
  history.pushState({ modal: depth }, '')
}

/** مودال در استک */
export function addModal(close: CloseFn, markPopped: () => void): void {
  modalStack.push({ close, popped: markPopped })
}

export function removeModal(close: CloseFn): void {
  const i = modalStack.findIndex((m) => m.close === close)
  if (i < 0) return
  modalStack.splice(i, 1)
  depth = Math.max(0, depth - 1)
  // مودال با ✕/پس‌زمینه بسته شد — پلهٔ history همان مودال را نیز پس بگیر.
  // در StrictMode، mount دوم پیش از ۸۰ms همین پله را دوباره استفاده می‌کند.
  if (pendingBack == null && stateInfo().modal) {
    pendingBack = setTimeout(() => {
      pendingBack = null
      if (stateInfo().modal) {
        suppress = true
        history.back()
      }
    }, 80)
  }
}
