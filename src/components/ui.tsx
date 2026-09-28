import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Icon } from './Icon'
import { accessFlags } from '../db'
import { addModal, pushModal, removeModal } from '../lib/appHistory'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  // دکمهٔ برگشتِ تلیفون مودال را می‌بندد، نه اینکه از اپ بیرون بزند.
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const poppedRef = useRef(false)

  useEffect(() => {
    const dialog = dialogRef.current
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog?.showModal()
    pushModal()
    const entry = {
      close: () => closeRef.current(),
      popped: () => {
        poppedRef.current = true
      }
    }
    addModal(entry.close, entry.popped)
    return () => {
      dialog?.close()
      if (opener?.isConnected) opener.focus({ preventScroll: true })
      // اگر Back مودال را بسته، appHistory همان پله و استک را جمع کرده است.
      if (!poppedRef.current) removeModal(entry.close)
    }
  }, [])

  // روی موبایل پنجره یک ورق پایین است: با کش دادن سرش به پایین بسته می‌شود.
  const drag = useRef<{ y: number; t: number; dy: number } | null>(null)
  function dragStart(event: React.PointerEvent<HTMLDivElement>) {
    const dialog = dialogRef.current
    if (!dialog || event.button !== 0 || !window.matchMedia('(max-width: 899px)').matches) return
    if ((event.target as Element).closest('button, a, input, select, textarea') || dialog.scrollTop > 0) return
    drag.current = { y: event.clientY, t: performance.now(), dy: 0 }
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  function dragMove(event: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current
    const dialog = dialogRef.current
    if (!d || !dialog) return
    d.dy = Math.max(0, event.clientY - d.y)
    dialog.style.transition = 'none'
    dialog.style.transform = `translateY(${d.dy}px)`
  }
  function dragEnd() {
    const d = drag.current
    const dialog = dialogRef.current
    drag.current = null
    if (!d || !dialog) return
    dialog.style.transition = ''
    dialog.style.transform = ''
    const speed = d.dy / Math.max(1, performance.now() - d.t)
    if (d.dy > 110 || (d.dy > 36 && speed > 0.6)) closeRef.current()
  }

  return (
    <dialog ref={dialogRef} className="modal-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}>
      <div className="modal-body">
        <div className="modal-grab" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
        <span className="sheet-handle" aria-hidden="true" />
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
        </div>
        </div>
        {children}
      </div>
    </dialog>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="field-label">{label}</span>
      {children}
    </label>
  )
}

export const inputCls = 'ui-input'

export function PrimaryBtn({ children, onClick, disabled, type }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'submit' | 'button' }) {
  return (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      className="primary-button"
    >
      {children}
    </button>
  )
}

export function Fab({ onClick, label }: { onClick: () => void; label?: string }) {
  // در حالت فقط مشاهده (شریک) دکمه‌های افزودن نمایش داده نمی‌شوند
  if (accessFlags.readOnly) return null
  return (
    <button
      onClick={onClick}
      aria-label={label || 'افزودن'}
      className="premium-fab"
    >
      <Icon name="plus" /> {label}
    </button>
  )
}

/** Grey shapes where content is about to appear, so the page does not jump when it arrives. */
export function Skeleton({ rows = 3, label = 'در حال خواندن…' }: { rows?: number; label?: string }) {
  return (
    <div role="status" aria-label={label} className="skeleton">
      {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton-row" style={{ width: `${92 - (i % 3) * 14}%` }} />)}
    </div>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="empty-state">{text}</p>
}

export function Card({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick ? (event) => {
      const target = event.target as Element
      const control = target.closest('button, a, input, select, textarea, summary, [role="button"], [contenteditable="true"]')
      if (control && control !== event.currentTarget) return
      onClick()
    } : undefined} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onClick() } } : undefined}
      className="ui-card">
      {children}
    </div>
  )
}
