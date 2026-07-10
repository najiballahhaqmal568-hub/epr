import { useState } from 'react'

export async function hashPin(pin: string): Promise<string> {
  const data = new TextEncoder().encode(`shoeErp:${pin}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function PinPad({ title, onSubmit, error }: { title: string; onSubmit: (pin: string) => void; error?: string }) {
  const [pin, setPin] = useState('')

  function press(d: string) {
    if (d === '⌫') return setPin((p) => p.slice(0, -1))
    if (pin.length >= 4) return
    const next = pin + d
    setPin(next)
    if (next.length === 4) {
      onSubmit(next)
      setTimeout(() => setPin(''), 300)
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-teal-800 p-6 text-white">
      <img src="./icon-192.png" alt="اتال" className="mb-3 h-20 w-20 rounded-2xl" />
      <p className="mb-6 text-lg font-bold">{title}</p>
      <div className="mb-6 flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={`h-4 w-4 rounded-full ${i < pin.length ? 'bg-white' : 'bg-white/30'}`} />
        ))}
      </div>
      {error && <p className="mb-4 text-sm font-bold text-amber-300">{error}</p>}
      <div className="grid grid-cols-3 gap-3" dir="ltr">
        {['۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹', '', '۰', '⌫'].map((k, i) =>
          k === '' ? (
            <span key={i} />
          ) : (
            <button
              key={i}
              onClick={() => press(k === '⌫' ? '⌫' : String('۰۱۲۳۴۵۶۷۸۹'.indexOf(k)))}
              className="h-16 w-16 rounded-full bg-white/10 text-2xl font-bold active:bg-white/30"
            >
              {k}
            </button>
          )
        )}
      </div>
    </div>
  )
}
