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

  return (
    <dialog ref={dialogRef} className="modal-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}>
      <div className="modal-body">
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button onClick={onClose} aria-label="بستن">
            <Icon name="close" />
          </button>
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
