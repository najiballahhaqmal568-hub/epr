import { useState } from 'react'
import { Modal } from '../../components/ui'
import { afn } from '../../lib/financialPosting'
import { fmtDateShort, fmtMoney, parseNum } from '../../lib/format'
import type { ProfitSummary } from '../../lib/profit'

function Line({ label, value, minus = false, strong = false }: { label: string; value: number; minus?: boolean; strong?: boolean }) {
  return <p className={`flex justify-between gap-3 py-0.5 ${strong ? 'mt-1 border-t border-slate-200 pt-1.5 font-bold' : ''}`}>
    <span>{label}</span><span className="whitespace-nowrap">{minus ? `−${fmtMoney(value)}` : fmtMoney(value)}</span>
  </p>
}

/** «مفاد خالص این ماه از کجا آمد» — همان عددهای lib/profit.ts که راپور هم می‌خواند. */
export default function MonthProfitModal({ current, previous, from, target, onTarget, onClose, goTo }: {
  current: ProfitSummary; previous: ProfitSummary; from: number; target: number; onTarget: (value: number) => void
  onClose: () => void; goTo: (target: string) => void
}) {
  const change = current.netProfit - previous.netProfit
  const [targetStr, setTargetStr] = useState(target > 0 ? String(target) : '')
  const typed = afn(parseNum(targetStr))
  return <Modal title="مفاد خالص این ماه از کجا آمد" onClose={onClose}>
    <p className="mb-3 text-sm text-slate-500">از {fmtDateShort(from)} تا امروز</p>
    <section aria-label="مفاد قدم‌به‌قدم" className="rounded-xl bg-slate-50 p-3 text-sm">
      <Line label="قیمت فروش اجناس" value={current.goodsValue} />
      <Line label="قیمت خرید همان اجناس" value={current.goodsCost} minus />
      {current.discounts > 0 && <Line label="تخفیف" value={current.discounts} minus />}
      {current.returnedProfit !== 0 && <Line label="مفاد جنس برگشتی" value={current.returnedProfit} minus />}
      <Line label="مفاد فروش" value={current.grossProfit} strong />
      <Line label="مصارف تجارت" value={current.businessExpenses} minus />
      <Line label="مفاد خالص" value={current.netProfit} strong />
    </section>
    {current.expenseCategories.length > 0 && <section aria-label="مصارف به تفکیک" className="mt-3">
      <p className="mb-1 font-bold">پول مصرف کجا رفت</p>
      <div className="explain-rows">
        {current.expenseCategories.map(c => <div key={c.name} className="explain-row"><span>{c.name}</span><span className="explain-amount">{fmtMoney(c.amount)}</span></div>)}
      </div>
    </section>}
    <section aria-label="مقایسه" className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
      <p>تا همین روز ماه گذشته: <b>{fmtMoney(previous.netProfit)}</b> (مصرف {fmtMoney(previous.businessExpenses)})</p>
      <p className={change >= 0 ? 'text-teal-700' : 'text-red-700'}>{change >= 0 ? '▲ بهتر' : '▼ کمتر'} به اندازهٔ {fmtMoney(Math.abs(change))}</p>
    </section>
    <section aria-label="هدف مفاد ماهانه" className="mt-3 rounded-xl border border-slate-200 p-3 text-sm">
      <label className="block font-bold" htmlFor="month-profit-target">هدف مفاد خالص هر ماه</label>
      <div className="mt-1 flex gap-2">
        <input id="month-profit-target" inputMode="numeric" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-1.5"
          value={targetStr} onChange={e => setTargetStr(e.target.value)} placeholder="مثلاً ۵۰۰۰۰" />
        <button className="party-action" disabled={typed <= 0 || typed === target} onClick={() => onTarget(typed)}>ثبت هدف</button>
        {target > 0 && <button className="party-action" onClick={() => { setTargetStr(''); onTarget(0) }}>پاک</button>}
      </div>
      {target > 0 && <p className="mt-1">هدف فعلی: <b>{fmtMoney(target)}</b></p>}
      <p className="explain-hint">هدف فقط در همین دستگاه نگه‌داری می‌شود و به حساب‌ها دست نمی‌زند.</p>
    </section>
    <p className="explain-note">مصرف خانه و شخصی و روزهای بسته اینجا کم نمی‌شود؛ آن‌ها برداشت شرکا اند.</p>
    <button className="primary-button mt-4" onClick={() => { onClose(); goTo('reports') }}>راپور کامل</button>
  </Modal>
}
