import { type ReactNode } from 'react'

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl bg-white p-4 pb-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{title}</h2>
          <button onClick={onClose} className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-sm font-bold text-slate-600">{label}</span>
      {children}
    </label>
  )
}

export const inputCls =
  'w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-slate-800 focus:border-teal-600 focus:outline-none'

export function PrimaryBtn({ children, onClick, disabled, type }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: 'submit' | 'button' }) {
  return (
    <button
      type={type ?? 'button'}
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-xl bg-teal-700 py-3 font-bold text-white active:bg-teal-800 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

export function Fab({ onClick, label }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-20 left-4 z-40 flex items-center gap-1 rounded-full bg-teal-700 px-5 py-3.5 text-lg font-bold text-white shadow-lg active:bg-teal-800"
    >
      ＋ {label}
    </button>
  )
}

export function Empty({ text }: { text: string }) {
  return <p className="mt-16 text-center text-slate-400">{text}</p>
}

export function Card({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <div onClick={onClick} className="mb-2 rounded-xl bg-white p-3 shadow-sm active:bg-slate-50">
      {children}
    </div>
  )
}
