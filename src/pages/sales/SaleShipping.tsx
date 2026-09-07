import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags, db, type Payment, type Sale } from '../../db'
import { addSaleShipping, boxBalances, boxOf, cancelSaleShipping, correctSaleShipping } from '../../lib/ops'
import { calculateShipping } from '../../lib/shipping'
import { fmtDate, fmtMoney, fromDateInput, toDateInput, toLatinDigits } from '../../lib/format'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'

export default function SaleShipping({ sale }: { sale: Sale }) {
  const rows = useLiveQuery(() => db.payments.filter(p => !p.deleted && p.shipping?.saleUuid === sale.uuid).toArray(), [sale.uuid])
  const [editing, setEditing] = useState<Payment | 'new' | null>(null)
  const [cancelling, setCancelling] = useState<Payment | null>(null)
  if (sale.saleType !== 'wholesale' || !sale.customerId || !sale.uuid) return null
  return <section className="my-4 border-t border-slate-200 pt-4" aria-label="کرایهٔ بار">
    <h3 className="mb-2 font-bold">کرایهٔ بار</h3>
    {rows === undefined ? <p role="status">در حال بارگذاری…</p> : rows.length === 0 ? <p className="mb-2 text-sm text-slate-500">هنوز کرایه‌ای ثبت نشده است.</p> : rows.map(p => <div key={p.uuid} className="mb-3 rounded-xl border border-slate-200 p-3 text-sm">
      <p className="font-bold">کرایه: {fmtMoney(p.shipping!.total)}</p>
      <p>سهم مشتری: {fmtMoney(p.shipping!.customerShare)} · سهم دکان: {fmtMoney(p.shipping!.total - p.shipping!.customerShare)}</p>
      <p>دریافت نقدی کرایه: {fmtMoney(p.shipping!.received)} · قرض کرایه: {fmtMoney(-p.amount)}</p>
      <p className="mt-1 text-xs text-slate-500">{fmtDate(p.date)} · {boxOf(p)}{p.note ? ` · ${p.note}` : ''}</p>
      {p.correctionReason && <p className="mt-1 text-amber-800">اصلاح: {p.correctionReason}</p>}
      {!accessFlags.readOnly && <div className="mt-2 flex gap-2">
        <button className="flex-1 rounded-lg bg-slate-100 p-3" onClick={() => setEditing(p)}>اصلاح کرایه</button>
        <button className="flex-1 rounded-lg bg-red-50 p-3 text-red-700" onClick={() => setCancelling(p)}>لغو کرایه</button>
      </div>}
    </div>)}
    {!accessFlags.readOnly && <button className="w-full rounded-xl bg-teal-50 p-3 font-bold text-teal-800" onClick={() => setEditing('new')}>ثبت کرایهٔ بار</button>}
    {editing && <ShippingEditor sale={sale} current={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    {cancelling && <ShippingCancellation payment={cancelling} onClose={() => setCancelling(null)} />}
  </section>
}

/** Reject partial numeric strings rather than treating malformed text as zero. */
function money(value: string): number {
  const normalized = toLatinDigits(value).replace(/[,،]/g, '').trim()
  return /^(?:\d+\.?\d*|\.\d+)$/.test(normalized) ? Number(normalized) : NaN
}

function ShippingEditor({ sale, current, onClose }: { sale: Sale; current?: Payment; onClose: () => void }) {
  const old = current?.shipping
  const [total, setTotal] = useState(old ? String(old.total) : '')
  const [mode, setMode] = useState(old ? (old.customerShare === old.total ? 'customer' : old.customerShare === 0 ? 'shop' : 'split') : 'customer')
  const [share, setShare] = useState(String(old?.customerShare ?? 0))
  const [received, setReceived] = useState(String(old?.received ?? 0))
  const [box, setBox] = useState(boxOf(current ?? {}))
  const [date, setDate] = useState(toDateInput(current?.date ?? Date.now()))
  const [note, setNote] = useState(current?.note ?? '')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const balances = useLiveQuery(() => boxBalances(), [])
  const customer = useLiveQuery(() => db.customers.get(sale.customerId!), [sale.customerId])
  let calculated: ReturnType<typeof calculateShipping> | undefined
  let invalid = ''
  try { calculated = calculateShipping({ total: money(total), customerShare: mode === 'customer' ? money(total) : mode === 'shop' ? 0 : money(share), received: money(received) }) }
  catch (e) { invalid = e instanceof Error ? e.message : String(e) }
  const cashPreview = balances?.boxes.filter(b => b.name === box || (current && b.name === boxOf(current))).map(b => ({
    ...b, after: b.balance - (current && b.name === boxOf(current) ? current.cashDelta ?? 0 : 0) + (b.name === box ? calculated?.cashDelta ?? 0 : 0)
  }))
  const valid = !!calculated && !!date && (!current || !!reason.trim()) && !!customer && !customer.deleted && !!cashPreview?.length && !cashPreview.some(b => b.after < 0)
  async function save() {
    if (!valid || !calculated || busy.current || accessFlags.readOnly) return
    busy.current = true; setSaving(true); setError('')
    try {
      const input = { ...calculated, date: fromDateInput(date), box, note }
      if (current) await correctSaleShipping(current.id!, { ...input, reason })
      else await addSaleShipping(sale.id!, input)
      onClose()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title={current ? 'اصلاح کرایهٔ بار' : 'ثبت کرایهٔ بار'} onClose={() => { if (!busy.current) onClose() }}>
    <p className="mb-3 text-sm text-slate-500">{sale.customerName} — جدا از مبلغ و پرداخت کفش</p>
    <fieldset disabled={saving} className="min-w-0">
      <Field label="کل کرایه (افغانی)"><input className={inputCls} inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></Field>
      <Field label="مسئول کرایه"><select aria-label="مسئول کرایه" className={inputCls} value={mode} onChange={e => { setMode(e.target.value); if (e.target.value === 'shop') setReceived('0') }}>
        <option value="customer">مشتری</option><option value="shop">دکان</option><option value="split">مشترک — مشتری و دکان</option>
      </select></Field>
      {mode === 'split' && <Field label="سهم مشتری (افغانی)"><input className={inputCls} inputMode="decimal" value={share} onChange={e => setShare(e.target.value)} /></Field>}
      <Field label="دریافت نقدی کرایه از مشتری"><input className={inputCls} inputMode="decimal" disabled={mode === 'shop'} value={received} onChange={e => setReceived(e.target.value)} /></Field>
      <Field label="صندوق کرایه"><select aria-label="صندوق کرایه" className={inputCls} value={box} onChange={e => setBox(e.target.value)}>{Array.from(new Set([box, ...(balances?.boxes.map(b => b.name) ?? [])])).map(name => <option key={name}>{name}</option>)}</select></Field>
      <Field label="تاریخ کرایه"><input className={inputCls} type="date" value={date} onChange={e => setDate(e.target.value)} /></Field>
      <Field label="یادداشت کرایه"><input className={inputCls} value={note} onChange={e => setNote(e.target.value)} /></Field>
      {current && <Field label="دلیل اصلاح"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>}
      {calculated && <div className="mb-3 rounded-xl bg-teal-50 p-3 text-sm" aria-live="polite">
        <p>قرض کرایه: {fmtMoney(calculated.customerDebt)}</p><p>مصرف دکان: {fmtMoney(calculated.shopExpense)}</p>
        {customer && <p>حساب مشتری: {fmtMoney(customer.balance)} ← {fmtMoney(customer.balance + (current?.amount ?? 0) + calculated.customerDebt)}</p>}
        {cashPreview?.map(b => <p key={b.name}>{b.name}: {fmtMoney(b.balance)} ← {fmtMoney(b.after)}</p>)}
        {cashPreview?.some(b => b.after < 0) && <p role="alert" className="text-red-700">موجودی صندوق کافی نیست.</p>}
      </div>}
      {total && invalid && <p role="alert" className="mb-3 text-sm text-red-700">{invalid}</p>}
      {error && <p role="alert" className="mb-3 text-sm text-red-700">{error}</p>}
      <PrimaryBtn onClick={() => void save()} disabled={!valid || saving}>{saving ? 'در حال ذخیره…' : current ? 'ذخیرهٔ اصلاح' : 'ذخیرهٔ کرایه'}</PrimaryBtn>
    </fieldset>
  </Modal>
}

function ShippingCancellation({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  async function cancel() {
    if (busy.current || !reason.trim() || accessFlags.readOnly) return
    busy.current = true; setSaving(true)
    try { await cancelSaleShipping(payment.id!, reason); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title="لغو ثبت اشتباه کرایه" onClose={() => { if (!busy.current) onClose() }}>
    <p className="mb-3 text-sm text-amber-800">فقط برای ثبت اشتباهی است؛ مرجوعی کفش به معنی برگشت کرایهٔ پرداخت‌شده به راننده نیست.</p>
    <div className="mb-3 text-sm"><p>برگشت به {boxOf(payment)}: {fmtMoney(-(payment.cashDelta ?? 0))}</p><p>کم‌شدن قرض مشتری: {fmtMoney(-payment.amount)}</p><p>برگشت مصرف دکان: {fmtMoney(payment.shipping!.total - payment.shipping!.customerShare)}</p></div>
    <fieldset disabled={saving} className="min-w-0">
      <Field label="دلیل لغو"><input className={inputCls} value={reason} onChange={e => setReason(e.target.value)} /></Field>
      {error && <p role="alert" className="mb-3 text-red-700">{error}</p>}
      <PrimaryBtn disabled={!reason.trim() || saving} onClick={() => void cancel()}>{saving ? 'در حال لغو…' : 'تأیید لغو کرایه'}</PrimaryBtn>
    </fieldset>
  </Modal>
}
