import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sale, type SaleLine, type Variant, type Product } from '../../db'
import { addExchange } from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

/** تبادله: جنس برگشتی + جنس جدید؛ صندوق فقط تفاوت را می‌بیند */
export function ExchangeModal({ sale, onClose }: { sale: Sale; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [restock, setRestock] = useState(true)
  const [newLines, setNewLines] = useState<SaleLine[]>([])
  const [search, setSearch] = useState('')
  const [cashStr, setCashStr] = useState('')
  const [cashTouched, setCashTouched] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  const returnAmount = sale.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitPrice, 0)
  const newTotal = newLines.reduce((s, l) => s + l.qty * l.unitPrice, 0)
  const diff = newTotal - returnAmount
  const cashIn = cashTouched ? parseNum(cashStr) : Math.max(0, diff)
  // اگر جنس جدید ارزان‌تر است، تفاوت نقد به مشتری برمی‌گردد (اثر خالص صندوق = تفاوت)
  const paid = diff >= 0 ? returnAmount + cashIn : newTotal
  const remainder = newTotal - paid

  function addLine(v: Variant) {
    const p = productMap.get(v.productId)!
    const price = sale.saleType === 'retail' ? v.retailPrice : v.wholesalePrice
    setNewLines((ls) => {
      const i = ls.findIndex((l) => l.variantId === v.id)
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
      return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: price }]
    })
    setSearch('')
  }

  async function save() {
    if (savingRef.current) return
    const retLines = sale.lines
      .map((l, i) => ({ ...l, qty: qtys[i] ?? 0, restock }))
      .filter((l) => l.qty > 0)
    if (!retLines.length) return setError('جنس برگشتی را انتخاب کنید')
    if (!newLines.length) return setError('جنس جدید را انتخاب کنید')
    if (remainder > 0 && !sale.customerId) return setError('این فروش مشتری ندارد — تفاوت باید نقد گرفته شود')
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      await addExchange(
        {
          date: Date.now(),
          kind: 'customer',
          partyId: sale.customerId,
          partyName: sale.customerName ?? 'مشتری نقدی',
          refId: sale.id,
          saleType: sale.saleType,
          lines: retLines,
          reason: 'تبادله',
          settlement: 'cashRefund',
          amount: returnAmount
        },
        {
          date: Date.now(),
          customerId: sale.customerId,
          customerName: sale.customerName,
          saleType: sale.saleType,
          lines: newLines,
          total: newTotal,
          paid
        }
      )
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title="تبادلهٔ جنس" onClose={() => { if (!savingRef.current) onClose() }}>
      <div className="sale-document-heading">
        <strong>{sale.customerName || 'مشتری نقدی'}</strong>
        <p>فروش {sale.id ? `#${fmtNum(sale.id)} · ` : ''}{fmtDate(sale.date)}</p>
      </div>
      <fieldset disabled={saving} className="sale-correction-fields" aria-busy={saving}>
        <section className="sale-correction-group" aria-label="جنس برگشتی">
          <h3>۱) جنس برگشتی</h3>
          <p className="sale-correction-help">تعداد برگشتی را از فروش اصلی انتخاب کنید.</p>
          {sale.lines.map((l, i) => (
            <div key={i} className="sale-cart-line">
              <div className="text-sm">
                <p className="font-bold">
                  {l.productName} {l.size} {l.color}
                </p>
                <p className="text-slate-500">
                  فروخته: {fmtNum(l.qty)} × {fmtMoney(l.unitPrice)}
                </p>
              </div>
              <div className="sale-quantity-actions">
                <button className="quantity-step" aria-label={`کم کردن برگشتی ${l.productName} ${l.size} ${l.color}`} disabled={(qtys[i] ?? 0) <= 0} onClick={() => setQtys((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1) }))}>
                  −
                </button>
                <input
                  className="quantity-value"
                  aria-label={`تعداد برگشتی ${l.productName} ${l.size} ${l.color}`}
                  inputMode="numeric"
                  value={qtys[i] ?? 0}
                  onChange={(e) => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, Math.max(0, parseNum(e.target.value) || 0)) }))}
                />
                <button className="quantity-step" aria-label={`زیاد کردن برگشتی ${l.productName} ${l.size} ${l.color}`} disabled={(qtys[i] ?? 0) >= l.qty} onClick={() => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1) }))}>
                  ＋
                </button>
              </div>
            </div>
          ))}
          <label className="sale-correction-check">
            <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
            جنس برگشتی سالم است — به گدام برگردد
          </label>
          <p className="sale-correction-help">{restock ? 'تعداد برگشتی به موجودی گدام اضافه می‌شود.' : 'جنس داغمه ثبت می‌شود؛ موجودی گدام زیاد نمی‌شود.'}</p>
        </section>
        <section className="sale-correction-group" aria-label="جنس جدید">
          <h3>۲) جنس جدید</h3>
          <Field label="جستجوی جنس">
            <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
          </Field>
          {matches.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
              {matches.map((v) => {
                const p = productMap.get(v.productId)!
                return (
                  <button
                    key={v.id}
                    onClick={() => addLine(v)}
                    disabled={v.stockQty <= 0 && !sale.lines.some((l) => l.variantId === v.id)}
                    className="sale-correction-match sale-search-choice disabled:opacity-40"
                  >
                    <span>
                      {p.name} — {v.size} {v.color}
                    </span>
                    <span className="text-sm text-slate-500">
                      {fmtNum(v.stockQty)} عدد · {fmtMoney(sale.saleType === 'retail' ? v.retailPrice : v.wholesalePrice)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {search.trim() && variants && matches.length === 0 && <p role="status" className="sale-correction-help">جنسی با این جستجو پیدا نشد.</p>}
          {newLines.length === 0 && <p className="sale-correction-help">جنس جایگزین را جستجو و انتخاب کنید؛ قیمت و تعداد قابل تغییر است.</p>}
          {newLines.map((l, i) => (
            <div key={l.variantId} className="sale-cart-line">
              <div>
                <p className="text-sm font-bold">
                  {l.productName} {l.size} {l.color}
                </p>
              </div>
              <label className="sale-correction-price">
                <span className="field-label">قیمت فی جوړه</span>
                <input
                  className={inputCls}
                  aria-label={`قیمت فی جوړه ${l.productName} ${l.size} ${l.color}`}
                  inputMode="numeric"
                  value={l.unitPrice}
                  onChange={(e) => setNewLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
                />
              </label>
              <label>
                <span className="field-label">تعداد</span>
                <input
                  className="quantity-value"
                  aria-label={`تعداد جنس جدید ${l.productName} ${l.size} ${l.color}`}
                  inputMode="numeric"
                  value={l.qty}
                  onChange={(e) => setNewLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, parseNum(e.target.value) || 1) } : x)))}
                />
              </label>
              <button className="sale-remove-line" aria-label={`حذف جنس جدید ${l.productName} ${l.size} ${l.color}`} onClick={() => setNewLines((ls) => ls.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
        </section>
        <section className="sale-correction-group" aria-label="تصفیه تبادله">
          <h3>۳) تفاوت و تصفیه</h3>
          <div className="sale-correction-summary">
            <dl>
              <div><dt>ارزش جنس برگشتی</dt><dd>{fmtMoney(returnAmount)}</dd></div>
              <div><dt>ارزش جنس جدید</dt><dd>{fmtMoney(newTotal)}</dd></div>
            </dl>
            {diff > 0 && (
              <>
                <div className="sale-correction-difference">
                  <span>تفاوت — از مشتری بگیرید</span>
                  <span>{fmtMoney(diff)}</span>
                </div>
                <Field label="دریافتی نقدی">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={cashTouched ? cashStr : String(diff)}
                    onFocus={() => {
                      if (!cashTouched) {
                        setCashTouched(true)
                        setCashStr(String(diff))
                      }
                    }}
                    onChange={(e) => setCashStr(e.target.value)}
                  />
                </Field>
                {remainder > 0 && <p className="text-sm font-bold text-red-700">باقی (قرض مشتری): {fmtMoney(remainder)}</p>}
              </>
            )}
            {diff < 0 && <p className="font-bold text-amber-700">بازگشت نقدی به مشتری: {fmtMoney(-diff)}</p>}
            {diff === 0 && newTotal > 0 && <p className="font-bold text-teal-700">برابر — بدون پرداخت ✓</p>}
          </div>
        </section>
      </fieldset>
      {error && <p role="alert" className="sale-correction-error">{error}</p>}
      {saving && <p role="status" className="sale-correction-help">در حال ثبت… تا پایان ثبت، این صفحه باز می‌ماند.</p>}
      <div className="mt-3">
        <PrimaryBtn onClick={save} disabled={saving || returnAmount <= 0 || !newLines.length}>
          {saving ? 'در حال ثبت…' : 'ثبت تبادله'}
        </PrimaryBtn>
      </div>
    </Modal>
  )
}

export default ExchangeModal
