import { type Sale } from '../../db'
import { fmtMoney, fmtNum, fmtDate } from '../../lib/format'
import { Modal, PrimaryBtn } from '../../components/ui'

/**
 * فاکتور فروش به شکل دفترچهٔ کاغذی عمده: شماره / جنس / جوړه / قیمت واحد / جمع،
 * بعد تخفیف، نقد و باقی. چاپ با iframe و اشتراک به شکل متن.
 */
export function InvoiceModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const remainder = sale.total - sale.paid
  const rows = sale.lines.map((l, i) => ({
    n: i + 1,
    name: `${l.productName} ${l.size} ${l.color}`.replace(/\s+/g, ' ').trim(),
    qty: l.qty,
    price: l.unitPrice,
    total: l.qty * l.unitPrice
  }))
  const title = `فاکتور فروش — ${sale.customerName || 'مشتری نقدی'} (${fmtDate(sale.date)})`

  const textRows = rows.map((r) => `${r.n}) ${r.name} — ${fmtNum(r.qty)}×${fmtMoney(r.price)} = ${fmtMoney(r.total)}`)
  const textParts = [
    `📄 ${title}`,
    '──────────────',
    ...textRows,
    '──────────────',
    `مجموع: ${fmtMoney(sale.total)}`
  ]
  if ((sale.discount ?? 0) > 0) textParts.push(`تخفیف: −${fmtMoney(sale.discount!)}`)
  textParts.push(`قابل پرداخت: ${fmtMoney(sale.total - (sale.discount ?? 0))}`)
  textParts.push(`نقد: ${fmtMoney(sale.paid)}`)
  if (remainder > 0) textParts.push(`باقی (قرض): ${fmtMoney(remainder)}`)

  function printInvoice() {
    const cell = 'border:1px solid #333;padding:6px 10px;text-align:center;'
    const head = 'background:#0f766e;color:#fff;font-weight:bold;'
    const rowsHtml = rows
      .map(
        (r) =>
          `<tr><td style="${cell}">${r.n}</td><td style="${cell};text-align:right">${r.name}</td><td style="${cell}">${fmtNum(
            r.qty
          )}</td><td style="${cell}">${fmtMoney(r.price)}</td><td style="${cell};font-weight:bold">${fmtMoney(r.total)}</td></tr>`
      )
      .join('')
    const extra =
      (sale.discount ?? 0) > 0 ? `<div class="row"><span>تخفیف</span><b>−${fmtMoney(sale.discount!)}</b></div>` : ''
    const rem = remainder > 0 ? `<div class="row red"><span>باقی (قرض مشتری)</span><b>${fmtMoney(remainder)}</b></div>` : ''
    const html = `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
<title>${title}</title><style>
body{font-family:sans-serif;padding:16px;max-width:520px;margin:auto}
h1{font-size:18px;text-align:center;margin:0 0 4px}
.sub{text-align:center;color:#555;font-size:13px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:14px}
.row{display:flex;justify-content:space-between;font-size:15px;margin-top:8px}
.total{font-size:17px;font-weight:bold;border-top:2px solid #333;padding-top:6px}
.red{color:#b91c1c}
</style></head><body>
<h1>فاکتور فروش</h1>
<p class="sub">${sale.customerName || 'مشتری نقدی'} · ${fmtDate(sale.date)} · ${
      sale.saleType === 'retail' ? 'پرچون' : 'عمده'
    }</p>
<table><thead><tr><th style="${cell}${head}">شماره</th><th style="${cell}${head}">اسم جنس</th><th style="${
      cell
    }${head}">جوړه</th><th style="${cell}${head}">قیمت واحد</th><th style="${cell}${head}">قیمت کل</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<div class="row total"><span>مجموع</span><span>${fmtMoney(sale.total)}</span></div>
${extra}
<div class="row total"><span>نقد</span><span>${fmtMoney(sale.paid)}</span></div>
${rem}
</body></html>`
    const f = document.createElement('iframe')
    f.style.position = 'fixed'
    f.style.right = '0'
    f.style.bottom = '0'
    f.style.width = '0'
    f.style.height = '0'
    f.style.border = '0'
    document.body.appendChild(f)
    const doc = f.contentWindow?.document
    if (!doc) return
    doc.open()
    doc.write(html)
    doc.close()
    f.contentWindow?.focus()
    f.contentWindow?.print()
    setTimeout(() => f.remove(), 60_000)
  }

  async function share() {
    const text = textParts.join('\n')
    if (navigator.share) {
      try {
        await navigator.share({ title: 'فاکتور فروش', text })
        return
      } catch {
        /* کاربر لغو کرد یا پشتیبانی نیست — به کاپی می‌رویم */
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      alert('فاکتور کاپی شد — آن را در واتساپ یا پیام بچسپانید.')
    } catch {
      alert(text)
    }
  }

  return (
    <Modal title={`🧾 فاکتور — ${sale.customerName || 'نقدی'}`} onClose={onClose}>
      <p className="mb-2 text-center text-xs text-slate-500">{fmtDate(sale.date)} · {sale.saleType === 'retail' ? 'پرچون' : 'عمده'}</p>
      <table className="mb-3 w-full border-collapse text-sm">
        <thead>
          <tr className="bg-teal-700 text-white">
            <th className="border border-slate-300 p-1.5">شماره</th>
            <th className="border border-slate-300 p-1.5">اسم جنس</th>
            <th className="border border-slate-300 p-1.5">جوړه</th>
            <th className="border border-slate-300 p-1.5">فی جوړه</th>
            <th className="border border-slate-300 p-1.5">جمع</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n} className="bg-white">
              <td className="border border-slate-200 p-1.5 text-center">{fmtNum(r.n)}</td>
              <td className="border border-slate-200 p-1.5">{r.name}</td>
              <td className="border border-slate-200 p-1.5 text-center font-bold">{fmtNum(r.qty)}</td>
              <td className="border border-slate-200 p-1.5 text-center">{fmtMoney(r.price)}</td>
              <td className="border border-slate-200 p-1.5 text-center font-bold">{fmtMoney(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
        <div className="flex justify-between font-bold text-slate-800">
          <span>مجموع</span>
          <span>{fmtMoney(sale.total)}</span>
        </div>
        {(sale.discount ?? 0) > 0 && (
          <div className="mt-1 flex justify-between text-amber-700">
            <span>تخفیف</span>
            <span>−{fmtMoney(sale.discount!)}</span>
          </div>
        )}
        <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-bold text-teal-700">
          <span>نقد</span>
          <span>{fmtMoney(sale.paid)}</span>
        </div>
        {remainder > 0 && (
          <div className="mt-1 flex justify-between font-bold text-red-600">
            <span>باقی (قرض مشتری)</span>
            <span>{fmtMoney(remainder)}</span>
          </div>
        )}
      </div>
      <div className="mb-3 flex gap-2">
        <button onClick={printInvoice} className="flex-1 rounded-xl bg-slate-800 py-2.5 text-sm font-bold text-white active:bg-slate-900">
          🖨 چاپ
        </button>
        <button onClick={() => void share()} className="flex-1 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white active:bg-teal-700">
          📤 اشتراک / واتساپ
        </button>
      </div>
      <PrimaryBtn onClick={onClose}>بستن</PrimaryBtn>
    </Modal>
  )
}

export default InvoiceModal
