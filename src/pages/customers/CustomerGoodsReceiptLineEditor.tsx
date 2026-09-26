import { Field, inputCls } from '../../components/ui'
import ProductPhotoPicker from '../inventory/ProductPhotoPicker'

export interface GoodsReceiptDraftLine {
  lineUuid: string
  variantUuid: string
  productName: string
  size: string
  color: string
  qty: string
  unitCost: string
  unitPrice: string
  photo?: string
}

export interface GoodsReceiptVariantOption {
  uuid: string
  label: string
  productName: string
  size: string
  color: string
}

export default function CustomerGoodsReceiptLineEditor({ line, index, destination, variants, canRemove, onChange, onRemove }: {
  line: GoodsReceiptDraftLine
  index: number
  destination: 'warehouse' | 'onward'
  variants: GoodsReceiptVariantOption[]
  canRemove: boolean
  onChange: (line: GoodsReceiptDraftLine) => void
  onRemove: () => void
}) {
  const set = (key: keyof GoodsReceiptDraftLine, value: string | undefined) => onChange({ ...line, [key]: value })
  return <section className="mb-3 rounded-xl border border-slate-200 p-3" aria-label={`جنس ${index + 1}`}>
    {destination === 'warehouse' && <Field label="جنس موجود در گدام (اختیاری)">
      <select aria-label={`جنس موجود ${index + 1}`} className={inputCls} value={line.variantUuid} onChange={event => {
        const selected = variants.find(item => item.uuid === event.target.value)
        onChange(selected ? { ...line, variantUuid: selected.uuid, productName: selected.productName, size: selected.size, color: selected.color, photo: undefined } : { ...line, variantUuid: '' })
      }}>
        <option value="">جنس تازه — مشخصات را دستی بنویسید</option>
        {variants.map(item => <option key={item.uuid} value={item.uuid}>{item.label}</option>)}
      </select>
    </Field>}
    <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
      <Field label="نام / مدل جنس *"><input aria-label={`نام جنس ${index + 1}`} className={inputCls} disabled={Boolean(line.variantUuid)} value={line.productName} onChange={event => set('productName', event.target.value)} /></Field>
      <Field label="سایز *"><input aria-label={`سایز ${index + 1}`} className={inputCls} disabled={Boolean(line.variantUuid)} value={line.size} onChange={event => set('size', event.target.value)} /></Field>
      <Field label="رنگ *"><input aria-label={`رنگ ${index + 1}`} className={inputCls} disabled={Boolean(line.variantUuid)} value={line.color} onChange={event => set('color', event.target.value)} /></Field>
      <Field label="تعداد جوره *"><input aria-label={`تعداد ${index + 1}`} className={inputCls} inputMode="numeric" value={line.qty} onChange={event => set('qty', event.target.value)} /></Field>
      <Field label="قیمت توافقی فی جوره *"><input aria-label={`قیمت توافقی ${index + 1}`} className={inputCls} inputMode="numeric" value={line.unitCost} onChange={event => set('unitCost', event.target.value)} /></Field>
      {destination === 'onward' && <Field label="قیمت فروش فی جوره *"><input aria-label={`قیمت فروش ${index + 1}`} className={inputCls} inputMode="numeric" value={line.unitPrice} onChange={event => set('unitPrice', event.target.value)} /></Field>}
    </div>
    {!line.variantUuid && <ProductPhotoPicker photo={line.photo} onChange={photo => set('photo', photo)} />}
    {canRemove && <button type="button" className="rounded-lg px-2 py-2 text-sm font-bold text-red-700" onClick={onRemove}>حذف این جنس</button>}
  </section>
}
