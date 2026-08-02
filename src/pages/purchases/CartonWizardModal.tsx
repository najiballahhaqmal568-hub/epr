import DuplicateNameHint from '../../components/DuplicateNameHint'
import { useState } from 'react'
import { db, type PurchaseLine, type Product, type Variant } from '../../db'
import { addVariant } from '../../lib/ops'
import { fmtNum, fmtMoney, parseNum } from '../../lib/format'
import { Modal, Field, inputCls } from '../../components/ui'

/**
 * ویزارد خرید کارتنی (شماره‌بندی کارتن) — برای جنس جدید و موجود:
 * ۱) مشخصات جنس  ۲) تعداد کارتن  ۳) ظرفیت هر کارتن  ۴) شماره‌بندی تا پوره شدن
 * ۵) حساب خودکار هر سایز × تعداد کارتن و تأیید. قیمت خرید همهٔ سایزها یکسان است.
 */
export function CartonWizardModal({
  product,
  variants,
  defaults,
  onApply,
  onClose
}: {
  product?: Product
  variants: Variant[]
  defaults?: { name: string; color: string; cost: string; retail: string; wholesale: string }
  onApply: (lines: PurchaseLine[]) => void
  onClose: () => void
}) {
  const isNew = !product
  const first = variants[0]
  const [step, setStep] = useState(1)
  const [name, setName] = useState(defaults?.name ?? product?.name ?? '')
  const [color, setColor] = useState(defaults?.color ?? first?.color ?? '')
  const [cost, setCost] = useState(defaults?.cost || String(first?.purchasePrice || ''))
  const [retail, setRetail] = useState(defaults?.retail || String(first?.retailPrice || ''))
  const [wholesale, setWholesale] = useState(defaults?.wholesale || String(first?.wholesalePrice || ''))
  const [cartons, setCartons] = useState('')
  const savedPairs = product?.carton?.items.reduce((s, it) => s + it.qty, 0) ?? 0
  const [capacity, setCapacity] = useState(savedPairs ? String(savedPairs) : '')
  const [rows, setRows] = useState<{ variantId?: number; size: string; color: string; qty: string }[]>(
    product
      ? variants.map((v) => ({
          variantId: v.id!,
          size: v.size,
          color: v.color,
          qty: String(product.carton?.items.find((it) => it.size === v.size && it.color === v.color)?.qty || '')
        }))
      : [
          { size: '', color: '', qty: '' },
          { size: '', color: '', qty: '' },
          { size: '', color: '', qty: '' }
        ]
  )
  const [saveTemplate, setSaveTemplate] = useState(true)
  const [error, setError] = useState('')

  const nCartons = parseNum(cartons)
  const cap = parseNum(capacity)
  const filled = rows.reduce((s, r) => s + (r.size.trim() ? parseNum(r.qty) : 0), 0)
  const activeRows = rows.filter((r) => r.size.trim() && parseNum(r.qty) > 0)

  function next() {
    setError('')
    if (step === 1) {
      if (!name.trim()) return setError('نام جنس را بنویسید')
      if (parseNum(cost) <= 0) return setError('قیمت خرید را بنویسید')
      if (isNew && parseNum(retail) <= 0) return setError('قیمت فروش (پرچون) را بنویسید')
      setStep(2)
    } else if (step === 2) {
      if (nCartons <= 0) return setError('تعداد کارتن را بنویسید')
      setStep(3)
    } else if (step === 3) {
      if (cap <= 0) return setError('ظرفیت کارتن را بنویسید')
      setStep(4)
    } else if (step === 4) {
      if (filled !== cap) return setError(`شماره‌بندی پوره نیست: ${fmtNum(filled)} از ${fmtNum(cap)}`)
      setStep(5)
    }
  }

  async function confirm() {
    try {
      let pid = product?.id
      if (!pid) {
        pid = (await db.products.add({ name: name.trim(), createdAt: Date.now() })) as number
      }
      const lines: PurchaseLine[] = []
      const items: { size: string; color: string; qty: number }[] = []
      const unitCost = parseNum(cost)
      for (const r of activeRows) {
        const per = parseNum(r.qty)
        const size = r.size.trim()
        const rColor = (r.color || color).trim()
        let vid = r.variantId
        if (vid === undefined) {
          const existing = variants.find((v) => v.size === size && v.color === rColor)
          if (existing) vid = existing.id!
        }
        if (vid === undefined) {
          // موجودی صفر — جنس با خودِ سند خرید وارد گدام می‌شود
          vid = await addVariant(
            {
              productId: pid,
              size,
              color: rColor,
              purchasePrice: unitCost,
              retailPrice: parseNum(retail) || first?.retailPrice || 0,
              wholesalePrice: parseNum(wholesale) || parseNum(retail) || first?.wholesalePrice || 0,
              lowStock: first?.lowStock ?? 2
            },
            name.trim()
          )
        }
        items.push({ size, color: rColor, qty: per })
        lines.push({ variantId: vid, productName: name.trim(), size, color: rColor, qty: per * nCartons, unitCost })
      }
      if (saveTemplate && items.length) {
        await db.products.update(pid, {
          carton: { ...(product?.carton?.price ? { price: product.carton.price } : {}), items }
        })
      }
      onApply(lines)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const stepDot = (n: number) => (
    <span
      key={n}
      className={`h-2 w-2 rounded-full ${step === n ? 'bg-teal-700' : step > n ? 'bg-teal-300' : 'bg-slate-200'}`}
    />
  )

  return (
    <Modal title={`📦 خرید کارتنی${name ? ` — ${name}` : ''}`} onClose={onClose}>
      <div className="mb-4 flex items-center justify-center gap-2">{[1, 2, 3, 4, 5].map(stepDot)}</div>

      {step === 1 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۱) مشخصات جنس</p>
          {isNew ? (
            <>
              <Field label="نام جنس *">
                <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
              <DuplicateNameHint name={name} />
            </>
          ) : (
            <p className="mb-3 rounded-xl bg-slate-50 p-3 font-bold text-slate-800">{name}</p>
          )}
          {isNew && (
            <Field label="رنگ">
              <input className={inputCls} value={color} onChange={(e) => setColor(e.target.value)} />
            </Field>
          )}
          <Field label="قیمت خرید فی جوړه (برای همهٔ سایزها) *">
            <input className={inputCls} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          {isNew && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="قیمت پرچون *">
                <input className={inputCls} inputMode="numeric" value={retail} onChange={(e) => setRetail(e.target.value)} />
              </Field>
              <Field label="قیمت عمده">
                <input className={inputCls} inputMode="numeric" value={wholesale} onChange={(e) => setWholesale(e.target.value)} />
              </Field>
            </div>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۲) چند کارتن خریدید؟</p>
          <input
            className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-4 text-center text-3xl font-bold"
            inputMode="numeric"
            autoFocus
            placeholder="۳"
            value={cartons}
            onChange={(e) => setCartons(e.target.value)}
          />
        </>
      )}

      {step === 3 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۳) هر کارتن چند جوړه دارد؟</p>
          <input
            className="mb-3 w-full rounded-xl border border-slate-300 bg-white px-3 py-4 text-center text-3xl font-bold"
            inputMode="numeric"
            autoFocus
            placeholder="۸"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
          />
          {savedPairs > 0 && <p className="mb-2 text-xs text-slate-400">کارتن‌بندی ذخیره‌شدهٔ قبلی: {fmtNum(savedPairs)} جوړه</p>}
        </>
      )}

      {step === 4 && (
        <>
          <p className="mb-1 text-sm font-bold text-slate-700">۴) شماره‌بندی داخل یک کارتن</p>
          <p
            className={`mb-2 rounded-xl p-2 text-center text-sm font-bold ${
              filled === cap ? 'bg-teal-50 text-teal-700' : filled > cap ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {filled === cap ? `✅ پوره شد: ${fmtNum(cap)} جوړه` : filled > cap ? `⚠️ ${fmtNum(filled - cap)} جوړه زیادتر از ظرفیت!` : `${fmtNum(filled)} از ${fmtNum(cap)} جوړه`}
          </p>
          {rows.map((r, i) => (
            <div key={i} className="mb-1 flex items-center gap-2 rounded-lg bg-slate-50 p-2">
              {r.variantId !== undefined ? (
                <span className="flex-1 text-sm font-bold">
                  {r.size} {r.color}
                </span>
              ) : (
                <>
                  <input
                    className="w-16 rounded-lg border border-slate-300 bg-white px-1 py-1.5 text-center text-sm"
                    placeholder="سایز"
                    inputMode="numeric"
                    value={r.size}
                    onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}
                  />
                  <span className="flex-1 text-xs text-slate-400">{(r.color || color).trim()}</span>
                </>
              )}
              <span className="text-xs text-slate-400">در کارتن:</span>
              <input
                className="w-16 rounded-lg border border-slate-300 bg-white px-1 py-1.5 text-center font-bold"
                inputMode="numeric"
                placeholder="۰"
                value={r.qty}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))}
              />
            </div>
          ))}
          <button
            className="mb-2 w-full rounded-xl border border-dashed border-teal-600 py-1.5 text-sm text-teal-700"
            onClick={() => setRows((rs) => [...rs, { size: '', color, qty: '' }])}
          >
            ＋ سایز دیگر
          </button>
        </>
      )}

      {step === 5 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۵) حساب خودکار — بررسی و تأیید</p>
          <div className="mb-2 rounded-xl bg-teal-50 p-3 text-center font-bold text-teal-800">
            {fmtNum(nCartons)} کارتن × {fmtNum(cap)} جوړه = {fmtNum(nCartons * cap)} جوړه
          </div>
          {activeRows.map((r, i) => (
            <div key={i} className="mb-1 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
              <span className="font-bold">
                سایز {r.size} {(r.color || color).trim()}
              </span>
              <span>
                {fmtNum(parseNum(r.qty))} × {fmtNum(nCartons)} = <b>{fmtNum(parseNum(r.qty) * nCartons)} جوړه</b>
              </span>
            </div>
          ))}
          <p className="mb-2 mt-2 font-bold text-slate-800">
            مبلغ خرید: {fmtMoney(nCartons * cap * parseNum(cost))} <span className="text-xs font-normal text-slate-400">({fmtMoney(parseNum(cost))} فی جوړه)</span>
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={saveTemplate} onChange={(e) => setSaveTemplate(e.target.checked)} />
            این شماره‌بندی برای این جنس ذخیره شود (خرید بعدی فقط تعداد کارتن)
          </label>
        </>
      )}

      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        {step > 1 && (
          <button onClick={() => setStep(step - 1)} className="rounded-xl bg-slate-100 px-6 py-3 font-bold text-slate-600">
            قبلی
          </button>
        )}
        {step < 5 ? (
          <button onClick={next} className="flex-1 rounded-xl bg-teal-700 py-3 font-bold text-white active:bg-teal-800">
            بعدی
          </button>
        ) : (
          <button onClick={() => void confirm()} className="flex-1 rounded-xl bg-teal-700 py-3 font-bold text-white active:bg-teal-800">
            ✓ افزودن به خرید
          </button>
        )}
      </div>
    </Modal>
  )
}

export default CartonWizardModal
