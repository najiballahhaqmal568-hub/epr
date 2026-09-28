import { useState } from 'react'
import { fmtNum, fmtMoney, fmtDate } from '../../lib/format'
import { Card, PrimaryBtn } from '../../components/ui'
import { runIntegrityCheck, fixMismatch, type IntegrityReport, type Mismatch } from '../../lib/integrity'
import { accessFlags, db } from '../../db'
import { overpaidSales, type OverpaidSale } from '../../lib/overpaid'

/** کنترل حساب‌ها: مقایسهٔ عددهای ذخیره‌شده با اسناد و اصلاح اختلاف */
function IntegrityCard() {
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [overpaid, setOverpaid] = useState<OverpaidSale[]>([])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function check() {
    setBusy(true)
    setMsg('')
    try {
      setReport(await runIntegrityCheck())
      setOverpaid(overpaidSales(await db.sales.toArray()))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    }
    setBusy(false)
  }

  async function fixAll() {
    if (!report) return
    if (!confirm(`${fmtNum(report.mismatches.length)} عدد برابر جمع اسناد شود؟`)) return
    setBusy(true)
    for (const m of report.mismatches) await fixMismatch(m)
    setReport(await runIntegrityCheck())
    setMsg('اصلاح شد ✓')
    setBusy(false)
  }

  const unit = (m: Mismatch) => (m.kind === 'variant' ? `${fmtNum(m.stored)} → ${fmtNum(m.computed)} جوړه` : `${fmtMoney(m.stored)} → ${fmtMoney(m.computed)}`)
  const kindLabel: Record<Mismatch['kind'], string> = {
    variant: 'موجودی گدام',
    customer: 'قرض مشتری',
    supplier: 'حساب تأمین‌کننده',
    cost: 'قیمت تمام‌شدهٔ جنس'
  }

  return (
    <Card>
      <p className="mb-1 font-bold text-slate-800">🛡️ کنترل حساب‌ها</p>
      <p className="mb-3 text-sm text-slate-500">
        موجودی گدام و قرض‌ها را از روی خودِ اسناد (فروش، خرید، مرجوعی، پرداخت) دوباره حساب می‌کند و با عدد ثبت‌شده مقایسه
        می‌کند. اپ این کار را روزی یک بار خودش انجام می‌دهد؛ اینجا هر وقت خواستید می‌توانید اجرا کنید.
      </p>

      <button
        onClick={() => void check()}
        disabled={busy}
        className="w-full rounded-xl bg-slate-800 py-3 font-bold text-white disabled:opacity-50"
      >
        {busy ? 'در حال کنترل…' : 'اجرای کنترل'}
      </button>

      {msg && <p className="mt-2 text-sm font-bold text-teal-700">{msg}</p>}

      {report && (
        <div className="mt-3">
          <p className="text-xs text-slate-400">
            کنترل‌شده: {fmtNum(report.variants)} سایز و {fmtNum(report.parties)} حساب — {fmtDate(report.checkedAt)}
          </p>

          {report.mismatches.length === 0 ? (
            <p className="mt-2 rounded-xl bg-teal-50 p-3 text-center font-bold text-teal-800">
              ✅ همه چیز درست است — هر عدد با اسناد جور می‌آید
            </p>
          ) : (
            <>
              <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-sm font-bold text-amber-800">
                ⚠️ {fmtNum(report.mismatches.length)} عدد با اسناد نمی‌خواند
              </p>
              {report.mismatches.map((m) => (
                <div key={`${m.kind}${m.id}`} className="mt-2 rounded-xl bg-slate-50 p-2.5 text-sm">
                  <p className="font-bold text-slate-800">{m.name}</p>
                  <p className="text-xs text-slate-500">{kindLabel[m.kind]}</p>
                  <p className="mt-1 text-slate-700">{unit(m)}</p>
                </div>
              ))}
              {!accessFlags.readOnly && (
                <div className="mt-3">
                  <PrimaryBtn onClick={() => void fixAll()} disabled={busy}>
                    اصلاح همه (عدد برابر اسناد شود)
                  </PrimaryBtn>
                  <p className="mt-1 text-xs text-slate-400">
                    اگر جنس واقعاً کم یا زیاد شده (مثلاً گم شده)، به‌جای این از «شمارش گدام» استفاده کنید تا سند تعدیل ثبت شود.
                  </p>
                </div>
              )}
            </>
          )}
          {overpaid.length > 0 && (
            <section aria-label="فروش با پول اضافه" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-bold">
                {fmtNum(overpaid.length)} فروش قدیمی پول بیشتر از مجموع ثبت کرده — صندوق {fmtMoney(overpaid.reduce((sum, o) => sum + o.extra, 0))} بیشتر نشان داده است
              </p>
              <p className="mt-1 text-xs">
                پیش از این اصلاح، وقتی مشتری نوت بزرگ‌تر می‌داد، تمام نوت در صندوق ثبت می‌شد. اگر بعد از این تاریخ‌ها پول صندوق را شمرده‌اید، اختلاف از قبل اصلاح شده است؛ اگر نه، «شمارش نقد» را بزنید.
              </p>
              {overpaid.slice(0, 20).map((o) => (
                <p key={o.id ?? o.date} className="mt-1 flex justify-between gap-2 text-xs">
                  <span>{fmtDate(o.date)} · {o.customerName ?? 'مشتری نقدی'}</span>
                  <span>مجموع {fmtMoney(o.total)} · ثبت‌شده {fmtMoney(o.paid)} · اضافه {fmtMoney(o.extra)}</span>
                </p>
              ))}
            </section>
          )}
        </div>
      )}
    </Card>
  )
}

export default IntegrityCard
