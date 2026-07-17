import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, makeSku, type Purchase, type PurchaseLine, type Product, type Supplier, type ReturnLine } from '../db'
import { addPurchase, addPayment, addSupplierReturn, receivePurchase, addOpeningDebt } from '../lib/ops'
import { fmtNum, fmtMoney, fmtDate, parseNum } from '../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../components/ui'

function QtyControl({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => onChange(Math.max(1, qty - 1))}>
        −
      </button>
      <input
        className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
        inputMode="numeric"
        value={qty}
        onChange={(e) => onChange(Math.max(1, parseNum(e.target.value) || 1))}
      />
      <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => onChange(qty + 1)}>
        ＋
      </button>
    </div>
  )
}

export default function Purchases() {
  const [view, setView] = useState<'history' | 'suppliers' | 'sarrafs'>('history')
  const [showNew, setShowNew] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState<'supplier' | 'sarraf' | null>(null)
  const [payingSupplier, setPayingSupplier] = useState<number | null>(null)
  const [returningTo, setReturningTo] = useState<Supplier | null>(null)
  const [returningPurchase, setReturningPurchase] = useState<Purchase | null>(null)
  const [detail, setDetail] = useState<Supplier | null>(null)

  const purchases = useLiveQuery(() => db.purchases.orderBy('date').reverse().filter((p) => !p.deleted).limit(100).toArray(), [])
  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])
  const vendors = suppliers?.filter((s) => s.kind !== 'sarraf')
  const sarrafs = suppliers?.filter((s) => s.kind === 'sarraf')

  const tabCls = (v: string) =>
    `flex-1 rounded-xl py-2 text-sm font-bold ${view === v ? 'bg-teal-700 text-white' : 'bg-slate-100 text-slate-600'}`

  return (
    <div className="p-4">
      <h1 className="mb-3 text-xl font-bold text-slate-800">خرید</h1>
      <div className="mb-3 flex gap-2">
        <button onClick={() => setView('history')} className={tabCls('history')}>
          خریدها
        </button>
        <button onClick={() => setView('suppliers')} className={tabCls('suppliers')}>
          تأمین‌کنندگان
        </button>
        <button onClick={() => setView('sarrafs')} className={tabCls('sarrafs')}>
          صراف‌ها
        </button>
      </div>

      {view === 'history' && (
        <>
          {purchases?.length === 0 && <Empty text="هنوز خریدی ثبت نشده." />}
          {purchases?.map((p) => {
            const hawala = p.sarrafAmount ?? 0
            const remainder = p.total - p.paid - hawala
            const pending = p.received === false
            return (
              <Card key={p.id}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-bold text-slate-800">
                      {p.supplierName}
                      {pending && <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">🚚 در راه</span>}
                    </p>
                    <p className="text-xs text-slate-500">{fmtDate(p.date)}</p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-teal-700">{fmtMoney(p.total)}</p>
                    {remainder > 0 && <p className="text-xs text-red-600">باقی: {fmtMoney(remainder)}</p>}
                    {hawala > 0 && (
                      <p className="text-xs text-amber-600">
                        حواله {p.sarrafName}: {fmtMoney(hawala)}
                      </p>
                    )}
                  </div>
                </div>
                <p className="mt-1 text-sm text-slate-600">
                  {p.lines.map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ')).join('، ')}
                </p>
                {pending ? (
                  <button
                    onClick={() => void receivePurchase(p.id!)}
                    className="mt-2 w-full rounded-xl bg-teal-700 py-2 text-sm font-bold text-white"
                  >
                    ✓ جنس رسید — به گدام اضافه شود
                  </button>
                ) : (
                  <button className="mt-1 text-xs font-bold text-amber-700" onClick={() => setReturningPurchase(p)}>
                    مرجوعی به تأمین‌کننده
                  </button>
                )}
              </Card>
            )
          })}
          <Fab onClick={() => setShowNew(true)} label="خرید جدید" />
        </>
      )}

      {view === 'suppliers' && (
        <>
          {vendors?.length === 0 && <Empty text="تأمین‌کننده‌ای ثبت نشده." />}
          {vendors?.map((s) => (
            <Card key={s.id} onClick={() => setDetail(s)}>
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
                  <button
                    className="text-sm font-bold text-teal-700"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPayingSupplier(s.id!)
                    }}
                  >
                    پرداخت قرض
                  </button>
                )}
                <button
                  className="text-sm font-bold text-amber-700"
                  onClick={(e) => {
                    e.stopPropagation()
                    setReturningTo(s)
                  }}
                >
                  مرجوعی جنس
                </button>
                <span className="mr-auto text-xs text-slate-400">جزئیات ←</span>
              </div>
            </Card>
          ))}
          <Fab onClick={() => setShowNewSupplier('supplier')} label="تأمین‌کننده" />
        </>
      )}

      {view === 'sarrafs' && (
        <>
          {sarrafs?.length === 0 && <Empty text="صرافی ثبت نشده. صراف کسی است که برای شما حواله می‌کند." />}
          {sarrafs?.map((s) => (
            <Card key={s.id} onClick={() => setDetail(s)}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800">💱 {s.name}</p>
                  {s.phone && <p className="text-sm text-slate-500" dir="ltr">{s.phone}</p>}
                </div>
                <div className="text-left">
                  <p className={`font-bold ${s.balance > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(s.balance)}</p>
                  <p className="text-xs text-slate-400">{s.balance > 0 ? 'قرض ما به صراف' : 'تصفیه'}</p>
                </div>
              </div>
              <div className="mt-2 flex gap-4">
                {s.balance > 0 && (
                  <button
                    className="text-sm font-bold text-teal-700"
                    onClick={(e) => {
                      e.stopPropagation()
                      setPayingSupplier(s.id!)
                    }}
                  >
                    پرداخت به صراف
                  </button>
                )}
                <span className="mr-auto text-xs text-slate-400">جزئیات ←</span>
              </div>
            </Card>
          ))}
          <Fab onClick={() => setShowNewSupplier('sarraf')} label="صراف جدید" />
        </>
      )}

      {showNew && <NewPurchaseModal onClose={() => setShowNew(false)} />}
      {showNewSupplier && <NewSupplierModal kind={showNewSupplier} onClose={() => setShowNewSupplier(null)} />}
      {payingSupplier != null && <PaySupplierModal supplierId={payingSupplier} onClose={() => setPayingSupplier(null)} />}
      {returningTo && <SupplierReturnModal supplier={returningTo} onClose={() => setReturningTo(null)} />}
      {returningPurchase && <PurchaseReturnModal purchase={returningPurchase} onClose={() => setReturningPurchase(null)} />}
      {detail && <SupplierDetailModal supplier={detail} onClose={() => setDetail(null)} />}
    </div>
  )
}

/** تاریخچهٔ کامل حساب یک تأمین‌کننده یا صراف */
function SupplierDetailModal({ supplier, onClose }: { supplier: Supplier; onClose: () => void }) {
  const [showDebt, setShowDebt] = useState(false)
  const [debtStr, setDebtStr] = useState('')
  const [debtNote, setDebtNote] = useState('')
  const live = useLiveQuery(() => db.suppliers.get(supplier.id!), [supplier.id])
  const purchases = useLiveQuery(
    () => db.purchases.where('supplierId').equals(supplier.id!).filter((p) => !p.deleted).toArray(),
    [supplier.id]
  )
  const hawalas = useLiveQuery(() => db.purchases.filter((p) => !p.deleted && p.sarrafId === supplier.id).toArray(), [supplier.id])
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'supplier' && p.partyId === supplier.id).toArray(),
    [supplier.id]
  )
  const sarrafPays = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.via === 'sarraf' && p.sarrafId === supplier.id).toArray(),
    [supplier.id]
  )
  const returns = useLiveQuery(
    () => db.returns.filter((r) => !r.deleted && r.kind === 'supplier' && r.partyId === supplier.id).toArray(),
    [supplier.id]
  )

  type Ev = { date: number; label: string; sub?: string; amount: number; plus: boolean }
  const events: Ev[] = []
  purchases?.forEach((p) => {
    const hawala = p.sarrafAmount ?? 0
    const rem = p.total - p.paid - hawala
    events.push({
      date: p.date,
      label: `خرید ${p.received === false ? '(در راه)' : ''}`,
      sub: `مجموع ${fmtMoney(p.total)} · نقد ${fmtMoney(p.paid)}${hawala > 0 ? ` · حواله ${fmtMoney(hawala)}` : ''}`,
      amount: rem,
      plus: rem > 0
    })
  })
  hawalas?.forEach((p) => {
    events.push({
      date: p.date,
      label: `حواله برای ${p.supplierName}`,
      amount: p.sarrafAmount ?? 0,
      plus: true
    })
  })
  payments?.forEach((p) => {
    if (p.amount < 0) {
      // بیلانس اولیه / قرض قبلی: قرض ما را بالا برده است
      events.push({ date: p.date, label: p.note ?? 'قرض قبلی', amount: -p.amount, plus: true })
    } else {
      events.push({
        date: p.date,
        label: p.via === 'sarraf' ? `پرداخت از طریق صراف ${p.sarrafName ?? ''}` : 'پرداخت نقدی',
        sub: p.note,
        amount: p.amount,
        plus: false
      })
    }
  })
  sarrafPays?.forEach((p) => {
    events.push({ date: p.date, label: `حواله برای ${p.partyName}`, amount: p.amount, plus: true })
  })
  returns?.forEach((r) => {
    if (r.settlement === 'reduceDebt') {
      events.push({ date: r.date, label: `مرجوعی جنس (${r.reason})`, amount: r.amount, plus: false })
    }
  })
  events.sort((a, b) => b.date - a.date)

  const bal = live?.balance ?? supplier.balance
  return (
    <Modal title={supplier.kind === 'sarraf' ? `💱 ${supplier.name}` : supplier.name} onClose={onClose}>
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">{bal > 0 ? 'قرض ما' : 'حساب تصفیه است'}</p>
        <p className={`text-2xl font-bold ${bal > 0 ? 'text-red-600' : 'text-teal-700'}`}>{fmtMoney(bal)}</p>
      </div>
      {!showDebt ? (
        <button className="mb-3 w-full rounded-xl bg-amber-100 py-2 text-sm font-bold text-amber-800" onClick={() => setShowDebt(true)}>
          ＋ ثبت قرض قبلی (پیش از اپ)
        </button>
      ) : (
        <div className="mb-3 rounded-xl border border-amber-200 p-3">
          <p className="mb-2 text-xs text-slate-500">قرض خریدهای گذشته — در خرید، مفاد و صندوق حساب نمی‌شود.</p>
          <Field label="مبلغ قرض قبلی">
            <input className={inputCls} inputMode="numeric" value={debtStr} onChange={(e) => setDebtStr(e.target.value)} />
          </Field>
          <Field label="یادداشت (اختیاری)">
            <input className={inputCls} value={debtNote} onChange={(e) => setDebtNote(e.target.value)} placeholder="مثلاً بابت حمل گذشته" />
          </Field>
          <PrimaryBtn
            disabled={parseNum(debtStr) <= 0}
            onClick={async () => {
              await addOpeningDebt('supplier', supplier.id!, supplier.name, parseNum(debtStr), debtNote)
              setDebtStr('')
              setDebtNote('')
              setShowDebt(false)
            }}
          >
            ثبت قرض قبلی
          </PrimaryBtn>
        </div>
      )}
      <p className="mb-2 text-sm font-bold text-slate-700">تاریخچهٔ حساب</p>
      {events.length === 0 && <Empty text="هنوز سندی ثبت نشده." />}
      <div className="max-h-96 overflow-y-auto">
        {events.map((e, i) => (
          <div key={i} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm last:border-0">
            <div>
              <p className="font-bold text-slate-700">{e.label}</p>
              {e.sub && <p className="text-xs text-slate-400">{e.sub}</p>}
              <p className="text-xs text-slate-400">{fmtDate(e.date)}</p>
            </div>
            <span className={`font-bold ${e.plus ? 'text-red-600' : 'text-teal-700'}`}>
              {e.plus ? '+' : '−'}
              {fmtMoney(Math.abs(e.amount))}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-center text-xs text-slate-400">قرمز = قرض ما زیاد شد · سبز = پرداخت/کم شد</p>
    </Modal>
  )
}

/** مرجوعی مستقیم از روی یک خرید: اجناس همان فاکتور با قیمت خرید همان فاکتور */
function PurchaseReturnModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const [qtys, setQtys] = useState<Record<number, number>>({})
  const [reason, setReason] = useState('خرابی جنس')
  const [settlement, setSettlement] = useState<'reduceDebt' | 'cashRefund'>('reduceDebt')
  const [error, setError] = useState('')
  const supplier = useLiveQuery(() => db.suppliers.get(purchase.supplierId), [purchase.supplierId])

  const amount = purchase.lines.reduce((s, l, i) => s + (qtys[i] ?? 0) * l.unitCost, 0)

  async function save() {
    const lines: ReturnLine[] = purchase.lines
      .map((l, i) => ({
        variantId: l.variantId,
        productName: l.productName,
        size: l.size,
        color: l.color,
        qty: qtys[i] ?? 0,
        unitPrice: l.unitCost,
        restock: false
      }))
      .filter((l) => l.qty > 0)
    if (!lines.length) return setError('حداقل یک جنس انتخاب کنید')
    try {
      await addSupplierReturn({
        date: Date.now(),
        kind: 'supplier',
        partyId: purchase.supplierId,
        partyName: purchase.supplierName,
        refId: purchase.id,
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
    <Modal title={`مرجوعی به ${purchase.supplierName}`} onClose={onClose}>
      <p className="mb-2 text-sm text-slate-600">خرید {fmtDate(purchase.date)}</p>
      {purchase.lines.map((l, i) => (
        <div key={i} className="mb-2 flex items-center justify-between rounded-xl bg-slate-50 p-2">
          <div className="text-sm">
            <p className="font-bold">
              {l.productName} {l.size} {l.color}
            </p>
            <p className="text-slate-500">
              خریده: {fmtNum(l.qty)} × {fmtMoney(l.unitCost)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="h-8 w-8 rounded-full bg-slate-200 font-bold" onClick={() => setQtys((q) => ({ ...q, [i]: Math.max(0, (q[i] ?? 0) - 1) }))}>
              −
            </button>
            <input
              className="w-14 rounded-lg border border-slate-300 bg-white px-1 py-1 text-center font-bold"
              inputMode="numeric"
              value={qtys[i] ?? 0}
              onChange={(e) => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, Math.max(0, parseNum(e.target.value) || 0)) }))}
            />
            <button className="h-8 w-8 rounded-full bg-teal-100 font-bold text-teal-800" onClick={() => setQtys((q) => ({ ...q, [i]: Math.min(l.qty, (q[i] ?? 0) + 1) }))}>
              ＋
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
          <option value="reduceDebt">کم شدن از قرض ما{supplier ? ` (قرض فعلی: ${fmtMoney(supplier.balance)})` : ''}</option>
          <option value="cashRefund">دریافت نقدی به صندوق</option>
        </select>
      </Field>
      <p className="mb-3 font-bold text-slate-800">مبلغ مرجوعی: {fmtMoney(amount)}</p>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save} disabled={amount <= 0}>
        ثبت مرجوعی
      </PrimaryBtn>
    </Modal>
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
            <QtyControl qty={l.qty} onChange={(q) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: q } : x)))} />
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

function NewSupplierModal({ kind, onClose }: { kind: 'supplier' | 'sarraf'; onClose: () => void }) {
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

function PaySupplierModal({ supplierId, onClose }: { supplierId: number; onClose: () => void }) {
  const supplier = useLiveQuery(() => db.suppliers.get(supplierId), [supplierId])
  const sarrafs = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && s.kind === 'sarraf' && s.id !== supplierId).toArray(),
    [supplierId]
  )
  const [amount, setAmount] = useState('')
  const [via, setVia] = useState<'cash' | 'sarraf'>('cash')
  const [sarrafId, setSarrafId] = useState<number | ''>('')
  const [error, setError] = useState('')
  if (!supplier) return null
  const isSarraf = supplier.kind === 'sarraf'
  return (
    <Modal title={`پرداخت به ${supplier.name}`} onClose={onClose}>
      <p className="mb-2 text-slate-600">قرض فعلی: {fmtMoney(supplier.balance)}</p>
      <Field label="مبلغ پرداختی">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      {!isSarraf && (sarrafs?.length ?? 0) > 0 && (
        <Field label="طریق پرداخت">
          <select className={inputCls} value={via} onChange={(e) => setVia(e.target.value as 'cash' | 'sarraf')}>
            <option value="cash">نقد از صندوق</option>
            <option value="sarraf">حواله از طریق صراف</option>
          </select>
        </Field>
      )}
      {via === 'sarraf' && (
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
          <p className="mb-2 text-xs text-amber-600">پول از صندوق کم نمی‌شود؛ قرض شما به صراف زیاد می‌شود.</p>
        </>
      )}
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn
        disabled={parseNum(amount) <= 0 || (via === 'sarraf' && !sarrafId)}
        onClick={async () => {
          try {
            const sf = via === 'sarraf' ? sarrafs?.find((s) => s.id === sarrafId) : undefined
            await addPayment({
              date: Date.now(),
              partyType: 'supplier',
              partyId: supplierId,
              partyName: supplier.name,
              amount: parseNum(amount),
              ...(sf ? { via: 'sarraf' as const, sarrafId: sf.id!, sarrafName: sf.name } : {})
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

function NewPurchaseModal({ onClose }: { onClose: () => void }) {
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [lines, setLines] = useState<PurchaseLine[]>([])
  const [paidStr, setPaidStr] = useState('')
  const [paidTouched, setPaidTouched] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  const [received, setReceived] = useState(true)
  const [useSarraf, setUseSarraf] = useState(false)
  const [sarrafId, setSarrafId] = useState<number | ''>('')
  const [sarrafStr, setSarrafStr] = useState('')
  // فورم جنس جدید داخل خرید — لازم نیست اول به گدام برود
  const [showNewProduct, setShowNewProduct] = useState(false)
  const [npName, setNpName] = useState('')
  const [npSize, setNpSize] = useState('')
  const [npColor, setNpColor] = useState('')
  const [npCost, setNpCost] = useState('')
  const [npRetail, setNpRetail] = useState('')
  const [npWholesale, setNpWholesale] = useState('')

  const suppliers = useLiveQuery(() => db.suppliers.orderBy('name').filter((x) => !x.deleted).toArray(), [])
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const vendors = suppliers?.filter((s) => s.kind !== 'sarraf')
  const sarrafs = suppliers?.filter((s) => s.kind === 'sarraf')

  const productMap = new Map<number, Product>()
  products?.forEach((p) => productMap.set(p.id!, p))

  const matches =
    search.trim() && variants
      ? variants
          .filter((v) => {
            const p = productMap.get(v.productId)
            if (!p) return false
            const hay = `${p.name} ${p.brand ?? ''} ${v.size} ${v.color} ${v.sku ?? ''}`
            return search.trim().split(/\s+/).every((w) => hay.includes(w))
          })
          .slice(0, 12)
      : []

  // جنس‌های کارتن‌دارِ مطابق جستجو — برای دکمهٔ «＋ یک کارتن»
  const cartonProducts = [
    ...new Map(
      matches
        .map((v) => productMap.get(v.productId)!)
        .filter((p) => (p.carton?.items.length ?? 0) > 0)
        .map((p) => [p.id!, p])
    ).values()
  ]

  function addCarton(p: Product) {
    const vs = variants?.filter((v) => v.productId === p.id) ?? []
    setLines((ls) => {
      let out = [...ls]
      for (const it of p.carton!.items) {
        const v = vs.find((x) => x.size === it.size && x.color === it.color)
        if (!v) continue
        const i = out.findIndex((l) => l.variantId === v.id)
        if (i >= 0) out = out.map((l, j) => (j === i ? { ...l, qty: l.qty + it.qty } : l))
        else out.push({ variantId: v.id!, productName: p.name, size: v.size, color: v.color, qty: it.qty, unitCost: v.purchasePrice })
      }
      return out
    })
  }

  const total = lines.reduce((s, l) => s + l.qty * l.unitCost, 0)
  const hawala = useSarraf ? Math.min(Math.max(0, parseNum(sarrafStr)), total) : 0
  const paid = paidTouched ? parseNum(paidStr) : Math.max(0, total - hawala)
  const remainder = total - paid - hawala

  async function addNewProduct() {
    const name = npName.trim()
    if (!name || !npSize.trim()) return setError('نام و سایز جنس جدید را بنویسید')
    const cost = parseNum(npCost)
    const retail = parseNum(npRetail)
    const pid = (await db.products.add({ name, createdAt: Date.now() })) as number
    const vid = (await db.variants.add({
      productId: pid,
      size: npSize.trim(),
      color: npColor.trim(),
      purchasePrice: cost,
      retailPrice: retail,
      wholesalePrice: parseNum(npWholesale) || retail,
      stockQty: 0,
      lowStock: 2
    })) as number
    await db.variants.update(vid, { sku: makeSku(vid, npSize.trim()) })
    setLines((ls) => [...ls, { variantId: vid, productName: name, size: npSize.trim(), color: npColor.trim(), qty: 1, unitCost: cost }])
    setShowNewProduct(false)
    setNpName('')
    setNpSize('')
    setNpColor('')
    setNpCost('')
    setNpRetail('')
    setNpWholesale('')
    setError('')
  }

  async function save() {
    if (!supplierId) return setError('تأمین‌کننده را انتخاب کنید')
    if (!lines.length) return setError('حداقل یک جنس اضافه کنید')
    if (useSarraf && hawala > 0 && !sarrafId) return setError('صراف را انتخاب کنید')
    const supplier = vendors?.find((s) => s.id === supplierId)
    const sf = sarrafs?.find((s) => s.id === sarrafId)
    try {
      await addPurchase({
        date: Date.now(),
        supplierId: supplierId as number,
        supplierName: supplier?.name ?? '',
        lines,
        total,
        paid,
        ...(received ? {} : { received: false }),
        ...(hawala > 0 && sf ? { sarrafId: sf.id!, sarrafName: sf.name, sarrafAmount: hawala } : {})
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
          {vendors?.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      {vendors?.length === 0 && <p className="mb-2 text-sm text-amber-600">اول از بخش «تأمین‌کنندگان» یک تأمین‌کننده اضافه کنید.</p>}

      <Field label="جستجوی جنس">
        <input className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="نام، سایز یا رنگ..." />
      </Field>
      {cartonProducts.map((p) => {
        const pairs = p.carton!.items.reduce((s, it) => s + it.qty, 0)
        return (
          <button
            key={`c${p.id}`}
            onClick={() => addCarton(p)}
            className="mb-2 flex w-full items-center justify-between rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-right font-bold text-amber-800 active:bg-amber-100"
          >
            <span>📦 {p.name} — ＋ یک کارتن</span>
            <span className="text-sm font-normal">{fmtNum(pairs)} جوړه</span>
          </button>
        )
      })}
      {cartonProducts.length > 0 && (
        <p className="-mt-1 mb-2 text-xs text-slate-400">هر ضربه یک کارتن کامل اضافه می‌کند؛ اگر شماره‌بندی این حمل فرق دارد، تعدادها را پایین ویرایش کنید.</p>
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

      {!showNewProduct && (
        <button
          onClick={() => {
            setShowNewProduct(true)
            if (search.trim()) setNpName(search.trim())
          }}
          className="mb-3 w-full rounded-xl border-2 border-dashed border-teal-300 py-2 text-sm font-bold text-teal-700"
        >
          ＋ جنس جدید (در گدام نیست)
        </button>
      )}
      {showNewProduct && (
        <div className="mb-3 rounded-xl border border-teal-200 bg-teal-50/50 p-3">
          <p className="mb-2 text-sm font-bold text-teal-800">جنس جدید — همراه با خرید ثبت می‌شود</p>
          <Field label="نام جنس *">
            <input className={inputCls} value={npName} onChange={(e) => setNpName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="سایز *">
              <input className={inputCls} value={npSize} onChange={(e) => setNpSize(e.target.value)} />
            </Field>
            <Field label="رنگ">
              <input className={inputCls} value={npColor} onChange={(e) => setNpColor(e.target.value)} />
            </Field>
            <Field label="قیمت خرید">
              <input className={inputCls} inputMode="numeric" value={npCost} onChange={(e) => setNpCost(e.target.value)} />
            </Field>
            <Field label="قیمت فروش (پرچون)">
              <input className={inputCls} inputMode="numeric" value={npRetail} onChange={(e) => setNpRetail(e.target.value)} />
            </Field>
            <Field label="قیمت عمده">
              <input className={inputCls} inputMode="numeric" value={npWholesale} onChange={(e) => setNpWholesale(e.target.value)} />
            </Field>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void addNewProduct()} className="flex-1 rounded-xl bg-teal-700 py-2 text-sm font-bold text-white">
              افزودن به خرید
            </button>
            <button onClick={() => setShowNewProduct(false)} className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-bold text-slate-600">
              لغو
            </button>
          </div>
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
            <QtyControl qty={l.qty} onChange={(q) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: q } : x)))} />
            <button className="mr-1 text-red-500" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        </div>
      ))}

      <label className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
        <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={received} onChange={(e) => setReceived(e.target.checked)} />
        جنس تحویل شد (به گدام اضافه شود)
      </label>
      {!received && (
        <p className="mb-2 text-xs text-amber-600">
          🚚 خرید «در راه» ثبت می‌شود؛ وقتی جنس رسید، در لیست خریدها دکمهٔ «جنس رسید» را بزنید تا به گدام اضافه شود.
        </p>
      )}

      {(sarrafs?.length ?? 0) > 0 && (
        <label className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-700">
          <input type="checkbox" className="h-5 w-5 accent-teal-700" checked={useSarraf} onChange={(e) => setUseSarraf(e.target.checked)} />
          بخشی از پول از طریق صراف (حواله)
        </label>
      )}
      {useSarraf && (
        <div className="mb-2 grid grid-cols-2 gap-2">
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
          <Field label="مبلغ حواله">
            <input className={inputCls} inputMode="numeric" value={sarrafStr} onChange={(e) => setSarrafStr(e.target.value)} />
          </Field>
        </div>
      )}

      <div className="mt-3 rounded-xl bg-teal-50 p-3">
        <div className="flex justify-between font-bold text-slate-800">
          <span>مجموع</span>
          <span>{fmtMoney(total)}</span>
        </div>
        {hawala > 0 && (
          <div className="flex justify-between text-sm text-amber-700">
            <span>حواله صراف</span>
            <span>{fmtMoney(hawala)}</span>
          </div>
        )}
        <Field label="مبلغ پرداختی (نقد)">
          <input
            className={inputCls}
            inputMode="numeric"
            value={paidTouched ? paidStr : String(paid)}
            onFocus={() => {
              if (!paidTouched) {
                setPaidTouched(true)
                setPaidStr(String(paid))
              }
            }}
            onChange={(e) => setPaidStr(e.target.value)}
          />
        </Field>
        {remainder > 0 && <p className="text-sm font-bold text-red-600">باقی (قرض ما به تأمین‌کننده): {fmtMoney(remainder)}</p>}
        {hawala > 0 && <p className="text-sm font-bold text-amber-700">قرض ما به صراف: {fmtMoney(hawala)}</p>}
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
