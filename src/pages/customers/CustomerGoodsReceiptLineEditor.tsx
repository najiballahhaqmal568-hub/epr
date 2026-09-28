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

export type GoodsReceiptLineErrors = Partial<Record<'productName' | 'size' | 'color' | 'qty' | 'unitCost' | 'unitPrice', string>>

function linkedError(id: string, message?: string) {
  return message ? <p id={id} className="mt-1 text-xs text-red-700">{message}</p> : null
}

export default function CustomerGoodsReceiptLineEditor({ line, index, destination, variants, canRemove, errors = {}, onChange, onRemove }: {
  line: GoodsReceiptDraftLine
  index: number
  destination: 'warehouse' | 'onward'
  variants: GoodsReceiptVariantOption[]
  canRemove: boolean
  errors?: GoodsReceiptLineErrors
  onChange: (line: GoodsReceiptDraftLine) => void
  onRemove: () => void
}) {
  const set = (key: keyof GoodsReceiptDraftLine, value: string | undefined) => onChange({ ...line, [key]: value })
  const errorId = (field: keyof GoodsReceiptLineErrors) => `goods-receipt-line-${index + 1}-${field}-error`
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
      <Field label="نام / مدل جنس *"><input aria-label={`نام جنس ${index + 1}`} className={inputCls} disabled={Boolean(line.variantUuid)} value={line.productName} aria-invalid={Boolean(errors.productName)} aria-describedby={errors.productName ? errorId('productName') : undefined} onChange={event => set('productName', event.target.value)} />{linkedError(errorId('productName'), errors.productName)}</Field>
      <Field label="سایز *"><input aria-label={`سایز ${index + 1}`} className={inputCls} disabled={Boolean(line.variantUuid)} value={line.size} aria-invalid={Boolean(errors.size)} aria-describedby={errors.size ? errorId('size') : undefined} onChange={event => set('size', event.target.value)} />{linkedError(errorId('size'), errors.size)}</Field>
      <Field label="رنگ *"><input aria-label={`رنگ ${index + 1}`} className={inputCls} disabled={Boolean(line.variantUuid)} value={line.color} aria-invalid={Boolean(errors.color)} aria-describedby={errors.color ? errorId('color') : undefined} onChange={event => set('color', event.target.value)} />{linkedError(errorId('color'), errors.color)}</Field>
      <Field label="تعداد جوره *"><input aria-label={`تعداد ${index + 1}`} className={inputCls} inputMode="numeric" value={line.qty} aria-invalid={Boolean(errors.qty)} aria-describedby={errors.qty ? errorId('qty') : undefined} onChange={event => set('qty', event.target.value)} />{linkedError(errorId('qty'), errors.qty)}</Field>
      <Field label="قیمت توافقی فی جوره *"><input aria-label={`قیمت توافقی ${index + 1}`} className={inputCls} inputMode="numeric" value={line.unitCost} aria-invalid={Boolean(errors.unitCost)} aria-describedby={errors.unitCost ? errorId('unitCost') : undefined} onChange={event => set('unitCost', event.target.value)} />{linkedError(errorId('unitCost'), errors.unitCost)}</Field>
      {destination === 'onward' && <Field label="قیمت فروش فی جوره *"><input aria-label={`قیمت فروش ${index + 1}`} className={inputCls} inputMode="numeric" value={line.unitPrice} aria-invalid={Boolean(errors.unitPrice)} aria-describedby={errors.unitPrice ? errorId('unitPrice') : undefined} onChange={event => set('unitPrice', event.target.value)} />{linkedError(errorId('unitPrice'), errors.unitPrice)}</Field>}
    </div>
    {!line.variantUuid && <ProductPhotoPicker photo={line.photo} onChange={photo => set('photo', photo)} />}
    {canRemove && <button type="button" className="rounded-lg px-2 py-2 text-sm font-bold text-red-700" onClick={onRemove}>حذف این جنس</button>}
  </section>
}
