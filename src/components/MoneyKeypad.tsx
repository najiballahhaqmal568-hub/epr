import { fmtNum } from '../lib/format'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '000', '0', 'back'] as const

/** Big keys for amounts — replaces the phone keyboard that would cover half the sale. */
export function MoneyKeypad({ onKey, onDone }: { onKey: (key: string) => void; onDone: () => void }) {
  return (
    <div className="money-keypad" role="group" aria-label="صفحه‌کلید پول">
      {KEYS.map((k) => (
        <button key={k} type="button" aria-label={k === 'back' ? 'پاک کردن یک رقم' : fmtNum(Number(k)) + (k === '000' ? '۰۰' : '')}
          onPointerDown={(e) => e.preventDefault()} onClick={() => onKey(k)}>
          {k === 'back' ? '⌫' : k === '000' ? '۰۰۰' : fmtNum(Number(k))}
        </button>
      ))}
      <button type="button" className="money-keypad-done" onPointerDown={(e) => e.preventDefault()} onClick={onDone}>تمام</button>
    </div>
  )
}
