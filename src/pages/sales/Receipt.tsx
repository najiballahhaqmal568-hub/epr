import { useState, useEffect } from 'react'
import { saleCashPaid, type Sale } from '../../db'
import { saleCustomerCredit, saleSettledByAccount } from '../../lib/salesFigures'
import { fmtNum, fmtDate } from '../../lib/format'
import { Modal } from '../../components/ui'
import { commercialSaleLines } from '../../lib/commercialLines'

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
    <Modal title="رسید فروش" onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">رسید مشتری · آماده برای ذخیره یا اشتراک</p>
      {img ? <img src={img} alt="رسید" className="sale-receipt-image" /> : <p role="status" className="py-8 text-center text-slate-500">در حال ساخت رسید...</p>}
      {msg && <p role="status" className="mb-3 text-sm font-bold text-slate-700">{msg}</p>}
      <div className="sale-document-actions">
        <button disabled={!img} onClick={() => void share()} className="primary-button">
          اشتراک (واتساپ/تلگرام)
        </button>
        <button onClick={onClose} className="sale-secondary-action">
          بستن
        </button>
      </div>
      {/* در وقت شلوغ: مستقیم به فروش بعدی */}
      {onNext && (
        <button onClick={onNext} className="sale-secondary-action w-full">
          فروش بعدی
        </button>
      )}
    </Modal>
  )
}

function drawReceipt(sale: Sale): string {
  const lines = commercialSaleLines(sale)
  const W = 640
  const remainder = saleCustomerCredit(sale)
  const settled = saleSettledByAccount(sale)
  const discount = sale.discount ?? 0
  const subtotal = sale.total + discount
  const extraRows = (discount > 0 ? 1 : 0) + (remainder > 0 ? 1 : 0) + (settled > 0 ? 1 : 0)
  const code = (sale.uuid ?? '').replace(/-/g, '').slice(0, 6).toUpperCase()
  const PAD = 18 // light margin around the paper
  const TEETH = 14 // torn-paper edge at the bottom
  const H = 380 + lines.length * 80 + extraRows * 40 + 150 + (code ? 34 : 0)
  const c = document.createElement('canvas')
  c.width = W + PAD * 2
  c.height = H + PAD * 2 + TEETH
  const x = c.getContext('2d')!
  x.fillStyle = '#EDEDF0'
  x.fillRect(0, 0, c.width, c.height)
  x.translate(PAD, PAD)
  // paper with a zig-zag bottom edge
  x.fillStyle = '#ffffff'
  x.beginPath()
  x.moveTo(0, 0); x.lineTo(W, 0); x.lineTo(W, H)
  for (let tx = W; tx > 0; tx -= TEETH * 2) { x.lineTo(tx - TEETH, H + TEETH); x.lineTo(Math.max(0, tx - TEETH * 2), H) }
  x.closePath(); x.fill()
  x.direction = 'rtl'

  // سرصفحه: نشان «اتل»، نام دکان و تاریخ
  x.fillStyle = '#0066d6'
  x.fillRect(0, 0, W, 112)
  x.fillStyle = '#ffffff'
  x.beginPath(); x.arc(W - 70, 56, 36, 0, Math.PI * 2); x.fill()
  x.fillStyle = '#0066d6'
  x.textAlign = 'center'
  x.font = 'bold 26px Vazirmatn, sans-serif'
  x.fillText('اتل', W - 70, 66)
  x.fillStyle = '#ffffff'
  x.textAlign = 'right'
  x.font = 'bold 34px Vazirmatn, sans-serif'
  x.fillText('فروشگاه اتل', W - 124, 52)
  x.font = '21px Vazirmatn, sans-serif'
  x.fillText(`رسید فروش · ${fmtDate(sale.date)}`, W - 124, 88)

  let y = 156
  x.fillStyle = '#334155'
  x.textAlign = 'right'
  x.font = 'bold 24px Vazirmatn, sans-serif'
  x.fillText(`مشتری: ${sale.customerName || 'نقدی'}`, W - 30, y, W - 60)
  y += 32
  x.font = '22px Vazirmatn, sans-serif'
  x.fillText(sale.saleType === 'retail' ? 'پرچون' : 'عمده', W - 30, y)
  if (code) {
    y += 34
    x.fillStyle = '#63636d'
    x.fillText(`کد رسید: ${code}`, W - 30, y)
  }
  y += 24

  // خط جدا — نقطه‌چین مثل رسید کاغذی
  x.strokeStyle = '#c7c7cc'
  x.setLineDash([8, 6])
  x.beginPath(); x.moveTo(30, y); x.lineTo(W - 30, y); x.stroke()
  y += 36

  for (const l of lines) {
    x.fillStyle = '#0f172a'
    x.textAlign = 'right'
    x.font = '24px Vazirmatn, sans-serif'
    x.fillText(`${l.productName} ${l.size} ${l.color}`.replace(/\s+/g, ' '), W - 30, y, W - 60)
    y += 32
    x.fillStyle = '#334155'
    x.fillText(`${fmtNum(l.qty)} × ${fmtNum(l.unitPrice)} = ${fmtNum(l.qty * l.unitPrice)}`, W - 30, y, W - 60)
    y += 48
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
  row('قابل پرداخت', `${fmtNum(sale.total)} ؋`, '#1d1d1f', true)
  row('دریافتی', `${fmtNum(saleCashPaid(sale))} ؋`)
  if (settled > 0) row('تسویه با حساب (کفش)', `${fmtNum(settled)} ؋`)
  if (remainder > 0) row('باقی (قرض)', `${fmtNum(remainder)} ؋`, '#dc2626', true)

  x.beginPath(); x.moveTo(30, y - 8); x.lineTo(W - 30, y - 8); x.stroke()
  y += 30
  x.fillStyle = '#1d1d1f'
  x.textAlign = 'center'
  x.font = 'bold 24px Vazirmatn, sans-serif'
  x.fillText('تشکر از خرید شما 🙏', W / 2, y)
  y += 34
  x.fillStyle = '#63636d'
  x.font = '20px Vazirmatn, sans-serif'
  x.fillText(code ? 'برای مرجوعی یا تبادله، همین رسید را نشان دهید.' : 'فروشگاه اتل', W / 2, y)

  return c.toDataURL('image/png')
}

export default ReceiptModal
