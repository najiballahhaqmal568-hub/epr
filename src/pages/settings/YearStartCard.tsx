import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum, fmtMoney, fmtDateShort, parseNum } from '../../lib/format'
import { Card, Field, inputCls, PrimaryBtn, Modal } from '../../components/ui'
import { afn } from '../../lib/ops'

/**
 * شروع سال مالی: سرمایهٔ مالک را خودش حساب می‌کند تا مفاد روز اول دقیقاً صفر باشد.
 * اگر سرمایه دستی و تخمینی وارد شود، همان اشتباه تمام سال در مفاد می‌ماند.
 */
function YearStartCard() {
  const [open, setOpen] = useState(false)
  const started = useLiveQuery(async () => Number((await db.settings.get('partnershipStart'))?.value ?? 0), [])

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">🎬 شروع سال مالی</p>
      <p className="mb-3 text-sm text-slate-500">
        بعد از شمارش گدام و صندوق، اینجا سال را شروع کنید. اپ سرمایهٔ شما را خودش حساب می‌کند تا مفاد روز اول صفر باشد.
      </p>
      {started ? (
        <p className="mb-3 rounded-xl bg-teal-50 p-2.5 text-sm font-bold text-teal-800">
          سال مالی جاری از: {fmtDateShort(started)}
        </p>
      ) : (
        <p className="mb-3 rounded-xl bg-amber-50 p-2.5 text-sm font-bold text-amber-800">هنوز سال مالی شروع نشده</p>
      )}
      <button onClick={() => setOpen(true)} className="w-full rounded-xl bg-slate-800 py-3 font-bold text-white">
        {started ? 'شروع سال مالی نو' : 'شروع سال مالی'}
      </button>
      {open && <YearStartWizard onClose={() => setOpen(false)} />}
    </Card>
  )
}

function YearStartWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0)
  const [ownerName, setOwnerName] = useState('')
  const [ownerShare, setOwnerShare] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const nums = useLiveQuery(async () => {
    const [variants, movements, customers, suppliers] = await Promise.all([
      db.variants.filter((v) => !v.deleted).toArray(),
      db.cashMovements.filter((m) => !m.deleted).toArray(),
      db.customers.filter((c) => !c.deleted).toArray(),
      db.suppliers.filter((x) => !x.deleted).toArray()
    ])
    const others = suppliers.filter((x) => x.kind !== 'partner')
    return {
      stock: variants.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0),
      pairs: variants.reduce((s, v) => s + v.stockQty, 0),
      cash: movements.reduce((s, m) => s + m.amount, 0),
      receivables: customers.reduce((s, c) => s + Math.max(0, c.balance), 0),
      customerCredits: customers.reduce((s, c) => s + Math.max(0, -c.balance), 0),
      payables: others.filter((x) => x.kind !== 'lender').reduce((s, x) => s + Math.max(0, x.balance), 0),
      loans: others.filter((x) => x.kind === 'lender').reduce((s, x) => s + Math.max(0, x.balance), 0),
      supplierCredits: others.reduce((s, x) => s + Math.max(0, -x.balance), 0),
      partners: suppliers.filter((x) => x.kind === 'partner')
    }
  }, [])

  if (!nums) return null

  const assets =
    nums.stock + nums.cash + nums.receivables + nums.supplierCredits - nums.payables - nums.loans - nums.customerCredits
  const othersCapital = nums.partners.filter((p) => p.name !== ownerName.trim()).reduce((s, p) => s + (p.capital ?? 0), 0)
  const ownerCapital = afn(assets - othersCapital)

  async function finish() {
    try {
      const name = ownerName.trim()
      if (!name) return setError('نام خود را بنویسید')
      if (ownerCapital < 0) return setError('سرمایهٔ شما منفی می‌شود — اعداد گدام و قرض‌ها را دوباره ببینید')
      const share = parseNum(ownerShare) || (nums!.partners.length === 0 ? 100 : 0)
      const existing = nums!.partners.find((p) => p.name === name)
      if (existing) {
        await db.suppliers.update(existing.id!, { capital: ownerCapital, share, kind: 'partner' })
      } else {
        await db.suppliers.add({ name, balance: 0, kind: 'partner', capital: ownerCapital, share })
      }
      await db.settings.put({ key: 'partnershipStart', value: Date.now() })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const Line = ({ label, value, red, hint }: { label: string; value: number; red?: boolean; hint?: string }) => (
    <div className="flex items-start justify-between border-b border-slate-100 py-1.5 text-sm last:border-0">
      <span className="text-slate-600">
        {label}
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <span className={`font-bold ${red ? 'text-red-600' : 'text-slate-800'}`}>
        {red && value > 0 ? '−' : ''}
        {fmtMoney(value)}
      </span>
    </div>
  )

  if (done)
    return (
      <Modal title="🎬 شروع سال مالی" onClose={onClose}>
        <p className="py-6 text-center text-lg font-bold text-teal-700">✅ سال مالی شروع شد</p>
        <p className="mb-4 text-center text-sm text-slate-500">
          سرمایهٔ شما {fmtMoney(ownerCapital)} ثبت شد و مفاد از امروز شمرده می‌شود.
        </p>
        <PrimaryBtn onClick={onClose}>بستن</PrimaryBtn>
      </Modal>
    )

  return (
    <Modal title="🎬 شروع سال مالی" onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}

      {step === 0 && (
        <>
          <p className="mb-3 font-bold text-slate-800">۱) اول این‌ها را در اپ ثبت کنید</p>
          <p className="mb-3 text-sm text-slate-500">
            پیش از شروع سال، همهٔ اعداد باید در اپ باشد. این صفحه اعداد فعلی را زنده نشان می‌دهد — هر کدام صفر بود یعنی هنوز
            ثبت نشده.
          </p>
          <div className="rounded-xl bg-slate-50 p-3">
            <Line label="ارزش جنس گدام" value={nums.stock} hint={`${fmtNum(nums.pairs)} جوړه — در تب «گدام»`} />
            <Line label="پول نقد در صندوق" value={nums.cash} hint="در «مصارف ← صندوق ← تصفیه صندوق»" />
            <Line label="طلب از مشتریان" value={nums.receivables} hint="در «مشتریان ← قرض قبلی»" />
            <Line label="قرض ما به تأمین‌کنندگان" value={nums.payables} red hint="در «خرید ← تأمین‌کنندگان»" />
            <Line label="قرض ما از اشخاص" value={nums.loans} red hint="در «خرید ← قرض‌دهنده‌ها»" />
            {nums.customerCredits > 0 && <Line label="پیش‌پرداخت مشتریان" value={nums.customerCredits} red />}
            {nums.supplierCredits > 0 && <Line label="پیشکی ما نزد تأمین‌کننده" value={nums.supplierCredits} />}
          </div>
          <div className="mt-3 flex items-center justify-between rounded-xl bg-teal-50 p-3">
            <span className="font-bold text-slate-700">دارایی خالص امروز</span>
            <span className="text-xl font-bold text-teal-800">{fmtMoney(assets)}</span>
          </div>
          <p className="mt-3 text-xs text-slate-400">
            اگر عددی کم است، این صفحه را ببندید، آن را ثبت کنید و دوباره برگردید — اعداد خودکار تازه می‌شوند.
          </p>
          <div className="mt-3">
            <PrimaryBtn onClick={() => setStep(1)}>اعداد درست است — بعدی</PrimaryBtn>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <p className="mb-3 font-bold text-slate-800">۲) سرمایهٔ شما</p>
          <p className="mb-3 text-sm text-slate-500">
            سرمایه را تایپ نمی‌کنید — اپ آن را از دارایی خالص حساب می‌کند تا مفاد روز اول دقیقاً صفر باشد.
          </p>
          <Field label="نام شما (مالک) *">
            <input className={inputCls} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="مثلاً نجیب‌الله" />
          </Field>
          {nums.partners.length > 0 && (
            <div className="mb-3 rounded-xl bg-slate-50 p-2.5 text-sm">
              <p className="mb-1 font-bold text-slate-700">شرکای ثبت‌شده</p>
              {nums.partners.map((p) => (
                <div key={p.id} className="flex justify-between">
                  <span className="text-slate-600">
                    {p.name} ({fmtNum(p.share ?? 0)}٪)
                  </span>
                  <span className="font-bold">{fmtMoney(p.capital ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
          <Field label={`فیصدی سهم شما از مفاد${nums.partners.length === 0 ? ' (خالی = ۱۰۰٪)' : ''}`}>
            <input className={inputCls} inputMode="numeric" value={ownerShare} onChange={(e) => setOwnerShare(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-600">
              →
            </button>
            <div className="flex-1">
              <PrimaryBtn disabled={!ownerName.trim()} onClick={() => setStep(2)}>
                بعدی
              </PrimaryBtn>
            </div>
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <p className="mb-3 font-bold text-slate-800">۳) تأیید نهایی</p>
          <div className="rounded-xl bg-slate-50 p-3">
            <Line label="ارزش جنس گدام" value={nums.stock} />
            <Line label="پول صندوق" value={nums.cash} />
            <Line label="طلب از مشتریان" value={nums.receivables} />
            {nums.supplierCredits > 0 && <Line label="پیشکی نزد تأمین‌کننده" value={nums.supplierCredits} />}
            <Line label="قرض ما به تأمین‌کنندگان" value={nums.payables} red />
            <Line label="قرض ما از اشخاص" value={nums.loans} red />
            {nums.customerCredits > 0 && <Line label="پیش‌پرداخت مشتریان" value={nums.customerCredits} red />}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl bg-teal-50 p-3">
            <span className="font-bold text-slate-700">دارایی خالص</span>
            <span className="text-xl font-bold text-teal-800">{fmtMoney(assets)}</span>
          </div>
          <div className="mt-2 rounded-xl bg-purple-50 p-3">
            {othersCapital > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">سرمایهٔ شرکای دیگر</span>
                <span className="font-bold">{fmtMoney(othersCapital)}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="font-bold text-slate-700">سرمایهٔ شما ({ownerName.trim()})</span>
              <span className="text-lg font-bold text-purple-800">{fmtMoney(ownerCapital)}</span>
            </div>
          </div>
          <p className="mt-2 rounded-xl bg-teal-700 p-3 text-center font-bold text-white">مفاد امروز: ۰ ؋ ✅</p>
          <p className="mt-1 text-center text-xs text-slate-400">یعنی سال با حساب پاک شروع می‌شود</p>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setStep(1)} className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-600">
              →
            </button>
            <div className="flex-1">
              <PrimaryBtn onClick={() => void finish()}>تأیید — سال مالی شروع شود</PrimaryBtn>
            </div>
          </div>
        </>
      )}
    </Modal>
  )
}

export default YearStartCard
