import { useLiveQuery } from 'dexie-react-hooks'
import { itemsLabel } from '../../lib/ledger'
import { db, type Customer } from '../../db'
import { fmtMoney, fmtDate } from '../../lib/format'
import { Modal } from '../../components/ui'

/** دفتر خانواده: قرض مجموعی + تاریخچهٔ همهٔ اعضا با جزئیات کامل */
export function FamilyDetail({
  family,
  members,
  onMember,
  onClose
}: {
  family: string
  members: Customer[]
  onMember: (c: Customer) => void
  onClose: () => void
}) {
  const ids = members.map((m) => m.id!)
  const nameOf = new Map(members.map((m) => [m.id!, m.name]))
  const sales = useLiveQuery(
    () => db.sales.filter((s) => !s.deleted && s.customerId !== undefined && ids.includes(s.customerId)).reverse().sortBy('date'),
    [family]
  )
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'customer' && ids.includes(p.partyId)).reverse().sortBy('date'),
    [family]
  )
  const famDebt = members.reduce((s, m) => s + Math.max(0, m.balance), 0)

  type Ev = { date: number; who: string; label: string; sub?: string; amount: number; red: boolean }
  const events: Ev[] = []
  sales?.forEach((s) => {
    const rem = s.total - s.paid
    events.push({
      date: s.date,
      who: nameOf.get(s.customerId!) ?? '',
      label: itemsLabel(s.lines),
      sub: `مجموع ${fmtMoney(s.total)} · نقد ${fmtMoney(s.paid)}`,
      amount: rem,
      red: rem > 0
    })
  })
  payments?.forEach((p) => {
    if (p.amount < 0) {
      events.push({ date: p.date, who: nameOf.get(p.partyId) ?? '', label: p.note ?? 'قرض قبلی', amount: -p.amount, red: true })
    } else {
      events.push({ date: p.date, who: nameOf.get(p.partyId) ?? '', label: 'دریافت پول', amount: p.amount, red: false })
    }
  })
  events.sort((a, b) => b.date - a.date)

  return (
    <Modal title={`👨‍👩‍👦 خانوادهٔ ${family}`} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">قرض مجموعی خانواده</p>
        <p className={`text-2xl font-bold ${famDebt > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(famDebt)}</p>
      </div>
      <p className="mb-1 text-sm font-bold text-slate-700">اعضا</p>
      <div className="mb-3">
        {members.map((m) => (
          <button
            key={m.id}
            onClick={() => onMember(m)}
            className="mb-1 flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-right active:bg-teal-50"
          >
            <span className="min-w-0">
              <span className="block font-bold text-slate-800">{m.name}</span>
              {/* کدام عضو در کدام صفحهٔ دفتر است — و کدام هنوز صفحه ندارد */}
              <span className={`block text-xs font-bold ${m.bookPage?.trim() ? 'text-slate-500' : 'text-amber-700'}`}>
                {m.bookPage?.trim() ? `📖 صفحهٔ ${m.bookPage.trim()}` : 'بی‌صفحه — در ویرایش بنویسید'}
              </span>
            </span>
            <span className={`text-sm font-bold ${m.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(Math.max(0, m.balance))}</span>
          </button>
        ))}
      </div>
      <p className="mb-1 text-sm font-bold text-slate-700">تاریخچهٔ خانواده (همه اعضا)</p>
      {events.length === 0 && <p className="text-sm text-slate-400">هنوز سندی ثبت نشده.</p>}
      <div className="max-h-80 overflow-y-auto">
        {events.map((e, i) => (
          <div key={i} className="border-b border-slate-100 py-2 text-sm last:border-0">
            <div className="flex items-center justify-between">
              <span className="font-bold text-slate-700">{e.who}</span>
              <span className={`font-bold ${e.red ? 'text-red-600' : 'text-teal-700'}`}>
                {e.red ? '+' : '−'}
                {fmtMoney(e.amount)}
              </span>
            </div>
            <p className="text-slate-600">{e.label}</p>
            {e.sub && <p className="text-xs text-slate-400">{e.sub}</p>}
            <p className="text-xs text-slate-400">{fmtDate(e.date)}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">قرمز = قرض زیاد شد · سبز = پرداخت</p>
    </Modal>
  )
}

export default FamilyDetail
