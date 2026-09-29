import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { Modal, Skeleton } from '../../components/ui'
import { fmtMoney, fmtNum } from '../../lib/format'
import { explainCash, explainPayables, explainReceivables, explainStock, type SourceRow } from '../../lib/numberSources'

export type ExplainKind = 'receivables' | 'cash' | 'stock' | 'payables' | 'loans'

const TITLES: Record<ExplainKind, string> = {
  receivables: 'طلب از مشتریان از کجا آمد',
  cash: 'صندوق از کجا آمد',
  stock: 'موجودی گدام از کجا آمد',
  payables: 'قرض ما از کجا آمد',
  loans: 'قرض از اشخاص از کجا آمد'
}
const GO: Record<ExplainKind, { target: string; label: string }> = {
  receivables: { target: 'accounts', label: 'دیدن حساب‌ها' },
  cash: { target: 'expenses', label: 'دیدن صندوق و حرکت‌ها' },
  stock: { target: 'inventory', label: 'دیدن گدام' },
  payables: { target: 'accounts', label: 'دیدن حساب‌ها' },
  loans: { target: 'accounts', label: 'دیدن حساب‌ها' }
}

function Rows({ rows, pairs, showValue }: { rows: SourceRow[]; pairs?: boolean; showValue?: boolean }) {
  return <div className="explain-rows">
    {rows.map(row => <div key={row.key} className="explain-row">
      <span className="min-w-0">{row.label}{row.note && <small>{row.note}</small>}</span>
      <span className="explain-amount">
        {pairs ? `${fmtNum(row.amount)} جوړه` : fmtMoney(row.amount)}
        {showValue && row.value !== undefined && <small>{fmtMoney(row.value)}</small>}
      </span>
    </div>)}
  </div>
}

/** «این عدد از کجا آمد؟» برای کارت‌های خلاصهٔ حساب — همان قاعدهٔ lib/networth.ts. */
export default function ExplainModal({ kind, isStaff, onClose, goTo }: { kind: ExplainKind; isStaff?: boolean; onClose: () => void; goTo: (target: string) => void }) {
  const data = useLiveQuery(async () => {
    const [customers, suppliers, movements, products, variants] = await Promise.all([
      db.customers.toArray(), db.suppliers.toArray(), db.cashMovements.toArray(), db.products.toArray(), db.variants.toArray()
    ])
    return { customers, suppliers, movements, products, variants }
  }, [])
  const go = () => { onClose(); goTo(GO[kind].target) }
  return <Modal title={TITLES[kind]} onClose={onClose}>
    {!data && <Skeleton rows={4} />}
    {data && kind === 'receivables' && (() => {
      const e = explainReceivables(data.customers)
      return <>
        <p className="explain-total">مجموع: <strong>{fmtMoney(e.total)}</strong> — {fmtNum(e.rows.length)} مشتری قرضدار</p>
        {e.rows.length === 0 ? <p className="text-sm text-slate-500">هیچ مشتری قرضدار نیست.</p> : <Rows rows={e.rows} />}
        <p className="explain-note">پیشکی مشتریان (طلب آن‌ها از ما) در این عدد نیست.</p>
      </>
    })()}
    {data && kind === 'cash' && (() => {
      const e = explainCash(data.movements)
      return <>
        <p className="explain-total">مجموع همهٔ جاها: <strong>{fmtMoney(e.total)}</strong></p>
        <Rows rows={e.rows} />
        <p className="explain-note">هر جا جمع ورود و خروج پول همان جاست. برای دیدن هر حرکت، صندوق را باز کنید.</p>
      </>
    })()}
    {data && kind === 'stock' && (() => {
      const e = explainStock(data.products, data.variants)
      return <>
        <p className="explain-total">مجموع: <strong>{fmtNum(e.total)} جوړه</strong>{!isStaff && <> · ارزش خرید {fmtMoney(e.value)}</>}</p>
        {e.rows.length === 0 ? <p className="text-sm text-slate-500">گدام خالی است.</p> : <Rows rows={e.rows} pairs showValue={!isStaff} />}
        {!isStaff && <p className="explain-note">ارزش به قیمت تمام‌شده (با مصارف رسیدن) حساب شده است.</p>}
      </>
    })()}
    {data && kind === 'payables' && (() => {
      const e = explainPayables(data.suppliers)
      return <>
        <p className="explain-total">مجموع: <strong>{fmtMoney(e.total)}</strong> — به تأمین‌کنندگان و صراف‌ها</p>
        {e.rows.length === 0 ? <p className="text-sm text-slate-500">به تأمین‌کننده یا صراف قرضدار نیستید.</p> : <Rows rows={e.rows} />}
        {e.loans.total > 0 && <>
          <p className="explain-total mt-4">جدا از این عدد — قرض از اشخاص: <strong>{fmtMoney(e.loans.total)}</strong></p>
          <Rows rows={e.loans.rows} />
        </>}
        <p className="explain-note">شرکا قرض نیستند و اینجا نمی‌آیند.</p>
      </>
    })()}
    {data && kind === 'loans' && (() => {
      const e = explainPayables(data.suppliers).loans
      return <>
        <p className="explain-total">مجموع: <strong>{fmtMoney(e.total)}</strong> — از اشخاص</p>
        {e.rows.length === 0 ? <p className="text-sm text-slate-500">از هیچ شخصی قرض نگرفته‌اید.</p> : <Rows rows={e.rows} />}
        <p className="explain-note">قرض تأمین‌کنندگان و صراف‌ها جدا حساب می‌شود؛ شرکا قرض نیستند.</p>
      </>
    })()}
    <button className="primary-button mt-4" onClick={go}>{GO[kind].label}</button>
  </Modal>
}
