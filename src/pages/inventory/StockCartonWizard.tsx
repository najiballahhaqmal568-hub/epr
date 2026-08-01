import DuplicateNameHint from '../../components/DuplicateNameHint'
import { useState } from 'react'
import { db, makeSku } from '../../db'
import { fmtNum, fmtMoney, parseNum } from '../../lib/format'
import { Modal, Field, inputCls } from '../../components/ui'
import { downscalePhoto } from './helpers'

/**
 * ثبت جنس کارتنی در گدام — همان ترتیب ویزارد خرید:
 * ۱) مشخصات و عکس  ۲) تعداد کارتن  ۳) ظرفیت کارتن  ۴) شماره‌بندی تا پوره شدن
 * ۵) حساب خودکار. موجودی اولیه سایز به سایز با سند «موجودی اولیه» ثبت می‌شود.
 */
export function StockCartonWizard({ onClassic, onClose }: { onClassic: () => void; onClose: () => void }) {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [color, setColor] = useState('')
  const [photo, setPhoto] = useState<string | undefined>(undefined)
  const [cost, setCost] = useState('')
  const [retail, setRetail] = useState('')
  const [wholesale, setWholesale] = useState('')
  const [cartons, setCartons] = useState('')
  const [capacity, setCapacity] = useState('')
  const [rows, setRows] = useState<{ size: string; qty: string }[]>([
    { size: '', qty: '' },
    { size: '', qty: '' },
    { size: '', qty: '' }
  ])
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
      if (parseNum(retail) <= 0) return setError('قیمت فروش (پرچون) را بنویسید')
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
      await db.transaction('rw', db.products, db.variants, db.adjustments, async () => {
        const items = activeRows.map((r) => ({ size: r.size.trim(), color: color.trim(), qty: parseNum(r.qty) }))
        const pid = (await db.products.add({
          name: name.trim(),
          brand: brand.trim(),
          photo,
          carton: { items },
          createdAt: Date.now()
        })) as number
        for (const it of items) {
          const stock = it.qty * nCartons
          const vid = (await db.variants.add({
            productId: pid,
            size: it.size,
            color: it.color,
            purchasePrice: parseNum(cost),
            retailPrice: parseNum(retail),
            wholesalePrice: parseNum(wholesale) || parseNum(retail),
            stockQty: stock,
            lowStock: 2,
            // تاریخ ورود به گدام — برای سن جنس
            ...(stock > 0 ? { lastPurchaseAt: Date.now() } : {})
          })) as number
          await db.variants.update(vid, { sku: makeSku(vid, it.size) })
          if (stock !== 0) {
            await db.adjustments.add({
              date: Date.now(),
              variantId: vid,
              productName: name.trim(),
              size: it.size,
              color: it.color,
              qtyChange: stock,
              reason: 'correction',
              note: 'موجودی اولیه'
            })
          }
        }
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const stepDot = (n: number) => (
    <span key={n} className={`h-2 w-2 rounded-full ${step === n ? 'bg-teal-700' : step > n ? 'bg-teal-300' : 'bg-slate-200'}`} />
  )

  return (
    <Modal title={`📦 جنس کارتنی جدید${name ? ` — ${name}` : ''}`} onClose={onClose}>
      <div className="mb-3 flex items-center justify-center gap-2">{[1, 2, 3, 4, 5].map(stepDot)}</div>

      {step === 1 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۱) مشخصات جنس</p>
          <div className="mb-3 flex items-center gap-3">
            {photo ? (
              <img src={photo} alt="" className="h-14 w-14 rounded-xl object-cover" />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-slate-100 text-2xl">👞</div>
            )}
            <label className="cursor-pointer rounded-xl bg-slate-100 px-4 py-2 text-sm font-bold text-slate-700">
              {photo ? 'تغییر عکس' : '📷 عکس'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (f) setPhoto(await downscalePhoto(f))
                  e.target.value = ''
                }}
              />
            </label>
          </div>
          <Field label="نام جنس *">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="مثلاً اسکچرز" />
          </Field>
          <DuplicateNameHint name={name} />
          <div className="grid grid-cols-2 gap-2">
            <Field label="برند">
              <input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} />
            </Field>
            <Field label="رنگ">
              <input className={inputCls} value={color} onChange={(e) => setColor(e.target.value)} placeholder="خاکی" />
            </Field>
            <Field label="قیمت خرید فی جوړه *">
              <input className={inputCls} inputMode="numeric" value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field label="قیمت پرچون *">
              <input className={inputCls} inputMode="numeric" value={retail} onChange={(e) => setRetail(e.target.value)} />
            </Field>
            <Field label="قیمت عمده">
              <input className={inputCls} inputMode="numeric" value={wholesale} onChange={(e) => setWholesale(e.target.value)} />
            </Field>
          </div>
          <button onClick={onClassic} className="mb-2 text-sm text-teal-700">
            ثبت عادی بدون کارتن (فورم کامل) ←
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۲) چند کارتن دارید؟</p>
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
              <input
                className="w-20 rounded-lg border border-slate-300 bg-white px-1 py-1.5 text-center text-sm"
                placeholder="سایز"
                inputMode="numeric"
                value={r.size}
                onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, size: e.target.value } : x)))}
              />
              <span className="flex-1 text-xs text-slate-400">{color.trim()}</span>
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
            onClick={() => setRows((rs) => [...rs, { size: '', qty: '' }])}
          >
            ＋ سایز دیگر
          </button>
        </>
      )}

      {step === 5 && (
        <>
          <p className="mb-2 text-sm font-bold text-slate-700">۵) حساب خودکار — بررسی و ثبت در گدام</p>
          <div className="mb-2 rounded-xl bg-teal-50 p-3 text-center font-bold text-teal-800">
            {fmtNum(nCartons)} کارتن × {fmtNum(cap)} جوړه = {fmtNum(nCartons * cap)} جوړه
          </div>
          {activeRows.map((r, i) => (
            <div key={i} className="mb-1 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
              <span className="font-bold">
                سایز {r.size} {color.trim()}
              </span>
              <span>
                {fmtNum(parseNum(r.qty))} × {fmtNum(nCartons)} = <b>{fmtNum(parseNum(r.qty) * nCartons)} جوړه</b>
              </span>
            </div>
          ))}
          <p className="mb-3 mt-2 font-bold text-slate-800">
            ارزش گدام: {fmtMoney(nCartons * cap * parseNum(cost))}{' '}
            <span className="text-xs font-normal text-slate-400">({fmtMoney(parseNum(cost))} فی جوړه)</span>
          </p>
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
            ✓ ثبت در گدام
          </button>
        )}
      </div>
    </Modal>
  )
}

export default StockCartonWizard
