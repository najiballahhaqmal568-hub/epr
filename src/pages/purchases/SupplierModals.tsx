import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Payment } from '../../db'
import {
  addPayment,
  addOpeningDebt,
  correctSupplierPayment,
  previewSupplierPaymentCorrection,
  type SupplierPaymentCorrectionInput,
  type SupplierPaymentCorrectionPreview
} from '../../lib/ops'
import { fmtMoney, parseNum, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'

export function NewSupplierModal({ kind, onClose }: { kind: 'supplier' | 'sarraf'; onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [openingDebt, setOpeningDebt] = useState('')
  return (
    <Modal title={kind === 'sarraf' ? 'صراف جدید' : 'تأمین‌کننده جدید'} onClose={onClose}>
      <Field label="نام *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="شماره تلفن">
        <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="قرض قبلی ما (اختیاری)">
        <input className={inputCls} inputMode="numeric" value={openingDebt} onChange={(e) => setOpeningDebt(e.target.value)} placeholder="۰" />
      </Field>
      {parseNum(openingDebt) > 0 && (
        <p className="-mt-2 mb-3 text-xs text-slate-400">قرض خریدهای گذشته (پیش از اپ) — در خرید، مفاد و صندوق حساب نمی‌شود.</p>
      )}
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          const id = (await db.suppliers.add({ name: name.trim(), phone: phone.trim(), balance: 0, kind })) as number
          const debt = parseNum(openingDebt)
          if (debt > 0) await addOpeningDebt('supplier', id, name.trim(), debt)
          onClose()
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

export function PaySupplierModal({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const supplier = useLiveQuery(() => db.suppliers.get(supplierId), [supplierId])
  const sarrafs = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && s.kind === 'sarraf' && s.id !== supplierId).toArray(),
    [supplierId]
  )
  const lenders = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && s.kind === 'lender' && s.id !== supplierId).toArray(),
    [supplierId]
  )
  const [amount, setAmount] = useState('')
  const [via, setVia] = useState<'cash' | 'sarraf' | 'mixed' | 'lender'>('cash')
  const [sarrafId, setSarrafId] = useState<number | ''>('')
  const [cashPart, setCashPart] = useState('')
  const [lenderId, setLenderId] = useState<number | ''>('')
  const [error, setError] = useState('')
  if (!supplier) return null
  const isSarraf = supplier.kind === 'sarraf'
  return (
    <Modal title={`پرداخت به ${supplier.name}`} onClose={onClose}>
      <p className="mb-2 text-slate-600">
        {supplier.balance > 0
          ? `قرض فعلی: ${fmtMoney(supplier.balance)}`
          : supplier.balance < 0
            ? `طلب فعلی ما: ${fmtMoney(-supplier.balance)}`
            : 'حساب تصفیه است'}
      </p>
      <Field label="مبلغ پرداختی">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {parseNum(amount) > Math.max(0, supplier.balance) && (
        <p className="mb-2 text-xs font-bold text-amber-700">
          💡 {fmtMoney(parseNum(amount) - Math.max(0, supplier.balance))} پیشکی ثبت می‌شود — {supplier.name} به شما قرضدار می‌شود.
        </p>
      )}
      {!isSarraf && ((sarrafs?.length ?? 0) > 0 || (lenders?.length ?? 0) > 0) && (
        <Field label="طریق پرداخت">
          <select className={inputCls} value={via} onChange={(e) => setVia(e.target.value as 'cash' | 'sarraf' | 'mixed' | 'lender')}>
            <option value="cash">نقد از صندوق</option>
            {(sarrafs?.length ?? 0) > 0 && <option value="sarraf">حواله از طریق صراف</option>}
            {(sarrafs?.length ?? 0) > 0 && <option value="mixed">ترکیبی — صندوق و صراف</option>}
            {(lenders?.length ?? 0) > 0 && <option value="lender">قرض‌دهنده مستقیم فروشنده را پرداخت کرد</option>}
          </select>
        </Field>
      )}
      {(via === 'sarraf' || via === 'mixed') && (
        <>
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
          {via === 'mixed' ? (
            <>
              <Field label="مبلغ از صندوق *">
                <input className={inputCls} inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value)} />
              </Field>
              {parseNum(amount) > 0 && parseNum(cashPart) > 0 && parseNum(cashPart) < parseNum(amount) && (
                <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
                  <div className="flex justify-between"><span>از صندوق</span><b>{fmtMoney(parseNum(cashPart))}</b></div>
                  <div className="mt-1 flex justify-between text-amber-700"><span>از صراف</span><b>{fmtMoney(parseNum(amount) - parseNum(cashPart))}</b></div>
                </div>
              )}
              <p className="mb-2 text-xs text-amber-600">سهم صندوق کم می‌شود؛ سهم صراف ابتدا از طلب شما نزد او کم و فقط مازاد آن قرض می‌شود.</p>
            </>
          ) : (
            <p className="mb-2 text-xs text-amber-600">پول از صندوق کم نمی‌شود؛ مبلغ ابتدا از طلب شما نزد صراف کم و فقط مازاد آن قرض می‌شود.</p>
          )}
        </>
      )}
      {via === 'lender' && (
        <>
          <Field label="قرض‌دهنده *">
            <select className={inputCls} value={lenderId} onChange={(e) => setLenderId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {lenders?.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>
          <p className="mb-2 text-xs text-amber-600">صندوق تغییر نمی‌کند؛ قرض فروشنده کم و قرض شما به این شخص زیاد می‌شود.</p>
        </>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn
        disabled={
          parseNum(amount) <= 0 ||
          ((via === 'sarraf' || via === 'mixed') && !sarrafId) ||
          (via === 'mixed' && (parseNum(cashPart) <= 0 || parseNum(cashPart) >= parseNum(amount))) ||
          (via === 'lender' && !lenderId)
        }
        onClick={async () => {
          try {
            const sf = via === 'sarraf' || via === 'mixed' ? sarrafs?.find((s) => s.id === sarrafId) : undefined
            const lender = via === 'lender' ? lenders?.find((l) => l.id === lenderId) : undefined
            const total = parseNum(amount)
            const sarrafAmount = via === 'mixed' ? total - parseNum(cashPart) : total
            await addPayment({
              date: Date.now(),
              partyType: 'supplier',
              partyId: supplierId,
              partyName: supplier.name,
              amount: total,
              ...(sf
                ? { via: 'sarraf' as const, sarrafId: sf.id!, sarrafName: sf.name, sarrafAmount }
                : lender
                  ? { via: 'lender' as const, lenderId: lender.id!, lenderName: lender.name }
                  : { via: 'cash' as const })
            })
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        ثبت پرداخت
      </PrimaryBtn>
    </Modal>
  )
}

export function CorrectSupplierPaymentModal({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const supplier = useLiveQuery(() => db.suppliers.get(payment.partyId), [payment.partyId])
  const sarrafs = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && s.kind === 'sarraf' && s.id !== payment.partyId).toArray(),
    [payment.partyId]
  )
  const lenders = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && s.kind === 'lender' && s.id !== payment.partyId).toArray(),
    [payment.partyId]
  )
  const oldSarrafAmount = payment.via === 'sarraf' ? (payment.sarrafAmount ?? payment.amount) : 0
  const oldCashAmount = Math.max(0, payment.amount - oldSarrafAmount)
  const initialVia: 'cash' | 'sarraf' | 'mixed' | 'lender' =
    payment.via === 'sarraf' ? (oldCashAmount > 0 ? 'mixed' : 'sarraf') : payment.via === 'lender' ? 'lender' : 'cash'
  const [amount, setAmount] = useState(String(payment.amount))
  const [dateStr, setDateStr] = useState(toDateInput(payment.date))
  const [via, setVia] = useState<'cash' | 'sarraf' | 'mixed' | 'lender'>(initialVia)
  const [sarrafId, setSarrafId] = useState<number | ''>(payment.sarrafId ?? '')
  const [cashPart, setCashPart] = useState(String(oldCashAmount || ''))
  const [lenderId, setLenderId] = useState<number | ''>(payment.lenderId ?? '')
  const [note, setNote] = useState(payment.note ?? '')
  const [reason, setReason] = useState('')
  const [preview, setPreview] = useState<SupplierPaymentCorrectionPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const total = parseNum(amount)
  const cash = parseNum(cashPart)
  const formValid =
    total > 0 &&
    Boolean(dateStr) &&
    Boolean(reason.trim()) &&
    ((via !== 'sarraf' && via !== 'mixed') || Boolean(sarrafId)) &&
    (via !== 'mixed' || (cash > 0 && cash < total)) &&
    (via !== 'lender' || Boolean(lenderId))

  const input = (): SupplierPaymentCorrectionInput => ({
    date: fromDateInput(dateStr),
    amount: total,
    via: via === 'mixed' ? 'sarraf' : via,
    ...(via === 'sarraf' || via === 'mixed'
      ? { sarrafId: Number(sarrafId), sarrafAmount: via === 'mixed' ? total - cash : total }
      : {}),
    ...(via === 'lender' ? { lenderId: Number(lenderId) } : {}),
    note,
    box: payment.box,
    reason
  })

  useEffect(() => {
    let cancelled = false
    if (!formValid || !payment.id) {
      setPreview(null)
      setLoading(false)
      return () => {
        cancelled = true
      }
    }
    setLoading(true)
    setError('')
    void previewSupplierPaymentCorrection(payment.id, input())
      .then((next) => {
        if (!cancelled) setPreview(next)
      })
      .catch((e) => {
        if (!cancelled) {
          setPreview(null)
          setError(e instanceof Error ? e.message : String(e))
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [amount, cashPart, dateStr, lenderId, note, payment.box, payment.id, reason, sarrafId, via, formValid])

  if (!supplier) return null
  const hasNegativeCash = preview?.cash.some((row) => row.after < 0) ?? false
  return (
    <Modal title={`اصلاح پرداخت — ${supplier.name}`} onClose={onClose}>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">
        <p className="font-bold text-amber-900">سند فعلی</p>
        <p className="mt-1 text-slate-700">مجموع: {fmtMoney(payment.amount)}</p>
        {payment.via === 'sarraf' ? (
          <p className="text-xs text-slate-500">
            صندوق {fmtMoney(oldCashAmount)} · صراف {fmtMoney(oldSarrafAmount)} ({payment.sarrafName})
          </p>
        ) : payment.via === 'lender' ? (
          <p className="text-xs text-slate-500">پرداخت مستقیم توسط {payment.lenderName}</p>
        ) : (
          <p className="text-xs text-slate-500">تمام مبلغ از صندوق</p>
        )}
      </div>

      <Field label="مبلغ درست *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="تاریخ درست *">
        <input className={inputCls} type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
      </Field>
      <Field label="طریق درست پرداخت *">
        <select className={inputCls} value={via} onChange={(e) => setVia(e.target.value as typeof via)}>
          <option value="cash">نقد از صندوق</option>
          {(sarrafs?.length ?? 0) > 0 && <option value="sarraf">همه از طریق صراف</option>}
          {(sarrafs?.length ?? 0) > 0 && <option value="mixed">ترکیبی — صندوق و صراف</option>}
          {(lenders?.length ?? 0) > 0 && <option value="lender">قرض‌دهنده مستقیم فروشنده را پرداخت کرد</option>}
        </select>
      </Field>

      {(via === 'sarraf' || via === 'mixed') && (
        <>
          <Field label="صراف درست *">
            <select className={inputCls} value={sarrafId} onChange={(e) => setSarrafId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {sarrafs?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          {via === 'mixed' && (
            <Field label="سهم درست صندوق *">
              <input className={inputCls} inputMode="numeric" value={cashPart} onChange={(e) => setCashPart(e.target.value)} />
            </Field>
          )}
        </>
      )}
      {via === 'lender' && (
        <Field label="قرض‌دهندهٔ درست *">
          <select className={inputCls} value={lenderId} onChange={(e) => setLenderId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">انتخاب کنید...</option>
            {lenders?.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </Field>
      )}
      <Field label="یادداشت سند">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Field label="دلیل اصلاح *">
        <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثلاً مبلغ یا سهم صندوق اشتباه بود" />
      </Field>

      {loading && <p className="mb-3 text-center text-sm text-slate-400">در حال محاسبهٔ اثر اصلاح…</p>}
      {preview && (
        <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="mb-2 font-bold text-slate-700">اثر قبل و بعد</p>
          {preview.accounts.map((row) => (
            <div key={`party-${row.partyId}`} className="mb-1 flex items-center justify-between gap-2">
              <span>{row.partyName}</span>
              <span className="font-bold">فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {preview.cash.map((row) => (
            <div key={`cash-${row.box}`} className={`mb-1 flex items-center justify-between gap-2 ${row.after < 0 ? 'text-red-600' : ''}`}>
              <span>صندوق «{row.box}»</span>
              <span className="font-bold">فعلی {fmtMoney(row.before)} · بعد {fmtMoney(row.after)}</span>
            </div>
          ))}
          {hasNegativeCash && <p className="mt-2 font-bold text-red-600">پول صندوق برای این اصلاح کافی نیست.</p>}
        </div>
      )}
      <p className="mb-3 text-xs text-slate-500">
        سند قبلی پاک نمی‌شود؛ با علامت «اصلاح‌شده» نگه داشته می‌شود و سند درست جای آن ثبت می‌گردد.
      </p>
      {error && <p className="mb-2 text-sm font-bold text-red-600">{error}</p>}
      <div className="sticky -bottom-8 -mx-4 -mb-8 border-t border-slate-100 bg-white px-4 pb-8 pt-3">
        <PrimaryBtn
          disabled={!formValid || !preview || loading || saving || hasNegativeCash}
          onClick={async () => {
            if (!payment.id) return
            try {
              setSaving(true)
              setError('')
              await correctSupplierPayment(payment.id, input())
              onClose()
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            } finally {
              setSaving(false)
            }
          }}
        >
          {saving ? 'در حال ثبت…' : 'ثبت اصلاح سند'}
        </PrimaryBtn>
      </div>
    </Modal>
  )
}
