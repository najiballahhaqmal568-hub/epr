import { useState } from 'react'
import { fmtNum, fmtMoney, fmtDate } from '../../lib/format'
import { Card, PrimaryBtn } from '../../components/ui'
import { runIntegrityCheck, fixMismatch, type IntegrityReport, type Mismatch } from '../../lib/integrity'
import { accessFlags } from '../../db'

/** کنترل حساب‌ها: مقایسهٔ عددهای ذخیره‌شده با اسناد و اصلاح اختلاف */
function IntegrityCard() {
  const [report, setReport] = useState<IntegrityReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function check() {
    setBusy(true)
    setMsg('')
    try {
      setReport(await runIntegrityCheck())
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
        </div>
      )}
    </Card>
  )
}

export default IntegrityCard
