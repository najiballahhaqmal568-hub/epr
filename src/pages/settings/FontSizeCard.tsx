import { useState } from 'react'
import { Card } from '../../components/ui'
import { FONT_SCALES, getFontScale, setFontScale, type FontScaleId } from '../../lib/fontScale'

export function FontSizeCard() {
  const [scale, setScale] = useState<FontScaleId>(() => getFontScale())

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">اندازهٔ نوشته</p>
      <p className="mb-3 text-sm text-slate-500">
        اگر نوشته‌ها خورد معلوم می‌شود، بزرگ‌ترش کنید. این تنظیم فقط برای همین موبایل است.
      </p>
      <div className="flex gap-2">
        {FONT_SCALES.map((s) => (
          <button
            key={s.id}
            onClick={() => {
              setFontScale(s.id)
              setScale(s.id)
            }}
            className={`flex-1 rounded-xl py-3 font-bold ${scale === s.id ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}
            style={{ fontSize: `${s.px}px` }}
          >
            {s.label}
          </button>
        ))}
      </div>
      <p className="mt-3 rounded-xl bg-slate-50 p-3 text-slate-700">نمونه: فروش امروز ۱۲٬۵۰۰ ؋</p>
    </Card>
  )
}

export default FontSizeCard
