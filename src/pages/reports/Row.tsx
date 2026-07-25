
export function Row({ label, value, sub, bold, red, teal }: { label: string; value: string; sub?: string; bold?: boolean; red?: boolean; teal?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className={`${bold ? 'font-bold text-slate-800' : 'text-slate-600'}`}>{label}</span>
      <span className="text-left">
        <span className={`font-bold ${teal ? 'text-teal-700' : red ? 'text-red-600' : 'text-slate-800'}`}>{value}</span>
        {sub && <span className="block text-xs font-normal text-slate-400">{sub}</span>}
      </span>
    </div>
  )
}

export default Row
