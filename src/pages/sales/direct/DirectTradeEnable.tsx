import { useState } from 'react'
import { accessFlags, db } from '../../../db'
import { Modal, PrimaryBtn } from '../../../components/ui'

export default function DirectTradeEnable({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  async function enable() {
    if (!checked || saving || accessFlags.readOnly) return
    setSaving(true)
    try {
      const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
      if (profile?.role === 'staff' || profile?.role === 'viewer') throw new Error('فقط مالک می‌تواند فروش مستقیم را فعال کند.')
      await db.settings.put({ key: 'directTrades.enabled', value: true })
      onEnabled()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setSaving(false) }
  }
  return <Modal title="فعال‌سازی فروش مستقیم" onClose={() => { if (!saving) onClose() }}>
    <p className="mb-3">نسخهٔ direct-sales-v1: پیش از ثبت، اپ را در تمام موبایل‌ها و کمپیوترهای دکان تازه‌سازی کنید. نسخهٔ قدیمی این معامله را درست حساب نمی‌کند.</p>
    <p className="mb-3 text-sm text-amber-800">داده‌ها را پاک نکنید و بکاپ را دوباره وارد نکنید. این تأیید دستی است؛ سرور نسخهٔ دستگاه‌های دیگر را تضمین نمی‌کند.</p>
    <label className="mb-4 block"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> همهٔ دستگاه‌های فعال را به این نسخه به‌روز کردم</label>
    {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
    <PrimaryBtn disabled={!checked || saving} onClick={() => void enable()}>فعال‌سازی در این دستگاه</PrimaryBtn>
  </Modal>
}
