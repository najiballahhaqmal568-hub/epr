import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PurchaseLine, type Product, type Supplier, type ReturnLine } from '../db'
import { addPurchase, addPayment, addSupplierReturn } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

export default function Purchases() {
  const [view, setView] = useState<'history' | 'suppliers'>('history')
  const [showNew, setShowNew] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [payingSupplier, setPayingSupplier] = useState<number | null>(null)
  const [returningTo, setReturningTo] = useState<Supplier | null>(null)

  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().filter((p) => !p.deleted).limit(100).toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">خرید</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('history')} className={`flex-1 rounded-xl py-2 font-bold ${view === 'history' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
          خریدها
        </button>
        <button onClick={() => setView('suppliers')} className={`flex-1 rounded-xl py-2 font-bold ${view === 'suppliers' ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`}>
          تأمین‌کنندگان
        </button>
      </div>

      {view === 'history' && (
        <>
          {purchases?.length === 0 && <Empty text="هنوز خریدی ثبت نشده." />}
          {purchases?.map((p) => {
            const remainder = p.total - p.paid
            return (
              <Card key={p.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">{p.supplierName}</p>
                    <p className="text-xs text-slate-500">{fmtDate(p.date)}</p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-teal-700">{fmtMoney(p.total)}</p>
                    {remainder > 0 && <p className="text-xs text-red-600">باقی: {fmtMoney(remainder)}</p>}
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {p.lines.map((l) => `${l.productName} ${l.size} ×${fmtNum(l.qty)}`).join('، ')}
                </p>
              </Card>
            )
          })}
          <Fab onClick={() => setShowNew(true)} label="خرید جدید" />
        </>
      )}

      {view === 'suppliers' && (
        <>
          {suppliers?.length === 0 && <Empty text="تأمین‌کننده‌ای ثبت نشده." />}
          {suppliers?.map((s) => (
            <Card key={s.id}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">{s.name}</p>
                  {s.phone && <p className="text-sm text-slate-500" dir="ltr">{s.phone}</p>}
                </div>
                <div className="text-left">
                  <p className={`font-bold ${s.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(s.balance)}</p>
                  <p className="text-xs text-slate-400">{s.balance > 0 ? 'قرض ما' : 'تصفیه'}</p>
                </div>
              </div>
              <div className="mt-2 flex gap-4">
                {s.balance > 0 && (
                  <button className="text-sm font-bold text-teal-700" onClick={() => setPayingSupplier(s.id!)}>
                    پرداخت قرض
                  </button>
                )}
                <button className="text-sm font-bold text-amber-700" onClick={() => setReturningTo(s)}>
                  مرجوعی جنس
                </button>
              </div>
            </Card>
          ))}
          <Fab onClick={() => setShowNewSupplier(true)} label="تأمین‌کننده" />
        </>
      )}

      {showNew && <NewPurchaseModal onClose={() => setShowNew(false)} />}
      {showNewSupplier && <NewSupplierModal onClose={() => setShowNewSupplier(false)} />}
      {payingSupplier != null && <PaySupplierModal supplierId={payingSupplier} onClose={() => setPayingSupplier(null)} />}
      {returningTo && <SupplierReturnModal supplier={returningTo} onClose={() => setReturningTo(null)} />}
    </div>
  )
}

function SupplierReturnModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [search, setSearch] = useState('')
  const [reason, setReason] = useState('خرابی جنس')
  const [settlement, setSettlement] = useState<'reduceDebt' | 'cashRefund'>(supplier.balance > 0 ? 'reduceDebt' : 'cashRefund')
  const [error, setError] = useState('')

  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  const amount = lines.reduce((s, l) => s + l.qty * l.unitPrice, 0)

  async function save() {
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    try {
      await addSupplierReturn({
        date: Date.now(),
        kind: 'supplier',
        partyId: supplier.id,
        partyName: supplier.name,
        lines,
        reason,
        settlement,
        amount
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title={`مرجوعی به ${supplier.name}`} onClose={onClose}>
      <Field label="جستجوی جنس">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {matches.length > 0 && (
        <div className="mb-3 overflow-hidden rounded-xl border border-slate-200">
          {matches.map((v) => {
            const p = productMap.get(v.productId)!
            return (
              <button
                key={v.id}
                disabled={v.stockQty <= 0}
                onClick={() => {
                  setLines((ls) => {
                    if (ls.some((l) => l.variantId === v.id)) return ls
                    return [
                      ...ls,
                      { variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: 1, unitPrice: v.purchasePrice, restock: false }
                    ]
                  })
                  setSearch('')
                }}
                className="flex w-full items-center justify-between border-b border-slate-100 bg-white px-3 py-2 text-right last:border-0 active:bg-teal-50 disabled:opacity-40"
              >
                <span>
                  {p.name} — {v.size} {v.color}
                </span>
                <span className="text-sm text-slate-500">{fmtNum(v.stockQty)} موجود</span>
              </button>
            )
          })}
        </div>
      )}

      {lines.map((l, i) => (
        <div key={l.variantId} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
          <div className="flex-1 text-sm">
            <p className="font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <input
              className="mt-1 w-28 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              inputMode="numeric"
              value={l.unitPrice}
              onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unitPrice: parseNum(e.target.value) } : x)))}
            />
            <span className="mr-1 text-xs text-slate-500">قیمت فی جوړه</span>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              −
            </button>
            <span className="w-6 text-center font-bold">{fmtNum(l.qty)}</span>
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              ＋
            </button>
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <Field label="دلیل">
        <select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>
          <option>خرابی جنس</option>
          <option>جنس اشتباه</option>
          <option>کیفیت پایین</option>
          <option>دیگر</option>
        </select>
      </Field>
      <Field label="تصفیه پول">
        <select className={inputCls} value={settlement} onChange={(e) => setSettlement(e.target.value as 'reduceDebt' | 'cashRefund')}>
          <option value="reduceDebt">کم شدن از قرض ما (قرض فعلی: {fmtMoney(supplier.balance)})</option>
          <option value="cashRefund">دریافت نقدی به صندوق</option>
        </select>
      </Field>
      <p className="mb-3 font-bold text-slate-800">مبلغ مرجوعی: {fmtMoney(amount)}</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={!lines.length}>
        ثبت مرجوعی
      </PrimaryBtn>
    </Modal>
  )
}

function NewSupplierModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  return (
    <Modal title="تأمین‌کننده جدید" onClose={onClose}>
      <Field label="نام *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="شماره تلفن">
        <input className={inputCls} dir="ltr" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          await db.suppliers.add({ name: name.trim(), phone: phone.trim(), balance: 0 })
          onClose()
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

function PaySupplierModal({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const supplier = useLiveQuery(() => db.suppliers.get(supplierId), [supplierId])
  const [amount, setAmount] = useState('')
  if (!supplier) return null
  return (
    <Modal title={`پرداخت به ${supplier.name}`} onClose={onClose}>
      <p className="mb-2 text-slate-600">قرض فعلی: {fmtMoney(supplier.balance)}</p>
      <Field label="مبلغ پرداختی">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <PrimaryBtn
        disabled={parseNum(amount) <= 0}
        onClick={async () => {
          await addPayment({
            date: Date.now(),
            partyType: 'supplier',
            partyId: supplierId,
            partyName: supplier.name,
            amount: parseNum(amount)
          })
          onClose()
        }}
      >
        ثبت پرداخت
      </PrimaryBtn>
    </Modal>
  )
}

function NewPurchaseModal({ onClose }: { onClose: () => void }) {
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [paidStr, setPaidStr] = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')

  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])

  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  const paid = paidTouched ? parseNum(paidStr) : total
  const remainder = total - paid

  async function save() {
    if (!supplierId) return setError('تأمین‌کننده را انتخاب کنید')
    if (!lines.length) return setError('حداقل یک جنس اضافه کنید')
    const supplier = suppliers?.find((s) => s.id === supplierId)
    try {
      await addPurchase({
        date: Date.now(),
        supplierId: supplierId as number,
        supplierName: supplier?.name ?? '',
        lines,
        total,
        paid
      })
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Modal title="خرید جدید" onClose={onClose}>
      <Field label="تأمین‌کننده *">
        <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">انتخاب کنید...</option>
          {suppliers?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {suppliers?.length === 0 && <p className="mb-2 text-sm text-amber-600">اول از بخش «تأمین‌کنندگان» یک تأمین‌کننده اضافه کنید.</p>}

      <Field label="جستجوی جنس (از گدام)">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {search.trim() && matches.length === 0 && (
        <p className="mb-2 text-sm text-amber-600">جنس یافت نشد — اول آن را در بخش «گدام» ثبت کنید.</p>
      )}
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
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}>
              −
            </button>
            <span className="w-6 text-center font-bold">{fmtNum(l.qty)}</span>
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: x.qty + 1 } : x)))}>
              ＋
            </button>
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <div className="mt-3 rounded-xl bg-teal-50 p-3">
        <div className="flex justify-between font-bold text-slate-800">
          <span>مجموع</span>
          <span>{fmtMoney(total)}</span>
        </div>
        <Field label="مبلغ پرداختی (نقد)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={paidTouched ? paidStr : String(total)}
            onFocus={() => {
              if (!paidTouched) {
                setPaidTouched(true)
                setPaidStr(String(total))
              }
            }}
            onChange={(e) => setPaidStr(e.target.value)}
          />
        </Field>
        {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض ما): {fmtMoney(remainder)}</p>}
      </div>

      {error && <p className="my-2 text-sm text-red-600">{error}</p>}
      <div className="mt-3">
        <PrimaryBtn onClick={save} disabled={!lines.length || !supplierId}>
          ثبت خرید
        </PrimaryBtn>
      </div>
    </Modal>
  )
}
