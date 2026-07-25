import { useState, useEffect } from 'react'
import { type Sale } from '../../db'
import { fmtNum, fmtDate } from '../../lib/format'
import { Modal } from '../../components/ui'

/** رسید تصویری فروش — برای ارسال در واتساپ/تلگرام */
export function ReceiptModal({ sale, onClose, onNext }: { sale: Sale; onClose: () => void; onNext?: () => void }) {
  const [img, setImg] = useState<string>('')
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await document.fonts.ready
      const url = drawReceipt(sale)
      if (!cancelled) setImg(url)
    })()
    return () => {
      cancelled = true
    }
  }, [sale])

  async function share() {
    try {
      const blob = await (await fetch(img)).blob()
      const file = new File([blob], 'atal-receipt.png', { type: 'image/png' })
      const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean }
      if (nav.share && nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file], title: 'رسید فروشگاه اتل' })
        return
      }
      throw new Error('no-share')
    } catch {
      const a = document.createElement('a')
      a.href = img
      a.download = 'atal-receipt.png'
      a.click()
      setMsg('رسید دانلود شد — از گالری در واتساپ/تلگرام بفرستید.')
    }
  }

  return (
    <Modal title="🧾 رسید فروش" onClose={onClose}>
      {img ? <img src={img} alt="رسید" className="mb-3 w-full rounded-xl border border-slate-200" /> : <p className="py-8 text-center text-slate-400">در حال ساخت رسید...</p>}
      {msg && <p className="mb-2 text-sm font-bold text-teal-700">{msg}</p>}
      <div className="flex gap-2">
        <button onClick={() => void share()} className="flex-1 rounded-xl bg-teal-700 py-3 font-bold text-white active:bg-teal-800">
          📤 اشتراک (واتساپ/تلگرام)
        </button>
        <button onClick={onClose} className="rounded-xl bg-slate-100 px-6 py-3 font-bold text-slate-600">
          بستن
        </button>
      </div>
      {/* در وقت شلوغ: مستقیم به فروش بعدی */}
      {onNext && (
        <button onClick={onNext} className="mt-2 w-full rounded-xl bg-amber-100 py-3 text-lg font-bold text-amber-800 active:bg-amber-200">
          ➕ فروش بعدی
        </button>
      )}
    </Modal>
  )
}

function drawReceipt(sale: Sale): string {
  const W = 640
  const remainder = sale.total - sale.paid
  const discount = sale.discount ?? 0
  const subtotal = sale.total + discount
  const extraRows = (discount > 0 ? 1 : 0) + (remainder > 0 ? 1 : 0)
  const H = 330 + sale.lines.length * 44 + extraRows * 40 + 120
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const x = c.getContext('2d')!
  x.fillStyle = '#ffffff'
  x.fillRect(0, 0, W, H)
  x.direction = 'rtl'

  // سرصفحه
  x.fillStyle = '#0f766e'
  x.fillRect(0, 0, W, 96)
  x.fillStyle = '#ffffff'
  x.textAlign = 'center'
  x.font = 'bold 36px Vazirmatn, sans-serif'
  x.fillText('فروشگاه اتل 👞', W / 2, 46)
  x.font = '22px Vazirmatn, sans-serif'
  x.fillText(fmtDate(sale.date), W / 2, 80)

  let y = 140
  x.fillStyle = '#334155'
  x.textAlign = 'right'
  x.font = 'bold 24px Vazirmatn, sans-serif'
  x.fillText(`مشتری: ${sale.customerName || 'نقدی'}`, W - 30, y)
  x.textAlign = 'left'
  x.font = '22px Vazirmatn, sans-serif'
  x.fillText(sale.saleType === 'retail' ? 'پرچون' : 'عمده', 30, y)
  y += 24

  // خط جدا
  x.strokeStyle = '#e2e8f0'
  x.beginPath(); x.moveTo(30, y); x.lineTo(W - 30, y); x.stroke()
  y += 36

  for (const l of sale.lines) {
    x.fillStyle = '#0f172a'
    x.textAlign = 'right'
    x.font = '24px Vazirmatn, sans-serif'
    x.fillText(`${l.productName} ${l.size} ${l.color}`.replace(/\s+/g, ' '), W - 30, y)
    x.textAlign = 'left'
    x.fillStyle = '#334155'
    x.fillText(`${fmtNum(l.qty)} × ${fmtNum(l.unitPrice)} = ${fmtNum(l.qty * l.unitPrice)}`, 30, y)
    y += 44
  }

  x.beginPath(); x.moveTo(30, y - 14); x.lineTo(W - 30, y - 14); x.stroke()
  y += 10

  const row = (label: string, val: string, color = '#0f172a', bold = false) => {
    x.fillStyle = color
    x.font = `${bold ? 'bold ' : ''}26px Vazirmatn, sans-serif`
    x.textAlign = 'right'
    x.fillText(label, W - 30, y)
    x.textAlign = 'left'
    x.fillText(val, 30, y)
    y += 40
  }
  if (discount > 0) {
    row('مجموع اجناس', `${fmtNum(subtotal)} ؋`)
    row('تخفیف', `${fmtNum(discount)} ؋`, '#d97706')
  }
  row('قابل پرداخت', `${fmtNum(sale.total)} ؋`, '#0f766e', true)
  row('دریافتی', `${fmtNum(sale.paid)} ؋`)
  if (remainder > 0) row('باقی (قرض)', `${fmtNum(remainder)} ؋`, '#dc2626', true)

  y += 16
  x.fillStyle = '#94a3b8'
  x.textAlign = 'center'
  x.font = '22px Vazirmatn, sans-serif'
  x.fillText('تشکر از خرید شما 🙏', W / 2, y)

  return c.toDataURL('image/png')
}

export default ReceiptModal
