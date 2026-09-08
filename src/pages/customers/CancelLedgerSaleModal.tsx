import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { accessFlags } from '../../db'
import { ledgerSaleCancellationPreview, cancelLedgerSale } from '../../lib/ledgerSaleCancellation'
import { fmtMoney, fmtNum, fmtDate } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

export default function CancelLedgerSaleModal({ saleId, customerId, onClose }: { saleId: number; customerId: number; onClose: () => void }) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const result = useLiveQuery(async () => {
    try { return { data: await ledgerSaleCancellationPreview(saleId, customerId), error: '' } }
    catch (e) { return { data: undefined, error: e instanceof Error ? e.message : String(e) } }
  }, [saleId, customerId])
  const data = result?.data
  async function save() {
    if (busy.current || !data || !reason.trim()) return
    busy.current = true; setSaving(true); setError('')
    try { await cancelLedgerSale(saleId, customerId, reason, data); onClose() }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { busy.current = false; setSaving(false) }
  }
  return <Modal title="ابطال همین فروش" onClose={() => { if (!busy.current) onClose() }}>
    {!result && <p role="status">در حال بررسی سند…</p>}
    {result?.error && <p role="alert" className="mb-3 text-red-700">{result.error}</p>}
    {data && <>
      <p className="font-bold">{data.sale.customerName} — {fmtMoney(data.sale.total)}</p>
      <p className="mb-3 text-sm text-slate-500">{fmtDate(data.sale.date)}</p>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
        {data.stock.map((line, i) => <p key={i} className="mb-2">برگشت به گدام: {line.productName} {line.size} {line.color} — {fmtNum(line.qty)} جوړه</p>)}
        <p>قرض مشتری قبل: {fmtMoney(data.debtBefore)}</p>
        <p>قرض مشتری بعد: {fmtMoney(data.debtAfter)}</p>
        <p>صندوق «{data.cash.box}»: {fmtMoney(data.cash.before)} ← {fmtMoney(data.cash.after)}</p>
        {data.cash.after < 0 && <p role="alert" className="text-red-700">هشدار: با ابطال، صندوق منفی می‌شود.</p>}
      </div>
      <p className="mb-3 text-sm text-slate-600">فقط این فروش باطل می‌شود؛ قرض قبلی و دریافت‌های جداگانه باقی می‌مانند. اثر فروش بر مفاد نیز برمی‌گردد. سند با دلیل ابطال برای رد حساب محفوظ می‌ماند.</p>
      <Field label="دلیل ابطال"><input className={inputCls} value={reason} disabled={saving} onChange={e => setReason(e.target.value)} /></Field>
      <PrimaryBtn disabled={!reason.trim() || saving || accessFlags.readOnly} onClick={() => void save()}>{saving ? 'در حال ابطال…' : 'تأیید ابطال همین فروش'}</PrimaryBtn>
    </>}
    {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    <button disabled={saving} className="mt-3 w-full rounded-lg bg-slate-100 p-3" onClick={onClose}>انصراف</button>
  </Modal>
}
