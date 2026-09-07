import { fmtNum } from '../../lib/format'

/** Selection is a local reservation only; no stock is written here. */
export default function StockSelectionSummary({ stock, selected }: { stock?: number; selected: number }) {
  if (stock === undefined) return <span className="block text-xs text-slate-500">در حال خواندن موجودی…</span>
  const remaining = stock - selected
  return <span className="block text-xs leading-6 text-slate-600" aria-live="polite">
    موجودی: {fmtNum(stock)} · انتخاب‌شده: {fmtNum(selected)} · باقی‌مانده: {fmtNum(Math.max(0, remaining))} جوره
    {!Number.isInteger(selected) || selected < 0
      ? <span role="alert" className="block font-bold text-red-700">تعداد باید عدد صحیح باشد</span>
      : remaining < 0
        ? <span role="alert" className="block font-bold text-red-700">{fmtNum(-remaining)} جوره بیشتر از موجودی؛ تعداد را کم کنید</span>
        : remaining === 0 && <span className="block font-bold text-amber-800">{stock > 0 ? 'تمام موجودی انتخاب شد' : 'این سایز و رنگ موجود نیست'}</span>}
  </span>
}
