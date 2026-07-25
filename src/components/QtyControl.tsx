import { parseNum } from '../lib/format'

/** کم/زیاد کردن تعداد با دکمه یا تایپ مستقیم */
export default function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => onChange(Math.max(1, qty - 1))}>
        −
      </button>
      <input
        className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
        inputMode="numeric"
        value={qty}
        onChange={(e) => onChange(Math.max(1, parseNum(e.target.value) || 1))}
      />
      <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => onChange(qty + 1)}>
        ＋
      </button>
    </div>
  )
}
