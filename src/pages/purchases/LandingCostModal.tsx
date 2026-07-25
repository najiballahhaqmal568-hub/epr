import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { addLandingCost } from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/**
 * ثبت مصارف رسیدن بعد از تحویل جنس — یک یا چند خرید (یک حمل) انتخاب می‌شود
 * و مبلغ کل مساوی فی جوړه بین همه پخش می‌گردد.
 */
export function LandingCostModal({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<number[]>([])
  const [amountStr, setAmountStr] = useState('')
  const [via, setVia] = useState<'cash' | 'sarraf' | 'later'>('cash')
  const [sarrafId, setSarrafId] = useState<number | ''>('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')

  const purchases = useLiveQuery(
    () => db.purchases.orderBy('date').reverse().filter((p) => !p.deleted && p.received !== false).limit(30).toArray(),
    []
  )
  const sarrafs = useLiveQuery(() => db.suppliers.filter((s) => !s.deleted && s.kind === 'sarraf').toArray(), [])

  const chosen = (purchases ?? []).filter((p) => picked.includes(p.id!))
  const totalPairs = chosen.reduce((s, p) => s + p.lines.reduce((a, l) => a + l.qty, 0), 0)
  const amount = Math.max(0, parseNum(amountStr))
  const perPair = amount > 0 && totalPairs > 0 ? amount / totalPairs : 0

  async function save() {
    if (!picked.length) return setError('حداقل یک خرید را انتخاب کنید')
    if (amount <= 0) return setError('مبلغ مصارف را بنویسید')
    if (via === 'sarraf' && !sarrafId) return setError('صراف را انتخاب کنید')
    const sf = sarrafs?.find((s) => s.id === sarrafId)
    try {
      await addLandingCost(picked, amount, via, sf ? { id: sf.id!, name: sf.name } : undefined)
      setDone(`✅ ${fmtMoney(amount)} مصارف رسیدن ثبت شد — روی هر جوړه ${fmtMoney(perPair)}`)
      setPicked([])
      setAmountStr('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="🚚 ثبت مصارف رسیدن" onClose={onClose}>
      <p className="mb-2 text-xs text-slate-500">
        بعد از تحویل جنس، وقتی کرایه و حمالی و کمیشن معلوم شد، خریدهای همان حمل را انتخاب کنید و مجموع مصارف را بنویسید.
      </p>
      <p className="mb-1 text-sm font-bold text-slate-700">خریدهای این حمل ({fmtNum(picked.length)} انتخاب‌شده)</p>
      <div className="mb-3 max-h-60 overflow-y-auto">
        {purchases?.length === 0 && <p className="text-sm text-slate-400">خرید تحویل‌شده‌ای نیست.</p>}
        {purchases?.map((p) => {
          const pairs = p.lines.reduce((a, l) => a + l.qty, 0)
          const on = picked.includes(p.id!)
          return (
            <button
              key={p.id}
              onClick={() => setPicked((ps) => (on ? ps.filter((x) => x !== p.id) : [...ps, p.id!]))}
              className={`mb-1 flex w-full items-center justify-between rounded-xl p-2.5 text-right ${on ? 'bg-amber-100' : 'bg-slate-50'}`}
            >
              <span className="text-sm">
                <b>{on ? '✓ ' : ''}{p.supplierName}</b>
                <span className="block text-xs text-slate-500">
                  {fmtDate(p.date)} · {fmtNum(pairs)} جوړه · {fmtMoney(p.total)}
                </span>
                {(p.landingCost ?? 0) > 0 && (
                  <span className="block text-xs text-amber-600">مصارف قبلی: {fmtMoney(p.landingCost!)}</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <Field label="مجموع مصارف رسیدن (کرایه + حمالی + کمیشن) *">
        <input className={inputCls} inputMode="numeric" value={amountStr} onChange={(e) => setAmountStr(e.target.value)} />
      </Field>
      {amount > 0 && totalPairs > 0 && (
        <p className="-mt-2 mb-3 text-xs text-slate-600">
          {fmtNum(totalPairs)} جوړه در این حمل ← روی هر جوړه <b>{fmtMoney(perPair)}</b> اضافه می‌شود (قیمت تمام‌شده).
        </p>
      )}
      <Field label="پرداخت">
        <select className={inputCls} value={via} onChange={(e) => setVia(e.target.value as 'cash' | 'sarraf' | 'later')}>
          <option value="cash">نقد از صندوق (حالا)</option>
          <option value="sarraf">به قرض صراف (کمیشن)</option>
          <option value="later">بعداً پرداخت می‌شود</option>
        </select>
      </Field>
      {via === 'sarraf' && (
        <Field label="کدام صراف؟ *">
          <select className={inputCls} value={sarrafId} onChange={(e) => setSarrafId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">انتخاب کنید...</option>
            {sarrafs?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {done && <p className="mb-2 text-sm font-bold text-teal-700">{done}</p>}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={!picked.length || amount <= 0}>
        ثبت مصارف رسیدن
      </PrimaryBtn>
    </Modal>
  )
}

export default LandingCostModal
