import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { addPayment, addOpeningDebt } from '../../lib/ops'
import { fmtMoney, parseNum } from '../../lib/format'
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
