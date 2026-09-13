import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../../db'
import { Field, inputCls } from '../../../components/ui'
import { boxBalances } from '../../../lib/ops'
import { fmtMoney } from '../../../lib/format'
import type { DirectPaymentRoute } from '../../../lib/directTradeTypes'
import { routeLabels, type PaymentDraft } from './directForm'

export default function DirectPaymentFields({ value, onChange, supplierId, route }: {
  value: PaymentDraft; onChange: (next: PaymentDraft) => void; supplierId?: number; route?: DirectPaymentRoute
}) {
  const sarrafs = useLiveQuery(() => db.suppliers.filter(s => !s.deleted && s.kind === 'sarraf' && s.id !== supplierId).toArray(), [supplierId])
  const balances = useLiveQuery(boxBalances, [])
  const change = (key: keyof Omit<PaymentDraft, 'ids'>, text: string) => onChange({ ...value, [key]: text })
  return <section aria-label="پرداخت‌های معامله" className="my-4 border-t border-slate-200 pt-3">
    <h3 className="mb-2 font-bold">پرداخت‌ها</h3>
    <p className="mb-3 text-xs text-slate-500">اگر پرداخت نشده، صفر بگذارید. پرداخت مستقیم مشتری صندوق را تغییر نمی‌دهد.</p>
    {(Object.keys(routeLabels) as DirectPaymentRoute[]).filter(key => !route || key === route).map(key => <Field key={key} label={routeLabels[key]}>
      <input className={inputCls} inputMode="numeric" value={value[key]} onChange={e => change(key, e.target.value)} />
    </Field>)}
    {(!route || route === 'supplierPayment') && <div className="grid grid-cols-1 gap-x-3 sm:grid-cols-2">
      <Field label="سهم صراف از پرداخت فروشنده"><input className={inputCls} inputMode="numeric" value={value.sarrafAmount} onChange={e => change('sarrafAmount', e.target.value)} /></Field>
      <Field label="صراف"><select className={inputCls} value={value.sarrafId} onChange={e => change('sarrafId', e.target.value)}><option value="">انتخاب صراف</option>{sarrafs?.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      {value.sarrafId && <p className="mb-3 text-xs text-slate-500 sm:col-span-2">طلب نزد صراف: {fmtMoney(Math.max(0, -(sarrafs?.find(s => s.id === Number(value.sarrafId))?.balance ?? 0)))}؛ نخست از همین طلب کم می‌شود.</p>}
    </div>}
    {route !== 'customerToSupplier' && <Field label="صندوق پرداخت"><select className={inputCls} value={value.box} onChange={e => change('box', e.target.value)}>{Array.from(new Set([value.box, ...(balances?.boxes.map(b => b.name) ?? [])])).map(box => <option key={box}>{box}</option>)}</select></Field>}
    <Field label="یادداشت پرداخت"><input className={inputCls} value={value.note} onChange={e => change('note', e.target.value)} /></Field>
  </section>
}
