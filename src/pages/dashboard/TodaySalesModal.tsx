import type { Sale } from '../../db'
import { Modal } from '../../components/ui'
import { commercialSaleLines } from '../../lib/commercialLines'
import { fmtDate, fmtMoney, fmtNum } from '../../lib/format'
import { saleCustomerCredit } from '../../lib/salesFigures'

export interface TodayProfitParts { goods: number; cost: number; discount: number; returned: number; profit: number }

/** «فروش امروز از کجا آمد» — هر فروش امروز، و مفاد قدم‌به‌قدم (فقط برای مالک). */
export default function TodaySalesModal({ sales, parts, isStaff, onClose, goTo }: {
  sales: Sale[]; parts: TodayProfitParts; isStaff?: boolean; onClose: () => void; goTo: (target: string) => void
}) {
  const total = sales.reduce((sum, sale) => sum + sale.total, 0)
  const rows = [...sales].sort((a, b) => b.date - a.date)
  return <Modal title="فروش امروز از کجا آمد" onClose={onClose}>
    <p className="explain-total">مجموع: <strong>{fmtMoney(total)}</strong> — {fmtNum(sales.length)} فروش</p>
    {rows.length === 0 ? <p className="text-sm text-slate-500">امروز هنوز فروشی ثبت نشده.</p> : <div className="explain-rows">
      {rows.map(sale => {
        const credit = saleCustomerCredit(sale)
        return <div key={sale.id} className="explain-row">
          <span className="min-w-0">{sale.customerName || 'مشتری نقدی'}<small>{fmtDate(sale.date)} · {commercialSaleLines(sale).map(l => `${l.productName} ×${fmtNum(l.qty)}`).join('، ')}</small></span>
          <span className="explain-amount">{fmtMoney(sale.total)}{sale.directTrade ? <small>فروش مستقیم</small> : credit > 0 ? <small className="text-red-700">قرض {fmtMoney(credit)}</small> : <small>نقد</small>}</span>
        </div>
      })}
    </div>}
    {!isStaff && <section aria-label="مفاد امروز" className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">
      <p className="mb-1 font-bold">مفاد امروز قدم‌به‌قدم</p>
      <p className="flex justify-between"><span>قیمت فروش اجناس</span><span>{fmtMoney(parts.goods)}</span></p>
      <p className="flex justify-between"><span>منهای قیمت خرید همان اجناس</span><span>−{fmtMoney(parts.cost)}</span></p>
      {parts.discount > 0 && <p className="flex justify-between"><span>منهای تخفیف</span><span>−{fmtMoney(parts.discount)}</span></p>}
      {parts.returned !== 0 && <p className="flex justify-between"><span>منهای مفاد جنس برگشتی</span><span>−{fmtMoney(parts.returned)}</span></p>}
      <p className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold"><span>مفاد</span><span>{fmtMoney(parts.profit)}</span></p>
      <p className="explain-note">مصارف روزانه در این مفاد کم نشده است؛ مفاد خالص در راپورها است.</p>
    </section>}
    <button className="primary-button mt-4" onClick={() => { onClose(); goTo('sales') }}>دیدن تاریخچهٔ فروش</button>
  </Modal>
}
