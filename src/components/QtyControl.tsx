import { parseNum } from '../lib/format'

/** کم/زیاد کردن تعداد با دکمه یا تایپ مستقیم */
export default function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="sale-quantity-actions">
      <button type="button" aria-label="کاهش تعداد" disabled={qty <= 1} className="quantity-step" onClick={() => onChange(Math.max(1, qty - 1))}>
        −
      </button>
      <input
        className="quantity-value"
        aria-label="تعداد"
        inputMode="numeric"
        value={qty}
        onChange={(e) => onChange(Math.max(1, Math.floor(parseNum(e.target.value) || 1)))}
      />
      <button type="button" aria-label="افزایش تعداد" className="quantity-step" onClick={() => onChange(qty + 1)}>
        ＋
      </button>
    </div>
  )
}
