import { useState, type Dispatch, type SetStateAction } from 'react'
import { accessFlags, type SaleLine, type Variant } from '../../db'
import { fmtMoney, fmtNum, toLatinDigits } from '../../lib/format'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'

/** Cart-only pricing. Resolve membership by product ID, never a display name. */
export default function BulkSalePrice({ lines, variants, setLines, disabled }: {
  lines: SaleLine[]; variants: Variant[]; setLines: Dispatch<SetStateAction<SaleLine[]>>; disabled: boolean
}) {
  const [selected, setSelected] = useState<number | null>(null)
  const [priceText, setPriceText] = useState('')
  const productOf = new Map(variants.map(v => [v.id, v.productId]))
  const groups = new Map<number, SaleLine[]>()
  for (const line of lines) {
    const productId = productOf.get(line.variantId)
    if (productId === undefined) continue
    groups.set(productId, [...(groups.get(productId) ?? []), line])
  }
  const chosen = selected === null ? [] : groups.get(selected) ?? []
  const normalized = toLatinDigits(priceText.trim())
  const price = /^\d+$/.test(normalized) ? Number(normalized) : NaN
  const valid = Number.isSafeInteger(price) && price > 0
  if (accessFlags.readOnly) return null
  return <>
    {[...groups].filter(([, rows]) => rows.length > 1).map(([id, rows]) => <button
      key={id} disabled={disabled}
      className="mb-2 w-full rounded-lg border border-teal-200 bg-teal-50 p-3 text-right text-sm font-bold text-teal-800 disabled:opacity-40"
      onClick={() => { setSelected(id); setPriceText(rows.every(l => l.unitPrice === rows[0].unitPrice) ? String(rows[0].unitPrice) : '') }}
    >تغییر قیمت همهٔ سایزهای {rows[0].productName}</button>)}
    {selected !== null && <Modal title="قیمت یکسان سایزها" onClose={() => setSelected(null)}>
      <p className="mb-3 font-bold">{chosen[0]?.productName}</p>
      <p className="mb-3 text-sm text-slate-600">روی تمام سایزها و رنگ‌های همین جنس که اکنون در سبد هستند اعمال می‌شود؛ قیمت گدام و فروش‌های قبلی تغییر نمی‌کند.</p>
      <p className="mb-3 text-sm">{chosen.map(l => `${l.size} ${l.color} ×${fmtNum(l.qty)}`).join('، ')}</p>
      <Field label="قیمت یکسان فی‌جوره (افغانی)"><input className={inputCls} inputMode="numeric" value={priceText} onChange={e => setPriceText(e.target.value)} disabled={disabled} /></Field>
      {priceText && !valid && <p role="alert" className="mb-3 text-sm text-red-700">قیمت را به عدد صحیح و بیشتر از صفر وارد کنید.</p>}
      {valid && <div aria-live="polite" className="mb-3 rounded-lg bg-slate-50 p-3 text-sm">
        <p>مجموع این جنس قبل: {fmtMoney(chosen.reduce((s,l) => s+l.qty*l.unitPrice,0))}</p>
        <p>مجموع این جنس بعد: {fmtMoney(chosen.reduce((s,l) => s+l.qty*price,0))}</p>
        <p>تخفیف فعلی فروش جداگانه باقی می‌ماند.</p>
      </div>}
      <PrimaryBtn disabled={disabled || !valid || !chosen.length} onClick={() => {
        if (disabled || accessFlags.readOnly || !valid || !chosen.length) return
        setLines(current => current.map(line => productOf.get(line.variantId) === selected ? {...line,unitPrice:price} : line))
        setSelected(null)
      }}>اعمال به سایزهای این جنس</PrimaryBtn>
      <button className="mt-3 w-full rounded-lg bg-slate-100 p-3" onClick={() => setSelected(null)}>انصراف</button>
    </Modal>}
  </>
}
