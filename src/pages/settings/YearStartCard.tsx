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
  const [addingPartner, setAddingPartner] = useState(false)
  const [pName, setPName] = useState('')
  const [pCapital, setPCapital] = useState('')
  const [pShare, setPShare] = useState('')

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
  const othersShare = nums.partners.filter((p) => p.name !== ownerName.trim()).reduce((s, p) => s + (p.share ?? 0), 0)

  async function finish() {
    try {
      const name = ownerName.trim()
      if (!name) return setError('نام خود را بنویسید')
      if (ownerCapital < 0) return setError('سرمایهٔ شما منفی می‌شود — اعداد گدام و قرض‌ها را دوباره ببینید')
      const share = parseNum(ownerShare) || 100 - othersShare
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
          <p className="mb-3 font-bold text-slate-800">۲) شرکا و سرمایه‌ها</p>
          <p className="mb-3 text-sm text-slate-500">
            سرمایهٔ هر شریک = پولی که واقعاً گذاشته. فرقی نمی‌کند آن پول حالا نقد است یا جنس شده یا قرض تأمین‌کننده را خلاص
            کرده — همه‌اش در «دارایی خالص» بالا حساب شده. <b>سرمایهٔ خودتان را تایپ نمی‌کنید</b>؛ اپ باقی‌مانده را به شما
            می‌دهد تا مفاد روز اول صفر شود.
          </p>

          {nums.partners.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-sm font-bold text-slate-700">شرکای ثبت‌شده</p>
              {nums.partners.map((p) => (
                <div key={p.id} className="mb-1 flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-sm">
                  <span className="text-slate-700">
                    {p.name} <span className="text-xs text-slate-400">({fmtNum(p.share ?? 0)}٪)</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="font-bold">{fmtMoney(p.capital ?? 0)}</span>
                    <button
                      className="text-red-500"
                      onClick={async () => {
                        if (confirm(`${p.name} از شرکا حذف شود؟`)) await db.suppliers.update(p.id!, { deleted: true })
                      }}
                    >
                      ✕
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}

          {addingPartner ? (
            <div className="mb-3 rounded-xl border border-purple-300 bg-purple-50 p-3">
              <p className="mb-2 text-sm font-bold text-purple-900">شریک نو</p>
              <Field label="نام شریک *">
                <input className={inputCls} value={pName} onChange={(e) => setPName(e.target.value)} />
              </Field>
              <Field label="سرمایه‌ای که گذاشته (مبلغی که داده) *">
                <input className={inputCls} inputMode="numeric" value={pCapital} onChange={(e) => setPCapital(e.target.value)} />
              </Field>
              {parseNum(pCapital) > 0 && assets > 0 && (
                <p className="mb-2 rounded-lg bg-white p-2 text-sm">
                  سهم عادلانه بر اساس پول:{' '}
                  <span className="font-bold text-purple-800">{fmtNum(Math.round((parseNum(pCapital) / assets) * 100))}٪</span>
                  <span className="block text-xs text-slate-500">
                    ({fmtMoney(parseNum(pCapital))} از {fmtMoney(assets)}) — زحمت روزانهٔ خود را هم در نظر بگیرید
                  </span>
                </p>
              )}
              <Field label="فیصدی سهم او از مفاد *">
                <input className={inputCls} inputMode="numeric" value={pShare} onChange={(e) => setPShare(e.target.value)} />
              </Field>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddingPartner(false)}
                  className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-600"
                >
                  لغو
                </button>
                <div className="flex-1">
                  <PrimaryBtn
                    disabled={!pName.trim() || parseNum(pCapital) <= 0}
                    onClick={async () => {
                      try {
                        await db.suppliers.add({
                          name: pName.trim(),
                          balance: 0,
                          kind: 'partner',
                          capital: afn(parseNum(pCapital)),
                          share: parseNum(pShare)
                        })
                        setPName('')
                        setPCapital('')
                        setPShare('')
                        setAddingPartner(false)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                      }
                    }}
                  >
                    افزودن شریک
                  </PrimaryBtn>
                </div>
              </div>
            </div>
          ) : (
            <button
              onClick={() => {
                setAddingPartner(true)
                setError('')
              }}
              className="mb-3 w-full rounded-xl border-2 border-dashed border-purple-400 py-2.5 text-sm font-bold text-purple-700"
            >
              ＋ افزودن شریک (کسی که پول گذاشته)
            </button>
          )}

          <div className="mb-2 rounded-xl bg-slate-100 p-3">
            <p className="mb-2 text-sm font-bold text-slate-700">و شما (مالک)</p>
            <Field label="نام شما *">
              <input className={inputCls} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} placeholder="مثلاً نجیب‌الله" />
            </Field>
            <Field label="فیصدی سهم شما از مفاد">
              <input className={inputCls} inputMode="numeric" value={ownerShare} onChange={(e) => setOwnerShare(e.target.value)} placeholder={String(100 - othersShare)} />
            </Field>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">سرمایهٔ شما (خودکار)</span>
              <span className="font-bold text-purple-800">{fmtMoney(ownerCapital)}</span>
            </div>
          </div>

          {othersShare + (parseNum(ownerShare) || 100 - othersShare) !== 100 && (
            <p className="mb-2 rounded-xl bg-amber-50 p-2 text-xs font-bold text-amber-800">
              ⚠️ مجموع فیصدی‌ها {fmtNum(othersShare + (parseNum(ownerShare) || 100 - othersShare))}٪ است، نه ۱۰۰٪
            </p>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(0)} className="rounded-xl bg-slate-100 px-5 py-3 font-bold text-slate-600">
              →
            </button>
            <div className="flex-1">
              <PrimaryBtn disabled={!ownerName.trim() || addingPartner} onClick={() => setStep(2)}>
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
            <p className="mb-1 text-sm font-bold text-purple-900">سرمایهٔ هر شریک</p>
            {nums.partners
              .filter((p) => p.name !== ownerName.trim())
              .map((p) => (
                <div key={p.id} className="flex justify-between text-sm">
                  <span className="text-slate-600">
                    {p.name} <span className="text-xs text-slate-400">({fmtNum(p.share ?? 0)}٪)</span>
                  </span>
                  <span className="font-bold">{fmtMoney(p.capital ?? 0)}</span>
                </div>
              ))}
            <div className="mt-1 flex justify-between border-t border-purple-200 pt-1">
              <span className="font-bold text-slate-700">
                {ownerName.trim()}{' '}
                <span className="text-xs font-normal text-slate-400">({fmtNum(parseNum(ownerShare) || 100 - othersShare)}٪)</span>
              </span>
              <span className="text-lg font-bold text-purple-800">{fmtMoney(ownerCapital)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-purple-200 pt-1 text-sm">
              <span className="text-slate-600">مجموع سرمایه‌ها</span>
              <span className="font-bold">{fmtMoney(othersCapital + ownerCapital)}</span>
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
