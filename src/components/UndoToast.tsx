import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { dismissUndo, runUndo, subscribeUndo, UNDO_SECONDS, type UndoOffer } from '../lib/undo'
import { fmtNum } from '../lib/format'

/** The topmost open window; outside it the page is inert, so the bar must live inside it. */
function topWindow(): HTMLDialogElement | null {
  const open = document.querySelectorAll<HTMLDialogElement>('dialog[open]')
  return open.length ? open[open.length - 1] : null
}

/** نوار کوچک «ثبت شد — برگرداندن (۹)»: بالای منوی پایین، یا پایین همان پنجره‌ای که باز است. */
export function UndoToast() {
  const [offer, setOffer] = useState<UndoOffer | null>(null)
  const [now, setNow] = useState(Date.now())
  const [host, setHost] = useState<HTMLDialogElement | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const visible = Boolean(offer || message)

  useEffect(() => subscribeUndo(setOffer), [])
  useEffect(() => {
    if (!visible) return
    const tick = () => { setNow(Date.now()); setHost(topWindow()) }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [visible])
  useEffect(() => {
    if (!message) return
    const hide = setTimeout(() => setMessage(null), message.error ? 8000 : 3000)
    return () => clearTimeout(hide)
  }, [message])

  async function undo() {
    if (!offer || busy) return
    setBusy(true)
    try {
      const done = await runUndo(offer.id)
      setMessage(done ? { text: 'برگردانده شد — پول و حساب مثل قبل شد.', error: false } : { text: 'وقت برگرداندن تمام شده است.', error: true })
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true })
    } finally { setBusy(false) }
  }

  if (!visible) return null
  const left = offer ? Math.max(0, Math.ceil((offer.expiresAt - now) / 1000)) : 0
  const inWindow = Boolean(host?.isConnected)
  const bar = (
    <div className={inWindow ? 'undo-toast undo-toast-in-window' : 'undo-toast'} role={message?.error ? 'alert' : 'status'} aria-live="polite">
      {offer ? <>
        <span className="min-w-0 flex-1">{offer.label}</span>
        <button type="button" className="undo-toast-action" disabled={busy} onClick={() => void undo()}>
          برگرداندن ({fmtNum(left)})
        </button>
        <button type="button" className="undo-toast-close" aria-label="بستن" onClick={dismissUndo}>×</button>
        <span className="undo-progress" aria-hidden="true" style={{ transform: `scaleX(${Math.max(0, Math.min(1, (offer.expiresAt - now) / (UNDO_SECONDS * 1000)))})` }} />
      </> : <span className="min-w-0 flex-1">{message?.text}</span>}
    </div>
  )
  return inWindow ? createPortal(bar, host!) : bar
}
