import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, newUuid, type Customer } from '../../db'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'
import { fmtDate, fmtMoney, fmtNum, fromDateInput, toDateInput } from '../../lib/format'
import { createCustomerGoodsReceipt, correctCustomerGoodsReceipt, previewCustomerGoodsReceiptCorrection } from '../../lib/customerGoodsReceiptOps'
import type { CreateCustomerGoodsReceiptInput, CustomerGoodsReceiptPreview, CustomerGoodsReceiptState } from '../../lib/customerGoodsReceiptTypes'
import { syncNow } from '../../lib/sync'
import { numberInput } from '../sales/direct/directForm'
import CustomerModal from './CustomerModal'
import CustomerGoodsReceiptLineEditor, { type GoodsReceiptDraftLine, type GoodsReceiptLineErrors } from './CustomerGoodsReceiptLineEditor'

const blankLine = (): GoodsReceiptDraftLine => ({ lineUuid: newUuid(), variantUuid: '', productName: '', size: '', color: '', qty: '', unitCost: '', unitPrice: '' })
type DraftTotals = { value: number; pairs: number; sale: number; cash: number; buyerDebt: number; profit: number }

function signedMoney(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtMoney(Math.abs(value))}`
}
function signedPairs(value: number): string {
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${fmtNum(Math.abs(value))} جوره`
}
function fieldError(id: string, message?: string) {
  return message ? <p id={id} className="mt-1 text-xs text-red-700">{message}</p> : null
}

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
  const [correctionPreview, setCorrectionPreview] = useState<CustomerGoodsReceiptPreview>()
  const [previewReasons, setPreviewReasons] = useState<string[]>([])
  const [validationVisible, setValidationVisible] = useState(false)
  const [showBuyer, setShowBuyer] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const access = useLiveQuery(async () => {
    const profile = (await db.settings.get('cachedProfile'))?.value as { role?: string } | undefined
    return { role: profile?.role }
  }, [])
  const owner = access?.role === 'owner'
  const customers = useLiveQuery(() => db.customers.filter(row => !row.deleted && row.id !== customer.id).toArray(), [customer.id])
  const inventory = useLiveQuery(async () => {
    const [products, variants] = await Promise.all([db.products.filter(row => !row.deleted).toArray(), db.variants.filter(row => !row.deleted && Boolean(row.uuid)).toArray()])
    const names = new Map(products.map(product => [product.id!, product.name]))
    return variants.map(variant => ({ uuid: variant.uuid!, productName: names.get(variant.productId) ?? '', size: variant.size, color: variant.color,
      label: `${names.get(variant.productId) ?? ''} · ${variant.size} · ${variant.color} · موجود ${variant.stockQty}` }))
  }, [])
  const selectedBuyer = customers?.find(row => row.uuid === buyerUuid)

  function invalidate() { setConfirmed(false); setPreviewed(false); setPreviewToken(''); setCorrectionPreview(undefined); setPreviewReasons([]); setError('') }
  function validateDraft(): { summary?: DraftTotals; lineErrors: GoodsReceiptLineErrors[]; buyer?: string; paid?: string; reason?: string; date?: string; messages: string[] } {
    const lineErrors = lines.map(() => ({} as GoodsReceiptLineErrors))
    let value = 0, pairs = 0, sale = 0, amountsSafe = true, saleComplete = true
    lines.forEach((line, index) => {
      if (!line.productName.trim()) lineErrors[index].productName = 'نام یا مدل جنس را بنویسید.'
      if (!line.size.trim()) lineErrors[index].size = 'سایز را بنویسید.'
      if (!line.color.trim()) lineErrors[index].color = 'رنگ را بنویسید.'
      const qty = numberInput(line.qty)
      const unitCost = numberInput(line.unitCost)
      const unitPrice = numberInput(line.unitPrice)
      if (!Number.isSafeInteger(qty) || qty <= 0) lineErrors[index].qty = 'تعداد باید عدد صحیح مثبت باشد؛ مانند ۲.'
      if (!Number.isSafeInteger(unitCost) || unitCost <= 0) lineErrors[index].unitCost = 'قیمت توافقی باید عدد صحیح مثبت باشد؛ مانند ۱۰۰۰.'
      if (destination === 'onward' && (!Number.isSafeInteger(unitPrice) || unitPrice <= 0)) {
        lineErrors[index].unitPrice = 'قیمت فروش باید عدد صحیح مثبت باشد؛ مانند ۱۳۰۰.'
        saleComplete = false
      }
      if (!lineErrors[index].qty && !lineErrors[index].unitCost) {
        pairs += qty
        value += qty * unitCost
      } else amountsSafe = false
      if (destination === 'onward' && !lineErrors[index].qty && !lineErrors[index].unitPrice) sale += qty * unitPrice
      if (![pairs, value, sale].every(Number.isSafeInteger)) {
        amountsSafe = false
        lineErrors[index].qty ??= 'این مقدار مجموع را از حد معتبر بیشتر می‌کند.'
      }
    })
    if (amountsSafe && value > Math.max(0, customer.balance) + (correction?.totals.value ?? 0)) {
      lineErrors[0].unitCost ??= 'ارزش مجموع جنس از طلب قابل تصفیه بیشتر است؛ تعداد یا قیمت توافقی را کم کنید.'
    }
    let buyer: string | undefined, paidError: string | undefined
    const cash = numberInput(paid)
    if (destination === 'onward') {
      if (!selectedBuyer) buyer = 'یک خریدار فعال و متفاوت را انتخاب کنید.'
      if (!Number.isSafeInteger(cash) || cash < 0) paidError = 'مبلغ نقد باید عدد صحیح صفر یا بیشتر باشد؛ مانند ۵۰۰.'
      else if (saleComplete && cash > sale) paidError = 'مبلغ نقد نمی‌تواند از مجموع فروش بیشتر باشد.'
    }
    const reasonError = correction && !reason.trim() ? 'دلیل اصلاح را بنویسید.' : undefined
    const dateError = !snapshot && !Number.isFinite(fromDateInput(date)) ? 'تاریخ معتبر را انتخاب کنید.' : undefined
    const messages = [...lineErrors.flatMap(row => Object.values(row)), buyer, paidError, reasonError, dateError]
      .filter((message): message is string => Boolean(message))
      .filter((message, index, all) => all.indexOf(message) === index)
    return { lineErrors, buyer, paid: paidError, reason: reasonError, date: dateError, messages,
      ...(messages.length === 0 ? { summary: { value, pairs, sale, cash: destination === 'onward' ? cash : 0, buyerDebt: destination === 'onward' ? sale - cash : 0, profit: destination === 'onward' ? sale - value : 0 } } : {}) }
  }
  const validation = validateDraft()
  const summary = validation.summary
  function input(): CreateCustomerGoodsReceiptInput {
    if (!summary) throw new Error('معلومات نادرست فرم را اصلاح کنید.')
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

  async function preview() {
    setValidationVisible(true)
    setError(''); setPreviewReasons([])
    if (!summary) return
    try {
      if (correction) {
        await syncBeforeMutation()
        const result = await previewCustomerGoodsReceiptCorrection(correction.receiptUuid, input())
        setCorrectionPreview(result)
        if (!result.allowed) { setPreviewReasons(result.writeBlockReasons); setPreviewed(true); return }
        setPreviewToken(result.token)
      }
      setPreviewed(true)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }
  async function save() {
    if (!previewed || !confirmed || busy.current || accessFlags.readOnly || !owner) return
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
    } catch (caught) { setConfirmed(false); setPreviewed(false); setPreviewToken(''); setCorrectionPreview(undefined); setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title={correction ? 'اصلاح دریافت جنس' : 'دریافت جنس بابت طلب'} onClose={() => { if (!busy.current && confirm('فرم ثبت‌نشده بسته شود؟')) onClose() }}>
    <p className="mb-3 text-sm text-slate-600">مشتری: <strong>{customer.name}</strong> · طلب فعلی: <strong>{fmtMoney(Math.max(0, customer.balance))}</strong></p>
    {correction && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900">در اصلاح، تاریخ ({fmtDate(snapshot!.date)})، مشتری، مقصد، خریدار و صندوق قفل است. برای تغییر آنها سند را باطل و دوباره ثبت کنید.</p>}
    {access !== undefined && !owner && <p role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">دسترسی مالک برای ثبت این دریافت لازم است.</p>}
    <fieldset disabled={saving || !owner} className="min-w-0">
      {!correction && <><Field label="تاریخ دریافت *"><input aria-label="تاریخ دریافت" className={inputCls} type="date" value={date} aria-invalid={validationVisible && Boolean(validation.date)} aria-describedby={validationVisible && validation.date ? 'goods-receipt-date-error' : undefined} onChange={event => { invalidate(); setDate(event.target.value) }} />{validationVisible && fieldError('goods-receipt-date-error', validation.date)}</Field>
        <Field label="مقصد جنس *"><select aria-label="مقصد جنس" className={inputCls} value={destination} onChange={event => { invalidate(); setDestination(event.target.value as 'warehouse' | 'onward'); setLines([blankLine()]) }}><option value="warehouse">ورود به گدام</option><option value="onward">فروش مستقیم به مشتری دیگر — بدون گدام</option></select></Field></>}
      {lines.map((line, index) => <CustomerGoodsReceiptLineEditor key={line.lineUuid} line={line} index={index} destination={destination} variants={inventory ?? []} canRemove={lines.length > 1} errors={validationVisible ? validation.lineErrors[index] : undefined} onChange={next => { invalidate(); setLines(lines.map((row, i) => i === index ? next : row)) }} onRemove={() => { invalidate(); setLines(lines.filter((_, i) => i !== index)) }} />)}
      <button type="button" className="mb-4 w-full rounded-xl bg-slate-100 p-3 font-bold" onClick={() => { invalidate(); setLines([...lines, blankLine()]) }}>افزودن جنس دیگر</button>
      {destination === 'onward' && <section className="mb-3 rounded-xl bg-slate-50 p-3">
        <Field label="خریدار فروش بعدی *"><select aria-label="خریدار فروش بعدی" className={inputCls} disabled={Boolean(correction)} value={buyerUuid} aria-invalid={validationVisible && Boolean(validation.buyer)} aria-describedby={validationVisible && validation.buyer ? 'goods-receipt-buyer-error' : undefined} onChange={event => { invalidate(); setBuyerUuid(event.target.value) }}><option value="">انتخاب خریدار</option>{customers?.map(row => <option key={row.id} value={row.uuid}>{row.name}</option>)}</select>{validationVisible && fieldError('goods-receipt-buyer-error', validation.buyer)}</Field>
        {!correction && <button type="button" className="mb-3 text-sm font-bold text-teal-700" onClick={() => setShowBuyer(true)}>+ مشتری تازه</button>}
        <Field label="مبلغ نقد دریافت‌شده"><input aria-label="مبلغ نقد فروش بعدی" className={inputCls} inputMode="numeric" value={paid} aria-invalid={validationVisible && Boolean(validation.paid)} aria-describedby={validationVisible && validation.paid ? 'goods-receipt-paid-error' : undefined} onChange={event => { invalidate(); setPaid(event.target.value) }} />{validationVisible && fieldError('goods-receipt-paid-error', validation.paid)}</Field>
        <Field label="صندوق"><input aria-label="صندوق فروش بعدی" className={inputCls} disabled={Boolean(correction)} value={box} onChange={event => { invalidate(); setBox(event.target.value) }} /></Field>
      </section>}
      <Field label="یادداشت و جزئیات"><textarea aria-label="یادداشت دریافت" className={inputCls} value={note} onChange={event => { invalidate(); setNote(event.target.value) }} /></Field>
      {correction && <Field label="دلیل اصلاح *"><input aria-label="دلیل اصلاح" className={inputCls} value={reason} aria-invalid={validationVisible && Boolean(validation.reason)} aria-describedby={validationVisible && validation.reason ? 'goods-receipt-reason-error' : undefined} onChange={event => { invalidate(); setReason(event.target.value) }} />{validationVisible && fieldError('goods-receipt-reason-error', validation.reason)}</Field>}
      {validationVisible && validation.messages.length > 0 && <div role="alert" className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-800"><p className="font-bold">این موارد را اصلاح کنید:</p><ul className="mt-1 list-disc pr-5">{validation.messages.map(message => <li key={message}>{message}</li>)}</ul></div>}
      {summary && <section aria-live="polite" className="mb-3 rounded-xl bg-teal-50 p-3 text-sm">{correction && <p className="font-bold">مجموع‌های سند جایگزین:</p>}<p>ارزش توافقی: {fmtMoney(summary.value)} · {summary.pairs} جوره</p><p>طلب پس از دریافت: {fmtMoney(Math.max(0, customer.balance + (correction?.totals.value ?? 0) - summary.value))}</p>{destination === 'warehouse' ? <p>{correction ? `جوره‌های سند جایگزین: ${fmtNum(summary.pairs)}` : `موجودی گدام: +${fmtNum(summary.pairs)} جوره`}</p> : <><p>بدون ورود به گدام · فروش: {fmtMoney(summary.sale)}</p><p>نقد: {fmtMoney(summary.cash)} · قرض خریدار: {fmtMoney(summary.buyerDebt)}</p><p>مفاد: {fmtMoney(summary.profit)}</p></>}<p className="mt-1 text-xs">حساب قرض‌دهندگان/مالکان قبلی تغییر نمی‌کند.</p></section>}
      {correction && correctionPreview && previewed && previewReasons.length === 0 && <section aria-live="polite" className="mb-3 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900"><p className="font-bold">تغییر خالص نسبت به سند اصلی:</p><p>تغییر طلب مشتری منبع: {signedMoney(correctionPreview.net.sourceDebt)}</p><p>تغییر موجودی گدام: {signedPairs(correctionPreview.net.stock)}</p><p>تغییر نقد: {signedMoney(correctionPreview.net.cash)}</p><p>تغییر طلب خریدار: {signedMoney(correctionPreview.net.buyerDebt)}</p><p>تغییر مفاد: {signedMoney(correctionPreview.net.profit)}</p></section>}
      {!previewed && <PrimaryBtn onClick={() => void preview()}>پیش‌نمایش و بررسی</PrimaryBtn>}
      {previewed && <><div role={previewReasons.length ? 'alert' : 'status'} className={`mb-3 rounded-xl p-3 text-sm ${previewReasons.length ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{previewReasons.length ? previewReasons.map((item, i) => <p key={i}>{item}</p>) : <p>پیش‌نمایش بررسی شد؛ معلومات را یک‌بار دیگر تأیید کنید.</p>}</div>
        {!previewReasons.length && <label className="mb-3 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> معلومات و اثر حسابی این سند را بررسی کردم</label>}
        <PrimaryBtn disabled={!confirmed || saving || !owner || previewReasons.length > 0} onClick={() => void save()}>{saving ? 'در حال ثبت…' : correction ? 'ثبت اصلاح' : 'ثبت دریافت'}</PrimaryBtn></>}
      {error && <p role="alert" className="mt-3 whitespace-pre-line text-sm text-red-700">{error}</p>}
    </fieldset>
    {showBuyer && <CustomerModal customer={null} defaultType="wholesale" onClose={() => setShowBuyer(false)} onCreated={created => {
      setShowBuyer(false)
      void db.customers.get(created.id!).then(saved => { if (saved?.uuid) { invalidate(); setBuyerUuid(saved.uuid) } })
    }} />}
  </Modal>
}
