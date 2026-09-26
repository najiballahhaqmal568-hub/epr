import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, newUuid, type Customer } from '../../db'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'
import { fmtDate, fmtMoney, fromDateInput, toDateInput } from '../../lib/format'
import { createCustomerGoodsReceipt, correctCustomerGoodsReceipt, previewCustomerGoodsReceiptCorrection } from '../../lib/customerGoodsReceiptOps'
import type { CreateCustomerGoodsReceiptInput, CustomerGoodsReceiptState } from '../../lib/customerGoodsReceiptTypes'
import { syncNow } from '../../lib/sync'
import { numberInput } from '../sales/direct/directForm'
import CustomerModal from './CustomerModal'
import CustomerGoodsReceiptLineEditor, { type GoodsReceiptDraftLine } from './CustomerGoodsReceiptLineEditor'

const blankLine = (): GoodsReceiptDraftLine => ({ lineUuid: newUuid(), variantUuid: '', productName: '', size: '', color: '', qty: '', unitCost: '', unitPrice: '' })

export default function CustomerGoodsReceiptModal({ customer, onClose, onSaved, correction, syncBeforeMutation = () => syncNow(true) }: {
  customer: Customer
  onClose: () => void
  onSaved: (uuid: string) => void
  correction?: CustomerGoodsReceiptState
  syncBeforeMutation?: () => Promise<void>
}) {
  const snapshot = correction?.payment?.goodsReceipt?.snapshot
  const [receiptUuid] = useState(newUuid)
  const [destination, setDestination] = useState<'warehouse' | 'onward'>(snapshot?.destination ?? 'warehouse')
  const [date, setDate] = useState(toDateInput(snapshot?.date ?? Date.now()))
  const [note, setNote] = useState(snapshot?.note ?? '')
  const [lines, setLines] = useState<GoodsReceiptDraftLine[]>(() => snapshot?.lines.map(line => ({
    lineUuid: newUuid(), variantUuid: line.selectedVariantUuid ?? '', productName: line.productName, size: line.size, color: line.color,
    qty: String(line.qty), unitCost: String(line.unitCost), unitPrice: line.unitPrice === undefined ? '' : String(line.unitPrice), photo: line.photo
  })) ?? [blankLine()])
  const [buyerUuid, setBuyerUuid] = useState(snapshot?.onward?.buyerUuid ?? '')
  const [paid, setPaid] = useState(snapshot?.onward ? String(snapshot.onward.paid) : '0')
  const [box, setBox] = useState(snapshot?.onward?.box ?? 'دکان')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [previewed, setPreviewed] = useState(false)
  const [previewToken, setPreviewToken] = useState('')
  const [previewReasons, setPreviewReasons] = useState<string[]>([])
  const [showBuyer, setShowBuyer] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const customers = useLiveQuery(() => db.customers.filter(row => !row.deleted && row.id !== customer.id).toArray(), [customer.id])
  const inventory = useLiveQuery(async () => {
    const [products, variants] = await Promise.all([db.products.filter(row => !row.deleted).toArray(), db.variants.filter(row => !row.deleted && Boolean(row.uuid)).toArray()])
    const names = new Map(products.map(product => [product.id!, product.name]))
    return variants.map(variant => ({ uuid: variant.uuid!, productName: names.get(variant.productId) ?? '', size: variant.size, color: variant.color,
      label: `${names.get(variant.productId) ?? ''} · ${variant.size} · ${variant.color} · موجود ${variant.stockQty}` }))
  }, [])
  const selectedBuyer = customers?.find(row => row.uuid === buyerUuid)

  function invalidate() { setConfirmed(false); setPreviewed(false); setPreviewToken(''); setPreviewReasons([]); setError('') }
  function totals() {
    let value = 0, pairs = 0, sale = 0
    for (const line of lines) {
      const qty = numberInput(line.qty), unitCost = numberInput(line.unitCost), unitPrice = numberInput(line.unitPrice)
      if (!line.productName.trim() || !line.size.trim() || !line.color.trim() || !Number.isSafeInteger(qty) || qty <= 0 || !Number.isSafeInteger(unitCost) || unitCost <= 0 || (destination === 'onward' && (!Number.isSafeInteger(unitPrice) || unitPrice <= 0))) throw new Error('نام، سایز، رنگ، تعداد و قیمت هر جنس را کامل و با عدد صحیح بنویسید.')
      pairs += qty; value += qty * unitCost; if (destination === 'onward') sale += qty * unitPrice
      if (![pairs, value, sale].every(Number.isSafeInteger)) throw new Error('مجموع از حد معتبر بیشتر است.')
    }
    const cash = numberInput(paid)
    if (destination === 'onward' && (!selectedBuyer || !Number.isSafeInteger(cash) || cash < 0 || cash > sale)) throw new Error('خریدار و مبلغ نقد فروش بعدی را درست انتخاب کنید.')
    if (value > Math.max(0, customer.balance) + (correction?.totals.value ?? 0)) throw new Error('ارزش جنس از طلب قابل تصفیه بیشتر است.')
    return { value, pairs, sale, cash: destination === 'onward' ? cash : 0, buyerDebt: destination === 'onward' ? sale - cash : 0, profit: destination === 'onward' ? sale - value : 0 }
  }
  function input(): CreateCustomerGoodsReceiptInput {
    const dateValue = snapshot?.date ?? fromDateInput(date)
    if (!Number.isFinite(dateValue)) throw new Error('تاریخ معتبر را انتخاب کنید.')
    return { receiptUuid, date: dateValue, customerId: customer.id!, destination, note,
      lines: lines.map(line => {
        const selected = variantRows?.find(row => row.uuid === line.variantUuid)
        return { lineUuid: line.lineUuid, productName: line.productName.trim(), size: line.size.trim(), color: line.color.trim(), qty: numberInput(line.qty), unitCost: numberInput(line.unitCost),
          ...(line.photo ? { photo: line.photo } : {}), ...(selected?.id ? { variantId: selected.id } : {}),
          ...(destination === 'onward' ? { unitPrice: numberInput(line.unitPrice) } : {}) }
      }),
      ...(destination === 'onward' ? { onward: { buyerId: selectedBuyer!.id!, paid: numberInput(paid), box: box.trim() || 'دکان' } } : {}) }
  }
  const variantRows = useLiveQuery(() => db.variants.filter(row => !row.deleted && Boolean(row.uuid)).toArray(), [])
  let summary: ReturnType<typeof totals> | undefined
  try { summary = totals() } catch {}

  async function preview() {
    setError(''); setPreviewReasons([])
    try {
      totals()
      if (correction) {
        await syncBeforeMutation()
        const result = await previewCustomerGoodsReceiptCorrection(correction.receiptUuid, input())
        if (!result.allowed) { setPreviewReasons(result.writeBlockReasons); setPreviewed(true); return }
        setPreviewToken(result.token)
      }
      setPreviewed(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  async function save() {
    if (!previewed || !confirmed || busy.current || accessFlags.readOnly) return
    busy.current = true; setSaving(true); setError('')
    try {
      const draft = input()
      if (correction) {
        if (!reason.trim()) throw new Error('دلیل اصلاح را بنویسید.')
        if (!previewToken) throw new Error('پیش‌نمایش تازه بگیرید.')
        await syncBeforeMutation()
        await correctCustomerGoodsReceipt(correction.receiptUuid, draft, previewToken, reason.trim())
      } else await createCustomerGoodsReceipt(draft)
      onSaved(receiptUuid)
    } catch (caught) { setConfirmed(false); setPreviewed(false); setPreviewToken(''); setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title={correction ? 'اصلاح دریافت جنس' : 'دریافت جنس بابت طلب'} onClose={() => { if (!busy.current && confirm('فرم ثبت‌نشده بسته شود؟')) onClose() }}>
    <p className="mb-3 text-sm text-slate-600">مشتری: <strong>{customer.name}</strong> · طلب فعلی: <strong>{fmtMoney(Math.max(0, customer.balance))}</strong></p>
    {correction && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">در اصلاح، تاریخ ({fmtDate(snapshot!.date)})، مشتری، مقصد، خریدار و صندوق قفل است. برای تغییر آنها سند را باطل و دوباره ثبت کنید.</p>}
    <fieldset disabled={saving} className="min-w-0">
      {!correction && <><Field label="تاریخ دریافت *"><input aria-label="تاریخ دریافت" className={inputCls} type="date" value={date} onChange={event => { invalidate(); setDate(event.target.value) }} /></Field>
        <Field label="مقصد جنس *"><select aria-label="مقصد جنس" className={inputCls} value={destination} onChange={event => { invalidate(); setDestination(event.target.value as 'warehouse' | 'onward'); setLines([blankLine()]) }}><option value="warehouse">ورود به گدام</option><option value="onward">فروش مستقیم به مشتری دیگر — بدون گدام</option></select></Field></>}
      {lines.map((line, index) => <CustomerGoodsReceiptLineEditor key={line.lineUuid} line={line} index={index} destination={destination} variants={inventory ?? []} canRemove={lines.length > 1} onChange={next => { invalidate(); setLines(lines.map((row, i) => i === index ? next : row)) }} onRemove={() => { invalidate(); setLines(lines.filter((_, i) => i !== index)) }} />)}
      <button type="button" className="mb-4 w-full rounded-xl bg-slate-100 p-3 font-bold" onClick={() => { invalidate(); setLines([...lines, blankLine()]) }}>افزودن جنس دیگر</button>
      {destination === 'onward' && <section className="mb-3 rounded-xl bg-slate-50 p-3">
        <Field label="خریدار فروش بعدی *"><select aria-label="خریدار فروش بعدی" className={inputCls} disabled={Boolean(correction)} value={buyerUuid} onChange={event => { invalidate(); setBuyerUuid(event.target.value) }}><option value="">انتخاب خریدار</option>{customers?.map(row => <option key={row.id} value={row.uuid}>{row.name}</option>)}</select></Field>
        {!correction && <button type="button" className="mb-3 text-sm font-bold text-teal-700" onClick={() => setShowBuyer(true)}>+ مشتری تازه</button>}
        <Field label="مبلغ نقد دریافت‌شده"><input aria-label="مبلغ نقد فروش بعدی" className={inputCls} inputMode="numeric" value={paid} onChange={event => { invalidate(); setPaid(event.target.value) }} /></Field>
        <Field label="صندوق"><input aria-label="صندوق فروش بعدی" className={inputCls} disabled={Boolean(correction)} value={box} onChange={event => { invalidate(); setBox(event.target.value) }} /></Field>
      </section>}
      <Field label="یادداشت و جزئیات"><textarea aria-label="یادداشت دریافت" className={inputCls} value={note} onChange={event => { invalidate(); setNote(event.target.value) }} /></Field>
      {correction && <Field label="دلیل اصلاح *"><input aria-label="دلیل اصلاح" className={inputCls} value={reason} onChange={event => { invalidate(); setReason(event.target.value) }} /></Field>}
      {summary && <section aria-live="polite" className="mb-3 rounded-xl bg-teal-50 p-3 text-sm"><p>ارزش توافقی: {fmtMoney(summary.value)} · {summary.pairs} جوره</p><p>طلب پس از دریافت: {fmtMoney(Math.max(0, customer.balance + (correction?.totals.value ?? 0) - summary.value))}</p>{destination === 'warehouse' ? <p>موجودی گدام: +{summary.pairs} جوره</p> : <><p>بدون ورود به گدام · فروش: {fmtMoney(summary.sale)}</p><p>نقد: {fmtMoney(summary.cash)} · قرض خریدار: {fmtMoney(summary.buyerDebt)}</p><p>مفاد: {fmtMoney(summary.profit)}</p></>}<p className="mt-1 text-xs">حساب قرض‌دهندگان/مالکان قبلی تغییر نمی‌کند.</p></section>}
      {!previewed && <PrimaryBtn disabled={!summary || (correction && !reason.trim())} onClick={() => void preview()}>پیش‌نمایش و بررسی</PrimaryBtn>}
      {previewed && <><div role={previewReasons.length ? 'alert' : 'status'} className={`mb-3 rounded-xl p-3 text-sm ${previewReasons.length ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{previewReasons.length ? previewReasons.map((item, i) => <p key={i}>{item}</p>) : <p>پیش‌نمایش بررسی شد؛ معلومات را یک‌بار دیگر تأیید کنید.</p>}</div>
        {!previewReasons.length && <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> معلومات و اثر حسابی این سند را بررسی کردم</label>}
        <PrimaryBtn disabled={!confirmed || saving || previewReasons.length > 0} onClick={() => void save()}>{saving ? 'در حال ثبت…' : correction ? 'ثبت اصلاح' : 'ثبت دریافت'}</PrimaryBtn></>}
      {error && <p role="alert" className="mt-3 whitespace-pre-line text-sm text-red-700">{error}</p>}
    </fieldset>
    {showBuyer && <CustomerModal customer={null} defaultType="wholesale" onClose={() => setShowBuyer(false)} onCreated={created => {
      setShowBuyer(false)
      void db.customers.get(created.id!).then(saved => { if (saved?.uuid) { invalidate(); setBuyerUuid(saved.uuid) } })
    }} />}
  </Modal>
}
