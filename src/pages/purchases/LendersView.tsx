import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { netWorth } from '../../lib/networth'
import { db, type Supplier, type LenderAction } from '../../db'
import {
  addLender,
  addLoan,
  addPayment,
  convertLoanToCapital,
  deleteLender,
  deletePayment,
  deletePaymentImpact,
  giveCashToLender,
  giveGoodsToLender,
  addOpeningLenderCash,
  addOpeningLenderGoods,
  updateLender,
  type LoanReceiptMode,
  type LenderCashOutMode,
  type LenderGoodsLine,
  type OpeningLenderGoodsLine,
  type LenderGoodsMode
} from '../../lib/ops'
import { fmtNum, fmtMoney, fmtDate, fmtDateShort, parseNum, toDateInput, fromDateInput } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn, Fab, Empty, Card } from '../../components/ui'
import { buildLenderLedger, summarizeLenderAccount } from '../../lib/ledger'

type StockOption = LenderGoodsLine & { variantId: number; stockQty: number; retailPrice: number; wholesalePrice: number }

/** قرض‌دهنده: کسی که به دکان پول قرض داده — نه تأمین‌کننده است نه شریک */
function LendersView() {
  const [showNew, setShowNew] = useState(false)
  const [detail, setDetail] = useState<Supplier | null>(null)

  const lenders = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted && x.kind === 'lender').toArray(), [])
  const total = lenders?.reduce((s, l) => s + Math.max(0, l.balance), 0) ?? 0

  return (
    <>
      <div className="mb-3 rounded-xl bg-white p-3 shadow-sm">
        <div className="flex justify-between">
          <span className="text-sm text-slate-500">مجموع قرض ما از اشخاص</span>
          <span className="font-bold text-red-600">{fmtMoney(total)}</span>
        </div>
        <p className="mt-1 text-xs text-slate-400">
          تا وقتی شریک نشده، پولش قرض است — از دارایی کم می‌شود و از مفاد سهم نمی‌برد.
        </p>
      </div>

      {lenders?.length === 0 && <Empty text="قرض‌دهنده‌ای ثبت نشده. کسی که به دکان پول قرض داده اینجا ثبت می‌شود." />}
      {lenders?.map((l) => (
        <Card key={l.id} onClick={() => setDetail(l)}>
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-slate-800">🤝 {l.name}</p>
              {l.phone && (
                <p className="text-sm text-slate-500" dir="ltr">
                  {l.phone}
                </p>
              )}
            </div>
            <div className="text-left">
              <p className={`font-bold ${l.balance < 0 ? 'text-teal-700' : 'text-red-600'}`}>{fmtMoney(Math.abs(l.balance))}</p>
              <p className="text-xs text-slate-400">{l.balance > 0 ? 'قرض ما به او' : l.balance < 0 ? 'طلب ما از او' : 'تصفیه'}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-500">جزئیات و قسط‌ها ←</p>
        </Card>
      ))}

      <Fab onClick={() => setShowNew(true)} label="قرض‌دهندهٔ جدید" />
      {showNew && <NewLenderModal onClose={() => setShowNew(false)} />}
      {detail && <LenderDetailModal lender={detail} onClose={() => setDetail(null)} />}
    </>
  )
}

function NewLenderModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  return (
    <Modal title="🤝 قرض‌دهندهٔ جدید" onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}
      <p className="mb-3 text-sm text-slate-500">کسی که به دکان پول قرض داده. اگر بعداً شریک شد، با یک دکمه قرضش سرمایه می‌شود.</p>
      <Field label="نام *">
        <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="تلفن">
        <input className={inputCls} dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً شرایط پرداخت" />
      </Field>
      <PrimaryBtn
        disabled={!name.trim()}
        onClick={async () => {
          try {
            await addLender({ name, phone, note })
            onClose()
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          }
        }}
      >
        ذخیره
      </PrimaryBtn>
    </Modal>
  )
}

function LenderDetailModal({ lender, onClose }: { lender: Supplier; onClose: () => void }) {
  const [mode, setMode] = useState<'none' | 'loan' | 'repay' | 'goods' | 'opening' | 'direct' | 'partner' | 'edit'>('none')
  const [amount, setAmount] = useState('')
  const [dateStr, setDateStr] = useState(toDateInput(Date.now()))
  const [note, setNote] = useState('')
  const [loanReceipt, setLoanReceipt] = useState<LoanReceiptMode>('cash')
  const [cashMode, setCashMode] = useState<LenderCashOutMode>('cashRepayment')
  const [goodsMode, setGoodsMode] = useState<LenderGoodsMode>('goodsSettlement')
  const [openingAction, setOpeningAction] = useState<LenderAction>('cashRepayment')
  const [variantId, setVariantId] = useState<number | ''>('')
  const [qty, setQty] = useState('1')
  const [agreedPrice, setAgreedPrice] = useState('')
  const [goodsLines, setGoodsLines] = useState<OpeningLenderGoodsLine[]>([])
  const [manualOpeningGoods, setManualOpeningGoods] = useState(true)
  const [oldProductName, setOldProductName] = useState('')
  const [oldSize, setOldSize] = useState('')
  const [oldColor, setOldColor] = useState('')
  const [supplierId, setSupplierId] = useState<number | ''>('')
  const [shareStr, setShareStr] = useState('')
  const [editName, setEditName] = useState(lender.name)
  const [editPhone, setEditPhone] = useState(lender.phone ?? '')
  const [editNote, setEditNote] = useState(lender.note ?? '')
  const [error, setError] = useState('')

  const live = useLiveQuery(() => db.suppliers.get(lender.id!), [lender.id])
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'supplier' && (p.partyId === lender.id || p.lenderId === lender.id)).toArray(),
    [lender.id]
  )
  const suppliers = useLiveQuery(
    () => db.suppliers.filter((s) => !s.deleted && (s.kind === undefined || s.kind === 'supplier')).toArray(),
    []
  )
  const lenderSales = useLiveQuery(
    () => db.sales.filter((s) => !s.deleted && s.lenderId === lender.id).toArray(),
    [lender.id]
  )
  const allOptions = useLiveQuery(async (): Promise<StockOption[]> => {
    const [products, variants] = await Promise.all([
      db.products.filter((p) => !p.deleted).toArray(),
      db.variants.filter((v) => !v.deleted).toArray()
    ])
    const names = new Map(products.map((p) => [p.id!, p.name]))
    return variants.map((v) => ({
      variantId: v.id!,
      productName: names.get(v.productId) ?? 'جنس',
      size: v.size,
      color: v.color,
      qty: 1,
      unitPrice: 0,
      stockQty: v.stockQty,
      retailPrice: v.retailPrice,
      wholesalePrice: v.wholesalePrice
    }))
  }, [])
  const stockOptions = allOptions?.filter((v) => v.stockQty > 0)
  // دارایی خالص امروز — برای پیشنهاد سهم عادلانه
  const assets = useLiveQuery(async () => (await netWorth()).assets, [])

  const l = live ?? lender
  const owed = l.balance
  // اگر قرضش سرمایه شود: دارایی خالص فعلی + پول او = مجموع سرمایه
  const totalAfter = (assets ?? 0) + owed
  const fairShare = totalAfter > 0 ? Math.round((owed / totalAfter) * 100) : 0

  // دفتر: هر قسط و هر پرداخت با «قرض ما شد: …»
  const ledger = buildLenderLedger(payments ?? [], l.id!, lenderSales ?? [])
  const summary = summarizeLenderAccount(payments ?? [], l.id!)
  const goodsTotal = goodsLines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0)

  const reset = () => {
    setAmount('')
    setNote('')
    setSupplierId('')
    setLoanReceipt('cash')
    setCashMode('cashRepayment')
    setGoodsMode('goodsSettlement')
    setOpeningAction('cashRepayment')
    setVariantId('')
    setQty('1')
    setAgreedPrice('')
    setGoodsLines([])
    setManualOpeningGoods(true)
    setOldProductName('')
    setOldSize('')
    setOldColor('')
    setError('')
    setDateStr(toDateInput(Date.now()))
  }

  return (
    <Modal title={`🤝 ${l.name}`} onClose={onClose}>
      {error && <p className="mb-3 rounded-xl bg-red-50 p-2.5 text-sm font-bold text-red-700">⚠️ {error}</p>}

      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-sm text-slate-500">{owed > 0 ? 'قرض ما به او' : owed < 0 ? 'طلب ما از او' : 'حساب تصفیه است'}</p>
        <p className={`text-2xl font-bold ${owed > 0 ? 'text-red-600' : owed < 0 ? 'text-teal-700' : 'text-slate-600'}`}>
          {fmtMoney(Math.abs(owed))}
        </p>
      </div>

      <details className="mb-3 rounded-xl border border-slate-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-bold text-slate-700">خلاصهٔ کامل رفت‌وآمدها</summary>
        <div className="mt-2 space-y-1 text-xs">
          <SummaryRow label="قرض قبلی" value={summary.openingLoan} plus />
          <SummaryRow label="دریافت نقدی قرض" value={summary.cashReceived} plus />
          <SummaryRow label="پرداخت مستقیم فروشنده" value={summary.directSupplier} plus />
          <SummaryRow label="پرداخت نقدی قرض" value={summary.cashRepaid} />
          <SummaryRow label="قرض نقدی به قرض‌دهنده" value={summary.cashLoaned} />
          <SummaryRow label="کفش بابت تسویه" value={summary.goodsSettlement} />
          <SummaryRow label="کفش قرضی" value={summary.goodsCredit} />
          <p className="border-t border-slate-200 pt-1 font-bold text-slate-600">اسناد قبلیِ برداشت او</p>
          <SummaryRow label="پرداخت نقدی قبلی قرض" value={summary.previousCashRepaid} />
          <SummaryRow label="قرض نقدی قبلی به او" value={summary.previousCashLoaned} />
          <SummaryRow label="کفش قبلی بابت تسویه" value={summary.previousGoodsSettlement} />
          <SummaryRow label="کفش قرضی قبلی" value={summary.previousGoodsCredit} />
        </div>
      </details>

      <button
        className="mb-3 w-full rounded-xl border border-slate-300 py-2 text-sm font-bold text-slate-700"
        onClick={() => {
          setEditName(l.name)
          setEditPhone(l.phone ?? '')
          setEditNote(l.note ?? '')
          setMode(mode === 'edit' ? 'none' : 'edit')
          setError('')
        }}
      >
        ✏️ ویرایش مشخصات قرض‌دهنده
      </button>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          className="flex-1 rounded-xl bg-teal-700 py-2 text-sm font-bold text-white"
          onClick={() => {
            setMode(mode === 'loan' ? 'none' : 'loan')
            reset()
          }}
        >
          ＋ دریافت از او
        </button>
        <button
          className="flex-1 rounded-xl bg-amber-100 py-2 text-sm font-bold text-amber-800"
          onClick={() => {
            setMode(mode === 'repay' ? 'none' : 'repay')
            reset()
          }}
        >
          پول به او
        </button>
        <button
          className="rounded-xl bg-orange-100 py-2 text-sm font-bold text-orange-800"
          onClick={() => {
            setMode(mode === 'goods' ? 'none' : 'goods')
            reset()
          }}
        >
          کفش به او
        </button>
        <button
          className="rounded-xl bg-blue-100 py-2 text-sm font-bold text-blue-800"
          onClick={() => {
            setMode(mode === 'direct' ? 'none' : 'direct')
            reset()
          }}
        >
          پرداخت مستقیم به فروشنده
        </button>
        <button
          className="col-span-2 rounded-xl border border-dashed border-slate-400 bg-slate-50 py-2 text-sm font-bold text-slate-700"
          onClick={() => {
            setMode(mode === 'opening' ? 'none' : 'opening')
            reset()
          }}
        >
          🕘 سند قبلی — قبل از استفاده از اپ
        </button>
      </div>

      {mode === 'edit' && (
        <div className="mb-3 rounded-xl border border-slate-300 p-3">
          <Field label="نام *">
            <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Field>
          <Field label="تلفن">
            <input className={inputCls} dir="ltr" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={editNote} onChange={(e) => setEditNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!editName.trim()}
            onClick={async () => {
              try {
                await updateLender(l.id!, { name: editName, phone: editPhone, note: editNote })
                setMode('none')
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ذخیرهٔ تغییرات
          </PrimaryBtn>
          <button
            className="mt-3 w-full rounded-xl border border-red-300 py-2 text-sm font-bold text-red-700"
            onClick={async () => {
              if (!confirm('این قرض‌دهنده حذف شود؟ فقط وقتی حساب و سند زنده ندارد حذف می‌شود.')) return
              try {
                await deleteLender(l.id!)
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            حذف قرض‌دهنده
          </button>
        </div>
      )}

      {mode === 'loan' && (
        <div className="mb-3 rounded-xl border border-teal-200 p-3">
          <Field label="این قرض چگونه بوده؟">
            <select className={inputCls} value={loanReceipt} onChange={(e) => setLoanReceipt(e.target.value as LoanReceiptMode)}>
              <option value="cash">پول اکنون وارد صندوق شد</option>
              <option value="opening">قرض قبلی — پول قبلاً برای جنس مصرف شده</option>
            </select>
          </Field>
          <p className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
            {loanReceipt === 'cash'
              ? 'صندوق به همین مبلغ زیاد می‌شود و قرض ما به او بالا می‌رود.'
              : 'برای جنس موجودی اولیه یا بکاپ: فقط قرض ثبت می‌شود و صندوق تغییر نمی‌کند.'}
          </p>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="تاریخ (برای قسط‌های گذشته هم می‌شود عقب برد)">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                await addLoan(l.id!, l.name, parseNum(amount), fromDateInput(dateStr), note, loanReceipt)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {loanReceipt === 'cash' ? 'ثبت دریافت نقدی قرض' : 'ثبت قرض قبلی بدون تغییر صندوق'}
          </PrimaryBtn>
        </div>
      )}

      {mode === 'direct' && (
        <div className="mb-3 rounded-xl border border-blue-200 p-3">
          <p className="mb-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-800">
            برای خرید آینده که این شخص مستقیماً فروشنده را پرداخت کرده است. صندوق تغییر نمی‌کند.
          </p>
          <p className="mb-2 text-xs font-bold text-amber-700">
            برای جنس موجودی اولیه/بکاپ این گزینه را نزنید؛ همان «قرض قبلی» را ثبت کنید.
          </p>
          <Field label="فروشنده *">
            <select className={inputCls} value={supplierId} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — قرض فعلی {fmtMoney(s.balance)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="تاریخ">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={!supplierId || parseNum(amount) <= 0}
            onClick={async () => {
              const supplier = suppliers?.find((s) => s.id === supplierId)
              if (!supplier) return
              try {
                await addPayment({
                  date: fromDateInput(dateStr),
                  partyType: 'supplier',
                  partyId: supplier.id!,
                  partyName: supplier.name,
                  amount: parseNum(amount),
                  note: note.trim() || undefined,
                  via: 'lender',
                  lenderId: l.id!,
                  lenderName: l.name
                })
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت پرداخت مستقیم
          </PrimaryBtn>
        </div>
      )}

      {mode === 'repay' && (
        <div className="mb-3 rounded-xl border border-amber-200 p-3">
          <Field label="این پول چگونه حساب شود؟">
            <select className={inputCls} value={cashMode} onChange={(e) => setCashMode(e.target.value as LenderCashOutMode)}>
              <option value="cashRepayment">پرداخت قرض ما به او</option>
              <option value="cashLoan">قرض نقدی به خود قرض‌دهنده</option>
            </select>
          </Field>
          <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
            {cashMode === 'cashRepayment'
              ? 'از قرض ما کم می‌شود و بیشتر از قرض فعلی ثبت نمی‌شود.'
              : 'این پول قرضِ او از دکان است؛ اگر حساب منفی شود، یعنی او به ما بدهکار است.'}
          </p>
          <Field label="مبلغ *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="تاریخ">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً قسط ماه یا مصرف خانه" />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                await giveCashToLender(l.id!, l.name, parseNum(amount), fromDateInput(dateStr), note, cashMode)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {cashMode === 'cashRepayment' ? 'ثبت پرداخت قرض' : 'ثبت قرض نقدی به او'}
          </PrimaryBtn>
        </div>
      )}

      {mode === 'goods' && (
        <div className="mb-3 rounded-xl border border-orange-200 p-3">
          <Field label="این کفش چگونه حساب شود؟">
            <select className={inputCls} value={goodsMode} onChange={(e) => setGoodsMode(e.target.value as LenderGoodsMode)}>
              <option value="goodsSettlement">کفش بابت تسویهٔ قرض ما</option>
              <option value="goodsCredit">کفش قرضی برای خودش</option>
            </select>
          </Field>
          <p className="mb-2 rounded-lg bg-orange-50 p-2 text-xs text-orange-800">
            {goodsMode === 'goodsSettlement'
              ? 'قیمت توافقی از قرض ما کم می‌شود؛ ارزش کل نمی‌تواند بیشتر از قرض فعلی باشد.'
              : 'قیمت توافقی طلب دکان از او است و در حساب خالص کم می‌شود.'}
          </p>
          <Field label="مدل، سایز و رنگ *">
            <select
              className={inputCls}
              value={variantId}
              onChange={(e) => {
                setVariantId(e.target.value ? Number(e.target.value) : '')
                setQty('1')
                setAgreedPrice('')
              }}
            >
              <option value="">انتخاب کنید...</option>
              {stockOptions?.map((v) => (
                <option key={v.variantId} value={v.variantId}>
                  {v.productName} — سایز {v.size} — {v.color} — موجودی {fmtNum(v.stockQty)}
                </option>
              ))}
            </select>
          </Field>
          {variantId && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="تعداد *">
                  <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
                </Field>
                <Field label="قیمت توافقی فی جوړه *">
                  <input
                    className={inputCls}
                    inputMode="numeric"
                    value={agreedPrice}
                    onChange={(e) => setAgreedPrice(e.target.value)}
                    placeholder="قیمت توافق‌شده"
                  />
                </Field>
              </div>
              {(() => {
                const selected = stockOptions?.find((v) => v.variantId === variantId)
                return selected ? (
                  <p className="mb-2 text-xs text-slate-500">
                    راهنما: پرچون {fmtMoney(selected.retailPrice)}، عمده {fmtMoney(selected.wholesalePrice)}
                  </p>
                ) : null
              })()}
              <button
                className="mb-3 w-full rounded-xl border border-orange-300 py-2 text-sm font-bold text-orange-800"
                onClick={() => {
                  const selected = stockOptions?.find((v) => v.variantId === variantId)
                  const count = parseNum(qty)
                  const price = parseNum(agreedPrice)
                  const already = goodsLines.filter((x) => x.variantId === variantId).reduce((sum, x) => sum + x.qty, 0)
                  if (!selected || !Number.isInteger(count) || count <= 0 || price <= 0) {
                    setError('جنس، تعداد صحیح و قیمت توافقی را کامل کنید')
                    return
                  }
                  if (already + count > selected.stockQty) {
                    setError('تعداد انتخاب‌شده بیشتر از موجودی گدام است')
                    return
                  }
                  setGoodsLines((xs) => [
                    ...xs,
                    {
                      variantId: selected.variantId,
                      productName: selected.productName,
                      size: selected.size,
                      color: selected.color,
                      qty: count,
                      unitPrice: price
                    }
                  ])
                  setVariantId('')
                  setQty('1')
                  setAgreedPrice('')
                  setError('')
                }}
              >
                ＋ افزودن به سند
              </button>
            </>
          )}
          {goodsLines.map((line, index) => (
            <div key={`${line.variantId}-${index}`} className="mb-2 flex items-center justify-between rounded-lg bg-slate-50 p-2 text-xs">
              <span>
                {line.productName} {line.size} {line.color} ×{fmtNum(line.qty)} — {fmtMoney(line.qty * line.unitPrice)}
              </span>
              <button className="font-bold text-red-600" onClick={() => setGoodsLines((xs) => xs.filter((_, i) => i !== index))}>
                حذف
              </button>
            </div>
          ))}
          {goodsLines.length > 0 && <p className="mb-2 text-left font-bold text-orange-800">مجموع توافقی: {fmtMoney(goodsTotal)}</p>}
          <Field label="تاریخ">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت و جزئیات">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً بابت قسط ماه" />
          </Field>
          <PrimaryBtn
            disabled={goodsLines.length === 0}
            onClick={async () => {
              try {
                const currentLines = goodsLines.filter((line): line is LenderGoodsLine => typeof line.variantId === 'number')
                if (currentLines.length !== goodsLines.length) throw new Error('برای کفش فعلی، جنس را از گدام انتخاب کنید')
                await giveGoodsToLender(l.id!, l.name, currentLines, fromDateInput(dateStr), note, goodsMode)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            {goodsMode === 'goodsSettlement' ? 'ثبت کفش بابت تسویه' : 'ثبت کفش قرضی'}
          </PrimaryBtn>
        </div>
      )}

      {mode === 'opening' && (
        <div className="mb-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 p-3">
          <p className="mb-2 font-bold text-slate-800">🕘 سند قبلی — قبل از استفاده از اپ</p>
          <p className="mb-2 rounded-lg bg-white p-2 text-xs text-slate-600">
            این سند فقط حساب قرض‌دهنده را می‌سازد؛ صندوق، موجودی گدام و مفاد امروز تغییر نمی‌کند.
          </p>
          <Field label="چه چیزی قبلاً رخ داده بود؟">
            <select
              className={inputCls}
              value={openingAction}
              onChange={(e) => {
                setOpeningAction(e.target.value as LenderAction)
                setAmount('')
                setGoodsLines([])
                setVariantId('')
                setQty('1')
                setAgreedPrice('')
                setManualOpeningGoods(true)
                setOldProductName('')
                setOldSize('')
                setOldColor('')
                setError('')
              }}
            >
              <option value="cashRepayment">پرداخت نقدی قبلی قرض ما به او</option>
              <option value="cashLoan">قرض نقدی قبلی او از دکان</option>
              <option value="goodsSettlement">کفش قبلی بابت تسویهٔ قرض ما</option>
              <option value="goodsCredit">کفش قرضی قبلی برای خودش</option>
            </select>
          </Field>

          {(openingAction === 'cashRepayment' || openingAction === 'cashLoan') && (
            <Field label="مبلغ قبلی *">
              <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
          )}

          {(openingAction === 'goodsSettlement' || openingAction === 'goodsCredit') && (
            <>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className={`rounded-xl border px-2 py-2 text-xs font-bold ${manualOpeningGoods ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-600'}`}
                  onClick={() => {
                    setManualOpeningGoods(true)
                    setVariantId('')
                    setError('')
                  }}
                >
                  ✍️ مشخصات کفش قدیمی را دستی وارد کنید
                </button>
                <button
                  type="button"
                  className={`rounded-xl border px-2 py-2 text-xs font-bold ${!manualOpeningGoods ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-600'}`}
                  onClick={() => {
                    setManualOpeningGoods(false)
                    setOldProductName('')
                    setOldSize('')
                    setOldColor('')
                    setError('')
                  }}
                >
                  📦 انتخاب از گدام فعلی
                </button>
              </div>

              {manualOpeningGoods ? (
                <>
                  <p className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
                    این کفش فقط در سند حساب ثبت می‌شود؛ به فهرست یا موجودی گدام فعلی اضافه نمی‌شود.
                  </p>
                  <Field label="مدل کفش قبلی *">
                    <input className={inputCls} value={oldProductName} onChange={(e) => setOldProductName(e.target.value)} placeholder="مثلاً اسپرتکس" />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="سایز قبلی *">
                      <input className={inputCls} value={oldSize} onChange={(e) => setOldSize(e.target.value)} placeholder="مثلاً ۴۲" />
                    </Field>
                    <Field label="رنگ قبلی *">
                      <input className={inputCls} value={oldColor} onChange={(e) => setOldColor(e.target.value)} placeholder="مثلاً سیاه" />
                    </Field>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="تعداد قبلی *">
                      <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
                    </Field>
                    <Field label="قیمت توافقی قبلی *">
                      <input className={inputCls} inputMode="numeric" value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)} placeholder="قیمت همان وقت" />
                    </Field>
                  </div>
                  <button
                    type="button"
                    className="mb-3 w-full rounded-xl border border-slate-400 bg-white py-2 text-sm font-bold text-slate-700"
                    onClick={() => {
                      const count = parseNum(qty)
                      const price = parseNum(agreedPrice)
                      if (!oldProductName.trim() || !oldSize.trim() || !oldColor.trim() || !Number.isInteger(count) || count <= 0 || price <= 0) {
                        setError('مدل، سایز، رنگ، تعداد صحیح و قیمت توافقی قبلی را کامل کنید')
                        return
                      }
                      setGoodsLines((xs) => [
                        ...xs,
                        {
                          productName: oldProductName.trim(),
                          size: oldSize.trim(),
                          color: oldColor.trim(),
                          qty: count,
                          unitPrice: price
                        }
                      ])
                      setOldProductName('')
                      setOldSize('')
                      setOldColor('')
                      setQty('1')
                      setAgreedPrice('')
                      setError('')
                    }}
                  >
                    ＋ افزودن کفش قدیمی به سند
                  </button>
                </>
              ) : (
                <>
                  <Field label="مدل، سایز و رنگ موجود">
                    <select
                      className={inputCls}
                      value={variantId}
                      onChange={(e) => {
                        setVariantId(e.target.value ? Number(e.target.value) : '')
                        setQty('1')
                        setAgreedPrice('')
                      }}
                    >
                      <option value="">انتخاب کنید...</option>
                      {allOptions?.map((v) => (
                        <option key={v.variantId} value={v.variantId}>
                          {v.productName} — سایز {v.size} — {v.color}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {variantId && (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Field label="تعداد قبلی *">
                          <input className={inputCls} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
                        </Field>
                        <Field label="قیمت توافقی قبلی *">
                          <input className={inputCls} inputMode="numeric" value={agreedPrice} onChange={(e) => setAgreedPrice(e.target.value)} placeholder="قیمت همان وقت" />
                        </Field>
                      </div>
                      <button
                        type="button"
                        className="mb-3 w-full rounded-xl border border-slate-400 bg-white py-2 text-sm font-bold text-slate-700"
                        onClick={() => {
                          const selected = allOptions?.find((v) => v.variantId === variantId)
                          const count = parseNum(qty)
                          const price = parseNum(agreedPrice)
                          if (!selected || !Number.isInteger(count) || count <= 0 || price <= 0) {
                            setError('جنس، تعداد صحیح و قیمت توافقی قبلی را کامل کنید')
                            return
                          }
                          setGoodsLines((xs) => [
                            ...xs,
                            {
                              variantId: selected.variantId,
                              productName: selected.productName,
                              size: selected.size,
                              color: selected.color,
                              qty: count,
                              unitPrice: price
                            }
                          ])
                          setVariantId('')
                          setQty('1')
                          setAgreedPrice('')
                          setError('')
                        }}
                      >
                        ＋ افزودن به سند قبلی
                      </button>
                    </>
                  )}
                </>
              )}
              {goodsLines.map((line, index) => (
                <div key={`old-${line.variantId ?? `${line.productName}-${line.size}-${line.color}`}-${index}`} className="mb-2 flex items-center justify-between rounded-lg bg-white p-2 text-xs">
                  <span>
                    {line.productName} {line.size} {line.color} ×{fmtNum(line.qty)} — {fmtMoney(line.qty * line.unitPrice)}
                  </span>
                  <button className="font-bold text-red-600" onClick={() => setGoodsLines((xs) => xs.filter((_, i) => i !== index))}>
                    حذف
                  </button>
                </div>
              ))}
              {goodsLines.length > 0 && <p className="mb-2 text-left font-bold text-slate-700">مجموع قبلی: {fmtMoney(goodsTotal)}</p>}
            </>
          )}

          <Field label="تاریخ قبلی">
            <input type="date" className={inputCls} value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
          </Field>
          <Field label="یادداشت و جزئیات">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثلاً قبل از بکاپ یا بابت قسط قدیمی" />
          </Field>
          <PrimaryBtn
            disabled={
              openingAction === 'cashRepayment' || openingAction === 'cashLoan'
                ? parseNum(amount) <= 0
                : goodsLines.length === 0
            }
            onClick={async () => {
              try {
                if (openingAction === 'cashRepayment' || openingAction === 'cashLoan') {
                  await addOpeningLenderCash(
                    l.id!,
                    l.name,
                    parseNum(amount),
                    fromDateInput(dateStr),
                    note,
                    openingAction
                  )
                } else {
                  await addOpeningLenderGoods(
                    l.id!,
                    l.name,
                    goodsLines,
                    fromDateInput(dateStr),
                    note,
                    openingAction
                  )
                }
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت سند قبلی بدون تغییر صندوق و گدام
          </PrimaryBtn>
        </div>
      )}

      {owed > 0 && (
        <button
          onClick={() => {
            setMode(mode === 'partner' ? 'none' : 'partner')
            setShareStr(String(fairShare))
            setError('')
          }}
          className="mb-3 w-full rounded-xl border-2 border-dashed border-purple-400 py-2.5 text-sm font-bold text-purple-700"
        >
          🤝 شریک شدن — تبدیل قرض به سرمایه
        </button>
      )}

      {mode === 'partner' && (
        <div className="mb-3 rounded-xl border border-purple-300 bg-purple-50 p-3">
          <p className="mb-2 text-sm font-bold text-purple-900">حساب امروز</p>
          <div className="mb-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-600">دارایی خالص دکان (بدون پول او)</span>
              <span className="font-bold">{fmtMoney(assets ?? 0)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-600">سرمایه‌ای که او می‌آورد</span>
              <span className="font-bold">{fmtMoney(owed)}</span>
            </div>
            <div className="flex justify-between border-t border-purple-200 pt-1">
              <span className="text-slate-600">مجموع سرمایه بعد از شراکت</span>
              <span className="font-bold">{fmtMoney(totalAfter)}</span>
            </div>
          </div>
          <p className="mb-2 rounded-lg bg-white p-2 text-sm">
            سهم عادلانه بر اساس پول: <span className="font-bold text-purple-800">{fmtNum(fairShare)}٪</span> برای او،{' '}
            <span className="font-bold text-purple-800">{fmtNum(100 - fairShare)}٪</span> برای شما
          </p>
          <Field label="فیصدی سهم او از مفاد (خودتان تعیین می‌کنید)">
            <input className={inputCls} inputMode="numeric" value={shareStr} onChange={(e) => setShareStr(e.target.value)} />
          </Field>
          <p className="mb-2 text-xs text-slate-500">
            ⚠️ زحمت روزانهٔ خودتان را هم در نظر بگیرید — یا فیصدی‌تان بیشتر باشد، یا برای خود معاش ماهانه تعیین کنید.
            شراکت از امروز شروع می‌شود و مفاد پیش از امروز مالِ شماست.
          </p>
          <PrimaryBtn
            disabled={parseNum(shareStr) <= 0 || parseNum(shareStr) >= 100}
            onClick={async () => {
              if (!confirm(`قرض ${fmtMoney(owed)} به سرمایهٔ شریک تبدیل شود و شراکت از امروز شروع شود؟`)) return
              try {
                await convertLoanToCapital(l.id!, parseNum(shareStr))
                onClose()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            تأیید — از امروز شریک است
          </PrimaryBtn>
        </div>
      )}

      <p className="mb-2 font-bold text-slate-700">دفتر حساب — این عدد از کجا آمد</p>
      {ledger.length === 0 && <p className="text-sm text-slate-400">هنوز قسطی ثبت نشده.</p>}
      {[...ledger].reverse().map((r) => (
        <div key={r.key} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-bold text-slate-800">{r.label}</p>
              <p className="text-xs text-slate-400">{fmtDate(r.date)}</p>
              {r.items && <p className="mt-1 text-xs font-bold text-slate-600">{r.items}</p>}
              {r.note && <p className="mt-1 text-xs text-slate-500">{r.note}</p>}
            </div>
            <div className="shrink-0 text-left">
              <p className={`font-bold ${r.delta > 0 ? 'text-red-600' : 'text-teal-700'}`}>
                {r.delta > 0 ? '+' : '−'}
                {fmtMoney(Math.abs(r.delta))}
              </p>
              <p className="text-xs text-slate-500">
                {r.balance > 0 ? 'قرض ما شد' : r.balance < 0 ? 'طلب ما شد' : 'حساب شد'}: {fmtMoney(Math.abs(r.balance))}
              </p>
            </div>
          </div>
          {r.source?.table === 'payments' && (
            <button
              className="mt-2 w-full border-t border-red-100 pt-2 text-xs font-bold text-red-600"
              onClick={async () => {
                try {
                  const impact = await deletePaymentImpact(r.source!.id)
                  if (!impact) return
                  const changes = [
                    `${impact.partyName}: ${fmtMoney(impact.before)} ← ${fmtMoney(impact.after)}`,
                    ...(impact.related
                      ? [`${impact.related.partyName}: ${fmtMoney(impact.related.before)} ← ${fmtMoney(impact.related.after)}`]
                      : []),
                    ...(impact.goods ? [`برگشت به گدام: ${impact.goods.items}`] : []),
                    impact.cash === 0
                      ? 'صندوق تغییر نمی‌کند.'
                      : `تغییر صندوق: ${impact.cash > 0 ? '+' : '−'}${fmtMoney(Math.abs(impact.cash))}`
                  ].join('\n')
                  if (!confirm(`این سند اشتباه بود و حذف شود؟\n\n${changes}`)) return
                  await deletePayment(r.source!.id)
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e))
                }
              }}
            >
              اشتباه بود — حذف سند
            </button>
          )}
        </div>
      ))}
      {l.note && <p className="mt-3 text-xs text-slate-400">یادداشت: {l.note}</p>}
      {ledger.length > 0 && <p className="mt-2 text-xs text-slate-400">اولین قسط: {fmtDateShort(ledger[0].date)}</p>}
    </Modal>
  )
}

function SummaryRow({ label, value, plus = false }: { label: string; value: number; plus?: boolean }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-500">{label}</span>
      <span className={plus ? 'font-bold text-red-600' : 'font-bold text-teal-700'}>
        {plus ? '+' : '−'} {fmtMoney(value)}
      </span>
    </div>
  )
}

export default LendersView
