import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { hashPin } from '../../components/PinLock'
import { Card, inputCls } from '../../components/ui'

export function PinCard() {
  const pinSet = useLiveQuery(async () => Boolean((await db.settings.get('pinHash'))?.value), [])
  const [editing, setEditing] = useState(false)
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')

  async function save() {
    const clean = pin.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    if (!/^\d{4}$/.test(clean)) return setMsg('کود باید ۴ رقم باشد')
    await db.settings.put({ key: 'pinHash', value: await hashPin(clean) })
    setPin('')
    setEditing(false)
    setMsg('✅ قفل فعال شد. دفعهٔ بعد که اپ باز شود کود پرسیده می‌شود.')
  }

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">قفل اپ (کود ۴ رقمی)</p>
      <p className="mb-3 text-sm text-slate-500">با فعال کردن قفل، هر بار که اپ باز می‌شود کود پرسیده می‌شود.</p>
      {!editing ? (
        <div className="flex gap-2">
          <button onClick={() => setEditing(true)} className="rounded-xl bg-teal-700 px-5 py-2 font-bold text-white">
            {pinSet ? 'تغییر کود' : 'فعال کردن قفل'}
          </button>
          {pinSet && (
            <button
              onClick={async () => {
                await db.settings.delete('pinHash')
                setMsg('قفل غیرفعال شد.')
              }}
              className="rounded-xl bg-slate-100 px-5 py-2 font-bold text-slate-600"
            >
              غیرفعال کردن
            </button>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <input
            className={inputCls}
            inputMode="numeric"
            maxLength={4}
            placeholder="کود ۴ رقمی"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
          <button onClick={save} className="whitespace-nowrap rounded-xl bg-teal-700 px-4 font-bold text-white">
            ذخیره
          </button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm">{msg}</p>}
    </Card>
  )
}

export default PinCard
