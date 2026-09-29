import { useState } from 'react'
import { Card } from '../../components/ui'
import { DISPLAY_MODES, getDisplayMode, setDisplayMode, type DisplayModeId } from '../../lib/displayMode'

export function DisplayModeCard() {
  const [mode, setMode] = useState<DisplayModeId>(() => getDisplayMode())
  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">نمای اپ</p>
      <p className="mb-3 text-sm text-slate-500">
        بیرون دکان در آفتاب «آفتاب» را بزنید تا نوشته‌ها پررنگ‌تر شوند؛ شب «شب» چشم را کمتر خسته می‌کند. فقط برای همین موبایل.
      </p>
      <div className="segmented" role="group" aria-label="نمای اپ">
        {DISPLAY_MODES.map((m) => (
          <button key={m.id} aria-pressed={mode === m.id} onClick={() => { setDisplayMode(m.id); setMode(m.id) }}>
            <span className="block font-bold">{m.label}</span>
            <span className="block text-xs">{m.hint}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}

export default DisplayModeCard
