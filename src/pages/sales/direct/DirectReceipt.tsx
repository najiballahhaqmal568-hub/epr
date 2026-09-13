import { useState } from 'react'
import { Modal, PrimaryBtn } from '../../../components/ui'
import { fmtDate, fmtMoney, fmtNum } from '../../../lib/format'
import { directReceiptModel } from '../../../lib/directTradeReports'
import type { DirectTradeState } from '../../../lib/directTradeState'

export default function DirectReceipt({ state, onClose }: { state: DirectTradeState; onClose: () => void }) {
  const [error, setError] = useState('')
  const model = directReceiptModel(state)
  const text = [`فروشگاه اتل — رسید فروش مستقیم`, model.customerName, fmtDate(model.date),
    ...model.lines.map(l => `${l.productName} ${l.size} ${l.color} — ${fmtNum(l.qty)} × ${fmtMoney(l.unitPrice)}`),
    `مجموع: ${fmtMoney(model.total)}`, `تسویه‌شده (نقد و مستقیم): ${fmtMoney(model.settled)}`, `باقی: ${fmtMoney(model.remaining)}`].join('\n')
  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: 'رسید فروش مستقیم', text })
      else { await navigator.clipboard.writeText(text); setError('رسید کاپی شد؛ در واتساپ بفرستید.') }
    } catch (e) { if (!(e instanceof DOMException && e.name === 'AbortError')) setError('اشتراک نشد؛ می‌توانید متن رسید را انتخاب و کاپی کنید.') }
  }
  return <Modal title="رسید مشتری" onClose={onClose}>
    <pre className="mb-4 whitespace-pre-wrap break-words font-sans text-sm leading-7" dir="rtl">{text}</pre>
    {error && <p role="status" className="mb-3 text-sm">{error}</p>}
    <PrimaryBtn onClick={() => void share()}>اشتراک / کاپی رسید</PrimaryBtn>
  </Modal>
}
