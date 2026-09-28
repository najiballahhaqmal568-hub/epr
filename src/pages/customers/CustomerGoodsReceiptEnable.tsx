import { useState } from 'react'
import { accessFlags, db } from '../../db'
import { Modal, PrimaryBtn } from '../../components/ui'

export default function CustomerGoodsReceiptEnable({ onClose, onEnabled }: { onClose: () => void; onEnabled: () => void }) {
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function enable() {
    if (!checked || busy || accessFlags.readOnly) return
    setBusy(true)
    try {
      const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
      if (profile?.role !== 'owner') throw new Error('فقط مالک می‌تواند دریافت جنس بابت طلب را فعال کند.')
      await db.settings.put({ key: 'goodsReceiptCompatibilityAcknowledged', value: true })
      onEnabled()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  return <Modal title="فعال‌سازی دریافت جنس بابت طلب" onClose={() => { if (!busy) onClose() }}>
    <p className="mb-3 text-sm text-slate-700">پیش از ثبت، اپ را در همهٔ دستگاه‌های فعال دکان به‌روز کنید. نسخهٔ قدیمی ممکن است این دریافت، فروش بعدی یا اصلاح آن را ناقص حساب کند.</p>
    <p className="mb-3 text-sm text-amber-800">این تأیید فقط در همین دستگاه ذخیره می‌شود و در بکاپ نمی‌رود. سرور نسخهٔ دستگاه‌های دیگر را تضمین نمی‌کند؛ هر دریافت را پس از همگام‌سازی در یک دستگاه اصلاح کنید.</p>
    <label className="mb-4 flex items-start gap-2 text-sm"><input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} /> همهٔ دستگاه‌های فعال را به‌روز کردم</label>
    {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
    <PrimaryBtn disabled={!checked || busy} onClick={() => void enable()}>{busy ? 'در حال فعال‌سازی…' : 'فعال‌سازی در این دستگاه'}</PrimaryBtn>
  </Modal>
}
