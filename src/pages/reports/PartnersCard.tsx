import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum, fmtMoney, fmtDate, fmtDateShort, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Card } from '../../components/ui'
import { addCapital, addPartnerWithdrawal, afn } from '../../lib/ops'
import { netWorth } from '../../lib/networth'
import { addPartner, setPartnerCapital, settleYear, type SettleChoice } from '../../lib/partnership'
import { parseNum } from '../../lib/format'
import Row from './Row'

/**
 * شرکا و سرمایه — روش سنتی آخر سال:
 * سرمایه‌ها اول سال قید می‌شوند؛ برداشت/مصرف هر شریک با جزئیات ثبت می‌شود؛
 * آخر سال: فایده = (گدام + صندوق + طلب مشتریان − قرض ما + برداشت‌ها) − سرمایه‌ها
 * و طبق فیصدی تقسیم و سال جدید شروع می‌شود.
 */
export function PartnersCard({ netProfit }: { netProfit: number }) {
  const [showAdd, setShowAdd] = useState(false)
  const [action, setAction] = useState<{ kind: 'capital' | 'withdraw'; id: number; name: string } | null>(null)
  const [historyFor, setHistoryFor] = useState<string | null>(null)
  const [showSettle, setShowSettle] = useState(false)
  const [name, setName] = useState('')
  const [share, setShare] = useState('')
  const [capitalStr, setCapitalStr] = useState('')
  const [cashNow, setCashNow] = useState(false)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const partners = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted && x.kind === 'partner').toArray(), [])
  const movements = useLiveQuery(() => db.cashMovements.filter((m) => !m.deleted).toArray(), [])
  const nw = useLiveQuery(() => netWorth(), [])
  const yearStart = useLiveQuery(async () => Number((await db.settings.get('partnershipStart'))?.value ?? 0), [])

  const stockValue = nw?.stock ?? 0
  const cash = nw?.cash ?? 0
  const receivables = nw?.receivables ?? 0
  const customerCredits = nw?.customerCredits ?? 0
  // قرض اشخاص هم مثل قرض تأمین‌کننده از دارایی کم می‌شود
  const payables = (nw?.payables ?? 0) + (nw?.loans ?? 0) + (nw?.unpaidLanding ?? 0)
  const supplierCredits = nw?.supplierCredits ?? 0
  const assets = nw?.assets ?? 0

  const start = yearStart ?? 0
  // هر پول که از تجارت بیرون رفته: برداشت، مصرف خانه، مصرف شخصی
  const DRAW_TYPES = ['withdrawal', 'homeExpense', 'personalExpense']
  const draws = movements?.filter((m) => DRAW_TYPES.includes(m.type) && m.date >= start) ?? []
  const wSince = (n: string) => draws.filter((m) => m.partnerName === n).reduce((s, m) => s - m.amount, 0)
  const capSum = partners?.reduce((s, p) => s + (p.capital ?? 0), 0) ?? 0
  // برداشت‌های بی‌نام (مصرف خانه/شخصی مالک) هم باید در مفاد سال حساب شود
  const untaggedDraw = draws.filter((m) => !m.partnerName).reduce((s, m) => s - m.amount, 0)
  const wSum = (partners?.reduce((s, p) => s + wSince(p.name), 0) ?? 0) + untaggedDraw
  const yearProfit = assets + wSum - capSum
  const shareSum = partners?.reduce((s, p) => s + (p.share ?? 0), 0) ?? 0

  // سرمایهٔ باقی‌مانده = دارایی خالص منهای سرمایهٔ شرکای ثبت‌شده.
  // اگر مجموع سرمایه‌ها از دارایی بیشتر شود، مفاد روز اول به‌غلط منفی می‌شود.
  const remainingCapital = afn(assets - capSum)
  const suggested = Math.max(0, remainingCapital)
  const overCapital = capSum > assets + 0.5

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-700">🤝 شرکا و سرمایه</p>
      {start > 0 && <p className="mb-2 text-xs text-slate-400">شروع سال شراکت: {fmtDateShort(start)}</p>}
      {partners?.length === 0 && (
        <div className="mb-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <p className="mb-1 font-bold">شریکی ثبت نشده.</p>
          <p>
            برای تعیین سهم‌ها اول همهٔ حساب‌ها (گدام، صندوق، طلب، قرض) را در اپ وارد کنید، بعد از
            <b> «تنظیمات ← 🎬 شروع سال مالی» </b>
            سهم‌ها را یک‌بار تعیین کنید. آنجا فیصدی و سرمایهٔ خودتان خودکار حساب می‌شود.
          </p>
        </div>
      )}
      {partners?.map((p) => (
        <div key={p.id} className="mb-2 rounded-xl bg-slate-50 p-3">
          <div className="flex items-center justify-between">
            <p className="font-bold text-slate-800">
              {p.name} <span className="text-xs font-normal text-teal-700">({fmtNum(p.share ?? 0)}٪)</span>
            </p>
            <p className="text-sm font-bold text-teal-700">سرمایه: {fmtMoney(p.capital ?? 0)}</p>
          </div>
          <p className="mt-1 text-xs text-slate-500">برداشت/مصرف امسال: {fmtMoney(wSince(p.name))}</p>
          <div className="mt-2 flex gap-4">
            <button
              className="text-xs font-bold text-teal-700"
              onClick={() => {
                setAction({ kind: 'capital', id: p.id!, name: p.name })
                setAmount(''); setNote(''); setError('')
              }}
            >
              ＋ سرمایه‌گذاری
            </button>
            <button
              className="text-xs font-bold text-amber-700"
              onClick={() => {
                setAction({ kind: 'withdraw', id: p.id!, name: p.name })
                setAmount(''); setNote(''); setError('')
              }}
            >
              برداشت/مصرف
            </button>
            <button className="mr-auto text-xs text-slate-500" onClick={() => setHistoryFor(p.name)}>
              جزئیات ←
            </button>
          </div>
        </div>
      ))}
      {overCapital && (
        <div className="mb-2 rounded-xl bg-red-50 p-3 text-sm text-red-800">
          <p className="mb-1 font-bold">⚠️ مجموع سرمایه‌ها از دارایی خالص بیشتر است</p>
          <p>
            مجموع سرمایه‌ها: <b>{fmtMoney(capSum)}</b> — ولی دارایی خالص دکان: <b>{fmtMoney(assets)}</b>. به همین سبب
            «فایده/نقص سال» به‌غلط <b>{fmtMoney(capSum - assets)}</b> نقص نشان می‌دهد.
          </p>
          <p className="mt-1">
            سرمایهٔ شریک = همان پولی که داده (دست نزنید). فقط <b>سرمایهٔ خودتان (مالک)</b> را اصلاح کنید — سرمایهٔ مالک
            یعنی باقی‌ماندهٔ دارایی.
          </p>
          <div className="mt-2">
            {partners?.map((p) => {
              const correct = afn(assets - (capSum - (p.capital ?? 0)))
              if (correct === (p.capital ?? 0)) return null
              return (
                <button
                  key={p.id}
                  className="mb-1 w-full rounded-lg bg-white px-3 py-2 text-right text-xs font-bold text-red-700"
                  onClick={async () => {
                    if (confirm(`سرمایهٔ «${p.name}» از ${fmtMoney(p.capital ?? 0)} به ${fmtMoney(correct)} اصلاح شود؟`))
                      try {
                        await setPartnerCapital(p.id!, correct)
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e))
                      }
                  }}
                >
                  اصلاح سرمایهٔ «{p.name}» ← {fmtMoney(correct)}
                </button>
              )
            })}
          </div>
        </div>
      )}
      {(partners?.length ?? 0) > 0 && shareSum !== 100 && (
        <p className="mb-2 text-xs font-bold text-red-600">⚠️ مجموع فیصدی‌ها {fmtNum(shareSum)}٪ است — باید ۱۰۰٪ شود.</p>
      )}
      <div className="flex gap-2">
        <button onClick={() => { setShowAdd(true); setName(''); setShare(''); setCapitalStr('') }} className="flex-1 rounded-xl border border-dashed border-teal-600 py-2 text-sm font-bold text-teal-700">
          ＋ شریک جدید (در میان سال)
        </button>
        {(partners?.length ?? 0) > 0 && (
          <button onClick={() => setShowSettle(true)} className="flex-1 rounded-xl bg-teal-700 py-2 text-sm font-bold text-white">
            📒 حساب سال شراکت
          </button>
        )}
      </div>
      <label className="mt-2 flex items-center justify-between text-xs text-slate-500">
        تاریخ شروع سال شراکت
        <input
          type="date"
          className="rounded-lg border border-slate-300 px-2 py-1"
          value={start ? toDateInput(start) : ''}
          onChange={(e) => void db.settings.put({ key: 'partnershipStart', value: e.target.value ? fromDateInput(e.target.value) : 0 })}
        />
      </label>

      {showAdd && (
        <Modal title="شریک جدید در میان سال" onClose={() => setShowAdd(false)}>
          <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
            این فورم فقط برای کسی است که <b>در میان سال</b> با پول نو شریک می‌شود. اگر تازه می‌خواهید سال مالی را شروع
            کنید، این را ببندید و به <b>«تنظیمات ← 🎬 شروع سال مالی»</b> بروید — آنجا سهم و سرمایهٔ خودتان خودکار حساب
            می‌شود.
          </p>
          <Field label="نام شریک *">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="فیصدی سهم از مفاد *">
            <input className={inputCls} inputMode="numeric" value={share} onChange={(e) => setShare(e.target.value)} placeholder="مثلاً ۴۰" />
          </Field>
          <Field label="سرمایهٔ اول سال *">
            <input className={inputCls} inputMode="numeric" value={capitalStr} onChange={(e) => setCapitalStr(e.target.value)} />
          </Field>
          <button className="mb-2 text-xs font-bold text-teal-700" onClick={() => setCapitalStr(String(suggested))}>
            باقی‌ماندهٔ دارایی (دارایی خالص − سرمایهٔ شرکای ثبت‌شده) = {fmtMoney(suggested)}
          </button>
          {parseNum(capitalStr) > remainingCapital + 0.5 && !cashNow && (
            <p className="mb-2 rounded-xl bg-red-50 p-2 text-xs font-bold text-red-700">
              ⚠️ این مبلغ از باقی‌ماندهٔ دارایی ({fmtMoney(remainingCapital)}) بیشتر است. اگر پول نو نمی‌آورد، مفاد سال
              به‌غلط {fmtMoney(parseNum(capitalStr) - remainingCapital)} نقص نشان می‌دهد. اگر پول نو می‌آورد، گزینهٔ زیر را
              علامت بزنید.
            </p>
          )}
          <label className="mb-2 flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={cashNow} onChange={(e) => setCashNow(e.target.checked)} />
            این سرمایه نقد است و حالا وارد صندوق شود (برای شریک نقدی)
          </label>
          <p className="mb-3 text-xs text-slate-400">این عدد قید می‌شود و با خرید و فروش تغییر نمی‌کند. برای <b>شروع سال</b> از «تنظیمات ← شروع سال مالی» استفاده کنید — آنجا سرمایهٔ شما خودکار حساب می‌شود تا مفاد روز اول صفر بماند. این فورم برای شریکی است که <b>در میان سال</b> با پول نو می‌آید.</p>
          <PrimaryBtn
            disabled={
              !name.trim() ||
              parseNum(share) <= 0 ||
              parseNum(capitalStr) <= 0 ||
              (parseNum(capitalStr) > remainingCapital + 0.5 && !cashNow)
            }
            onClick={async () => {
              try {
                await addPartner({
                  name,
                  capital: parseNum(capitalStr),
                  share: parseNum(share),
                  bringsCash: cashNow
                })
                if (!start) await db.settings.put({ key: 'partnershipStart', value: Date.now() })
                setCashNow(false)
                setShowAdd(false)
                setError('')
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ذخیره
          </PrimaryBtn>
        </Modal>
      )}

      {action && (
        <Modal title={action.kind === 'capital' ? `سرمایه‌گذاری — ${action.name}` : `برداشت/مصرف — ${action.name}`} onClose={() => setAction(null)}>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label={action.kind === 'capital' ? 'یادداشت (اختیاری)' : 'بابت چه؟ (جزئیات)'}>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={action.kind === 'withdraw' ? 'مثلاً مصرف خانه، دوا...' : ''} />
          </Field>
          {action.kind === 'withdraw' && (
            <p className="mb-2 text-xs text-slate-400">از صندوق کم می‌شود، در مصارف تجارت نمی‌آید و آخر سال از سهم خودش منفی می‌شود.</p>
          )}
          {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                if (action.kind === 'capital') await addCapital(action.id, action.name, parseNum(amount), note)
                else await addPartnerWithdrawal(action.name, parseNum(amount), note)
                setAction(null)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت
          </PrimaryBtn>
        </Modal>
      )}

      {historyFor && (
        <Modal title={`جزئیات — ${historyFor}`} onClose={() => setHistoryFor(null)}>
          {(movements ?? [])
            .filter((m) => m.partnerName === historyFor)
            .sort((a, b) => b.date - a.date)
            .map((m) => (
              <div key={m.id} className="mb-1 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
                <span>
                  <b>{m.type === 'capitalIn' ? 'سرمایه‌گذاری' : 'برداشت/مصرف'}</b>
                  {m.note && <span className="text-slate-500"> — {m.note}</span>}
                  <span className="block text-xs text-slate-400">{fmtDate(m.date)}</span>
                </span>
                <span className={`font-bold ${m.amount >= 0 ? 'text-teal-700' : 'text-amber-700'}`}>{fmtMoney(Math.abs(m.amount))}</span>
              </div>
            ))}
          {!(movements ?? []).some((m) => m.partnerName === historyFor) && <p className="text-sm text-slate-400">سندی ثبت نشده.</p>}
        </Modal>
      )}

      {showSettle && partners && (
        <SettleModal
          partners={partners}
          stockValue={stockValue}
          cash={cash}
          receivables={receivables}
          supplierCredits={supplierCredits}
          payables={payables}
          customerCredits={customerCredits}
          wSince={wSince}
          wSum={wSum}
          yearProfit={yearProfit}
          onClose={() => setShowSettle(false)}
        />
      )}
      {false && netProfit}
    </Card>
  )
}

/** حساب آخر سال: نمایش فورمول کامل، سهم هر شریک و بستن سال */
function SettleModal({
  partners,
  stockValue,
  cash,
  receivables,
  supplierCredits,
  payables,
  customerCredits,
  wSince,
  wSum,
  yearProfit,
  onClose
}: {
  partners: import('../../db').Supplier[]
  stockValue: number
  cash: number
  receivables: number
  supplierCredits: number
  payables: number
  customerCredits: number
  wSince: (n: string) => number
  wSum: number
  yearProfit: number
  onClose: () => void
}) {
  const [choices, setChoices] = useState<Record<number, SettleChoice>>({})
  const [payCash, setPayCash] = useState(true)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const shareOf = (p: import('../../db').Supplier) => Math.round((yearProfit * (p.share ?? 0)) / 100)
  const payableOf = (p: import('../../db').Supplier) => shareOf(p) - wSince(p.name)

  async function closeYear() {
    try {
      await settleYear({
        choices,
        payCash,
        yearProfit,
        withdrawnBy: wSince
      })
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (done)
    return (
      <Modal title="📒 حساب سال شراکت" onClose={onClose}>
        <p className="py-6 text-center text-lg font-bold text-teal-700">✅ سال بسته شد و سال جدید شروع شد.</p>
        <PrimaryBtn onClick={onClose}>بستن</PrimaryBtn>
      </Modal>
    )

  return (
    <Modal title="📒 حساب سال شراکت" onClose={onClose}>
      <p className="mb-2 text-xs text-slate-500">اول «شمارش گدام» و «تصفیه صندوق» را انجام دهید تا اعداد با واقعیت برابر باشند.</p>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
        <Row label="ارزش جنس گدام" value={fmtMoney(stockValue)} />
        <Row label="پول صندوق" value={fmtMoney(cash)} />
        <Row label="طلب از مشتریان" value={fmtMoney(receivables)} />
        {supplierCredits > 0 && <Row label="طلب ما از تأمین‌کنندگان (پیشکی)" value={fmtMoney(supplierCredits)} />}
        <Row label="قرض ما (تأمین‌کننده/صراف)" value={fmtMoney(payables)} red />
        {customerCredits > 0 && <Row label="پیش‌پرداخت مشتریان (قرض ما)" value={fmtMoney(customerCredits)} red />}
        <Row label="برداشت‌ها و مصارف خانه/شخصی در سال" value={fmtMoney(wSum)} />
        <Row label="مجموع سرمایه‌ها" value={fmtMoney(partners.reduce((s, p) => s + (p.capital ?? 0), 0))} red />
        <Row label="فایده/نقص خالص سال" value={fmtMoney(yearProfit)} bold teal={yearProfit >= 0} red={yearProfit < 0} />
      </div>
      {partners.map((p) => {
        const pay = payableOf(p)
        return (
          <div key={p.id} className="mb-2 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between font-bold text-slate-800">
              <span>
                {p.name} ({fmtNum(p.share ?? 0)}٪)
              </span>
              <span className={pay >= 0 ? 'text-teal-700' : 'text-red-600'}>قابل پرداخت: {fmtMoney(pay)}</span>
            </div>
            <p className="text-xs text-slate-500">
              سهم: {fmtMoney(shareOf(p))} − برداشت‌ها: {fmtMoney(wSince(p.name))} · سرمایه: {fmtMoney(p.capital ?? 0)}
            </p>
            <select
              className={inputCls + ' mt-2'}
              value={choices[p.id!] ?? 'take'}
              onChange={(e) => setChoices((c) => ({ ...c, [p.id!]: e.target.value as SettleChoice }))}
            >
              <option value="take">فایده را برمی‌دارد (سرمایه می‌ماند)</option>
              <option value="reinvest">فایده دوباره سرمایه‌گذاری شود</option>
              <option value="exit">خروج کامل (سرمایه + فایده)</option>
            </select>
          </div>
        )
      })}
      <label className="mb-3 flex items-center gap-2 text-sm">
        <input type="checkbox" className="h-4 w-4" checked={payCash} onChange={(e) => setPayCash(e.target.checked)} />
        پرداخت‌ها از صندوق ثبت شود
      </label>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={() => void closeYear()}>✓ بستن سال و شروع سال جدید</PrimaryBtn>
    </Modal>
  )
}

export default PartnersCard
