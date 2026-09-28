import { type Sale } from '../../db'
import { fmtMoney, fmtNum, fmtDate } from '../../lib/format'
import { Modal } from '../../components/ui'
import { commercialSaleLines } from '../../lib/commercialLines'

const escapeHtml = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)

/**
 * فاکتور فروش به شکل دفترچهٔ کاغذی عمده: شماره / جنس / جوړه / قیمت واحد / جمع،
 * بعد تخفیف، نقد و باقی. چاپ با iframe و اشتراک به شکل متن.
 */
export function InvoiceModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const remainder = sale.total - sale.paid
  // Stored sale.total is already net of discount, as on the image receipt.
  const subtotal = sale.total + (sale.discount ?? 0)
  const rows = commercialSaleLines(sale).map((l, i) => ({
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
    `مجموع اجناس: ${fmtMoney(subtotal)}`
  ]
  if ((sale.discount ?? 0) > 0) textParts.push(`تخفیف: −${fmtMoney(sale.discount!)}`)
  textParts.push(`قابل پرداخت: ${fmtMoney(sale.total)}`)
  textParts.push(`نقد: ${fmtMoney(sale.paid)}`)
  if (remainder > 0) textParts.push(`باقی (قرض): ${fmtMoney(remainder)}`)

  function printInvoice() {
    const cell = 'border:1px solid #333;padding:6px 10px;text-align:center;'
    const head = 'background:#eaf2ff;color:#1d1d1f;font-weight:bold;'
    const rowsHtml = rows
      .map(
        (r) =>
          `<tr><td style="${cell}">${r.n}</td><td style="${cell};text-align:right">${escapeHtml(r.name)}</td><td style="${cell}">${fmtNum(
            r.qty
          )}</td><td style="${cell}">${fmtMoney(r.price)}</td><td style="${cell};font-weight:bold">${fmtMoney(r.total)}</td></tr>`
      )
      .join('')
    const extra =
      (sale.discount ?? 0) > 0 ? `<div class="row"><span>تخفیف</span><b>−${fmtMoney(sale.discount!)}</b></div>` : ''
    const rem = remainder > 0 ? `<div class="row red"><span>باقی (قرض مشتری)</span><b>${fmtMoney(remainder)}</b></div>` : ''
    const html = `<!doctype html><html dir="rtl" lang="fa"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title><style>
body{font-family:sans-serif;padding:16px;max-width:520px;margin:auto}
h1{font-size:18px;text-align:center;margin:0 0 4px}
.sub{text-align:center;color:#555;font-size:13px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:14px}
.row{display:flex;justify-content:space-between;font-size:15px;margin-top:8px}
.total{font-size:17px;font-weight:bold;border-top:2px solid #333;padding-top:6px}
.red{color:#b91c1c}
</style></head><body>
<h1>فاکتور فروش</h1>
<p class="sub">${escapeHtml(sale.customerName || 'مشتری نقدی')} · ${fmtDate(sale.date)} · ${
      sale.saleType === 'retail' ? 'پرچون' : 'عمده'
    }</p>
<table><thead><tr><th style="${cell}${head}">شماره</th><th style="${cell}${head}">اسم جنس</th><th style="${
      cell
    }${head}">جوړه</th><th style="${cell}${head}">قیمت واحد</th><th style="${cell}${head}">قیمت کل</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<div class="row"><span>مجموع اجناس</span><span>${fmtMoney(subtotal)}</span></div>
${extra}
<div class="row total"><span>قابل پرداخت</span><span>${fmtMoney(sale.total)}</span></div>
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
    <Modal title="فاکتور فروش" onClose={onClose}>
      <div className="sale-document-heading"><strong>{sale.customerName || 'مشتری نقدی'}</strong><p>{fmtDate(sale.date)} · {sale.saleType === 'retail' ? 'پرچون' : 'عمده'}</p></div>
      <table className="sale-invoice-table">
        <caption className="sr-only">اجناس فاکتور فروش</caption>
        <thead>
          <tr>
            <th scope="col">شماره</th>
            <th scope="col">اسم جنس</th>
            <th scope="col">جوړه</th>
            <th scope="col">فی جوړه</th>
            <th scope="col">جمع</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.n}>
              <td data-label="شماره">{fmtNum(r.n)}</td>
              <td data-label="اسم جنس">{r.name}</td>
              <td data-label="جوړه">{fmtNum(r.qty)}</td>
              <td data-label="فی جوړه">{fmtMoney(r.price)}</td>
              <td data-label="جمع"><strong>{fmtMoney(r.total)}</strong></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="sale-document-totals">
        <div className="flex justify-between font-bold text-slate-800">
          <span>مجموع اجناس</span>
          <span>{fmtMoney(subtotal)}</span>
        </div>
        {(sale.discount ?? 0) > 0 && (
          <div className="mt-1 flex justify-between text-amber-700">
            <span>تخفیف</span>
            <span>−{fmtMoney(sale.discount!)}</span>
          </div>
        )}
        <div className="sale-document-net"><span>قابل پرداخت</span><strong>{fmtMoney(sale.total)}</strong></div>
        <div className="mt-1 flex justify-between">
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
      <div className="sale-document-actions">
        <button onClick={printInvoice} className="primary-button">
          چاپ
        </button>
        <button onClick={() => void share()} className="sale-secondary-action">
          اشتراک / واتساپ
        </button>
      </div>
      <button className="sale-secondary-action w-full" onClick={onClose}>بستن</button>
    </Modal>
  )
}

export default InvoiceModal
