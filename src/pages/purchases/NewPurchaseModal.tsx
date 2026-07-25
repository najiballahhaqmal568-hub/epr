import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PurchaseLine, type Product } from '../../db'
import { addPurchase } from '../../lib/ops'
import { fmtNum, fmtMoney, parseNum } from '../../lib/format'
import QtyControl from '../../components/QtyControl'
import CartonWizardModal from './CartonWizardModal'
import { Modal, Field, inputCls } from '../../components/ui'

export function NewPurchaseModal({ onClose }: { onClose: () => void }) {
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [paidStr, setPaidStr] = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [received, setReceived] = useState(true)
  const [useSarraf, setUseSarraf] = useState(false)
  const [sarrafId, setSarrafId] = useState<number | ''>('')
  const [sarrafStr, setSarrafStr] = useState('')
  const [cartonEditFor, setCartonEditFor] = useState<Product | null>(null)
  const [npWizard, setNpWizard] = useState(false)

  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const vendors = suppliers?.filter((s) => s.kind !== 'sarraf' && s.kind !== 'partner')
  const sarrafs = suppliers?.filter((s) => s.kind === 'sarraf')

  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color} ${v.sku ?? ''}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  // جنس‌های مطابق جستجو (یکتا) — برای دکمه‌های کارتن
  const matchedProducts = [...new Map(matches.map((v) => [v.productId, productMap.get(v.productId)!])).values()]
  const cartonProducts = matchedProducts.filter((p) => (p.carton?.items.length ?? 0) > 0)

  function addCarton(p: Product) {
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    setLines((ls) => {
      let out = [...ls]
      for (const it of p.carton!.items) {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        if (!v) continue
        const i = out.findIndex((l) => l.variantId === v.id)
        if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + it.qty } : l))
        else out.push({ variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: it.qty, unitCost: v.purchasePrice })
      }
      return out
    })
  }

  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  const hawala = useSarraf ? Math.min(Math.max(0, parseNum(sarrafStr)), total) : 0
  const paid = paidTouched ? parseNum(paidStr) : Math.max(0, total - hawala)
  const remainder = total - paid - hawala

  async function save() {
    if (!supplierId) return setError('تأمین‌کننده را انتخاب کنید')
    if (!lines.length) return setError('حداقل یک جنس اضافه کنید')
    if (useSarraf && hawala > 0 && !sarrafId) return setError('صراف را انتخاب کنید')
    const supplier = vendors?.find((s) => s.id === supplierId)
    const sf = sarrafs?.find((s) => s.id === sarrafId)
    try {
      await addPurchase({
        date: Date.now(),
        supplierId: supplierId as number,
        supplierName: supplier?.name ?? '',
        lines,
        total,
        paid,
        ...(received ? {} : { received: false }),
        ...(hawala > 0 && sf ? { sarrafId: sf.id!, sarrafName: sf.name, sarrafAmount: hawala } : {})
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="خرید جدید" onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}
      <Field label="تأمین‌کننده *">
        <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">انتخاب کنید...</option>
          {vendors?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {vendors?.length === 0 && <p className="mb-2 text-sm text-amber-600">اول از بخش «تأمین‌کنندگان» یک تأمین‌کننده اضافه کنید.</p>}

      <Field label="جستجوی جنس">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {cartonProducts.map((p) => {
        const pairs = p.carton!.items.reduce((s, it) => s + it.qty, 0)
        return (
          <button
            key={`c${p.id}`}
            onClick={() => addCarton(p)}
            className="mb-2 flex w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-right font-bold text-amber-800 active:bg-amber-100"
          >
            <span>📦 {p.name} — ＋ یک کارتن</span>
            <span className="text-sm font-normal">{fmtNum(pairs)} جوړه</span>
          </button>
        )
      })}
      {matchedProducts.map((p) => (
        <button
          key={`ce${p.id}`}
          onClick={() => setCartonEditFor(p)}
          className="mb-2 w-full rounded-xl border border-dashed border-amber-400 px-3 py-2 text-right text-sm font-bold text-amber-700 active:bg-amber-50"
        >
          📦 {p.name} — خرید کارتنی (شماره‌بندی)
        </button>
      ))}
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((v) => {
            const p = productMap.get(v.productId)!
            return (
              <button
                key={v.id}
                onClick={() => {
                  setLines((ls) => {
                    const i = ls.findIndex((l) => l.variantId === v.id)
                    if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l))
                    return [...ls, { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitCost: v.purchasePrice }]
                  })
                  setSearch('')
                }}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">{fmtMoney(v.purchasePrice)}</span>
              </button>
            )
          })}
        </div>
      )}

      <button
        onClick={() => setNpWizard(true)}
        className="mb-3 w-full rounded-xl border-2 border-dashed border-amber-400 py-2.5 text-sm font-bold text-amber-700"
      >
        📦 جنس جدید — خرید کارتنی (در گدام نیست)
      </button>

      {lines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1">
            <p className="text-sm font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              value={l.unitCost}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitCost: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت خرید</span>
          </div>
          <div className="flex items-center gap-2">
            <QtyControl qty={l.qty} onChange={(q) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: q } : x)))} />
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <label className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={received} onChange={(e) => setReceived(e.target.checked)} />
        جنس تحویل شد (به گدام اضافه شود)
      </label>
      {!received && (
        <p className="mb-2 text-xs text-amber-600">
          🚚 خرید «در راه» ثبت می‌شود؛ وقتی جنس رسید، در لیست خریدها دکمهٔ «جنس رسید» را بزنید تا به گدام اضافه شود.
        </p>
      )}

      {(sarrafs?.length ?? 0) > 0 && (
        <label className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={useSarraf} onChange={(e) => setUseSarraf(e.target.checked)} />
          بخشی از پول از طریق صراف (حواله)
        </label>
      )}
      {useSarraf && (
        <div className="mb-2 grid grid-cols-2 gap-2">
          <Field label="صراف *">
            <select className={inputCls} value={sarrafId} onChange={(e) => setSarrafId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {sarrafs?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مبلغ حواله">
            <input className={inputCls} inputMode="numeric" value={sarrafStr} onChange={(e) => setSarrafStr(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-teal-50 p-3">
        <div className="flex justify-between font-bold text-slate-800">
          <span>مجموع</span>
          <span>{fmtMoney(total)}</span>
        </div>
        {hawala > 0 && (
          <div className="flex justify-between text-sm text-amber-700">
            <span>حواله صراف</span>
            <span>{fmtMoney(hawala)}</span>
          </div>
        )}
        <Field label="مبلغ پرداختی (نقد)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={paidTouched ? paidStr : String(paid)}
            onFocus={() => {
              if (!paidTouched) {
                setPaidTouched(true)
                setPaidStr(String(paid))
              }
            }}
            onChange={(e) => setPaidStr(e.target.value)}
          />
        </Field>
        {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض ما به تأمین‌کننده): {fmtMoney(remainder)}</p>}
        {hawala > 0 && <p className="text-sm font-bold text-amber-700">قرض ما به صراف: {fmtMoney(hawala)}</p>}
      </div>

      {/* نوار چسپان: مجموع و ثبت همیشه دیده شوند */}
      <div className="sticky bottom-0 -mx-4 -mb-8 mt-3 flex items-center gap-3 border-t border-slate-200 bg-white p-3 pb-4">
        <div className="flex-1">
          <p className="text-xs text-slate-500">مجموع خرید</p>
          <p className="text-2xl font-bold text-amber-700">{fmtMoney(total)}</p>
          {remainder > 0 && <p className="text-xs font-bold text-red-600">باقی: {fmtMoney(remainder)}</p>}
        </div>
        <button
          onClick={save}
          disabled={!lines.length || !supplierId}
          className="rounded-xl bg-amber-700 px-8 py-3 text-lg font-bold text-white active:bg-amber-800 disabled:opacity-40"
        >
          ثبت خرید
        </button>
      </div>
      {npWizard && (
        <CartonWizardModal
          variants={[]}
          defaults={{ name: search.trim(), color: '', cost: '', retail: '', wholesale: '' }}
          onApply={(newLines) => setLines((ls) => [...ls, ...newLines])}
          onClose={() => setNpWizard(false)}
        />
      )}
      {cartonEditFor && (
        <CartonWizardModal
          product={cartonEditFor}
          variants={(variants ?? []).filter((v) => v.productId === cartonEditFor.id)}
          onApply={(newLines) =>
            setLines((ls) => {
              let out = [...ls]
              for (const nl of newLines) {
                const i = out.findIndex((l) => l.variantId === nl.variantId)
                if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + nl.qty, unitCost: nl.unitCost } : l))
                else out.push(nl)
              }
              return out
            })
          }
          onClose={() => setCartonEditFor(null)}
        />
      )}
    </Modal>
  )
}

export default NewPurchaseModal
