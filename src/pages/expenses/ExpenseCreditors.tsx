import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Supplier } from '../../db'
import {
  deletePayment,
  payExpenseCreditorCash,
  payExpenseCreditorGoods,
  type ExpenseSettlementExcessMode,
  type LenderGoodsLine
} from '../../lib/ops'
import { fmtDate, fmtMoney, fmtNum, parseNum } from '../../lib/format'
import { Field, inputCls, Modal, PrimaryBtn } from '../../components/ui'

export default function ExpenseCreditors() {
  const [detail, setDetail] = useState<Supplier | null>(null)
  const creditors = useLiveQuery(
    () => db.suppliers.filter((x) => !x.deleted && x.kind === 'expenseCreditor').toArray(),
    []
  )
  const total = creditors?.reduce((sum, creditor) => sum + Math.max(0, creditor.balance), 0) ?? 0
  if (!creditors?.length) return null

  return (
    <>
      <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <p className="font-bold text-amber-900">قرض مصارف</p>
            <p className="text-xs text-amber-700">پرداخت بعدی با پول یا کفش</p>
          </div>
          <p className="font-bold text-red-600">{fmtMoney(total)}</p>
        </div>
        {creditors.map((creditor) => (
          <button
            key={creditor.id}
            className="mb-1 flex w-full items-center justify-between rounded-lg bg-white p-2 text-right last:mb-0"
            onClick={() => setDetail(creditor)}
          >
            <span className="font-bold text-slate-700">{creditor.name}</span>
            <span className={creditor.balance > 0 ? 'font-bold text-red-600' : creditor.balance < 0 ? 'font-bold text-teal-700' : 'text-slate-500'}>
              {creditor.balance > 0 ? 'قرض ما: ' + fmtMoney(creditor.balance) : creditor.balance < 0 ? 'طلب ما: ' + fmtMoney(-creditor.balance) : 'تصفیه'}
            </span>
          </button>
        ))}
      </div>
      {detail && <CreditorDetail creditor={detail} onClose={() => setDetail(null)} />}
    </>
  )
}
function CreditorDetail({ creditor, onClose }: { creditor: Supplier; onClose: () => void }) {
  const [mode, setMode] = useState<'none' | 'cash' | 'goods'>('none')
  const [amount, setAmount] = useState('')
  const [variantId, setVariantId] = useState<number | ''>('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [lines, setLines] = useState<LenderGoodsLine[]>([])
  const [excessMode, setExcessMode] = useState<ExpenseSettlementExcessMode>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const live = useLiveQuery(() => db.suppliers.get(creditor.id!), [creditor.id])
  const payments = useLiveQuery(
    () => db.payments.filter((p) => !p.deleted && p.partyType === 'supplier' && p.partyId === creditor.id && Boolean(p.expenseCreditorSettlement)).reverse().sortBy('date'),
    [creditor.id]
  )
  const expenses = useLiveQuery(
    () => db.expenses.filter((e) => !e.deleted && e.creditorId === creditor.id && (e.creditAmount ?? 0) > 0).reverse().sortBy('date'),
    [creditor.id]
  )
  const options = useLiveQuery(async () => {
    const [products, variants] = await Promise.all([
      db.products.filter((p) => !p.deleted).toArray(),
      db.variants.filter((v) => !v.deleted && v.stockQty > 0).toArray()
    ])
    const names = new Map(products.map((p) => [p.id!, p.name]))
    return variants.map((v) => ({
      variantId: v.id!,
      productName: names.get(v.productId) ?? 'جنس',
      size: v.size,
      color: v.color,
      qty: 1,
      unitPrice: 0,
      stockQty: v.stockQty
    }))
  }, [])

  const current = live ?? creditor
  const debt = Math.max(0, current.balance)
  const goodsTotal = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0)
  const excess = Math.max(0, goodsTotal - debt)

  const reset = () => {
    setAmount('')
    setVariantId('')
    setQty('1')
    setPrice('')
    setLines([])
    setNote('')
    setError('')
  }

  return (
    <Modal title={'قرض مصرف — ' + current.name} onClose={onClose}>
      {error && <p className="mb-3 rounded-lg bg-red-50 p-2 text-sm font-bold text-red-600">{error}</p>}
      <div className="mb-3 rounded-xl bg-slate-50 p-3 text-center">
        <p className="text-xs text-slate-500">{current.balance > 0 ? 'قرض ما به او' : current.balance < 0 ? 'طلب دکان از او' : 'حساب تصفیه است'}</p>
        <p className={'text-2xl font-bold ' + (current.balance > 0 ? 'text-red-600' : 'text-teal-700')}>{fmtMoney(Math.abs(current.balance))}</p>
      </div>

      {debt > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button className="rounded-xl bg-teal-700 py-2 font-bold text-white" onClick={() => { setMode(mode === 'cash' ? 'none' : 'cash'); reset() }}>
            پرداخت نقدی
          </button>
          <button className="rounded-xl bg-amber-600 py-2 font-bold text-white" onClick={() => { setMode(mode === 'goods' ? 'none' : 'goods'); reset() }}>
            پرداخت با کفش
          </button>
        </div>
      )}

      {mode === 'cash' && (
        <div className="mb-3 rounded-xl border border-teal-200 bg-teal-50 p-3">
          <Field label="مبلغ پرداخت *">
            <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={parseNum(amount) <= 0}
            onClick={async () => {
              try {
                await payExpenseCreditorCash(current.id!, parseNum(amount), Date.now(), note)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت پرداخت نقدی
          </PrimaryBtn>
        </div>
      )}

      {mode === 'goods' && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs text-amber-800">قیمت توافقی از قرض کم می‌شود و فایدهٔ کفش در راپور امروز، ماه و سال می‌آید.</p>
          <Field label="کفش موجود در گدام *">
            <select className={inputCls} value={variantId} onChange={(e) => { setVariantId(e.target.value ? Number(e.target.value) : ''); setQty('1'); setPrice('') }}>
              <option value="">انتخاب کنید...</option>
              {options?.map((option) => (
                <option key={option.variantId} value={option.variantId}>
                  {option.productName} — {option.size} — {option.color} ({fmtNum(option.stockQty)} موجود)
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
                <Field label="قیمت توافقی فی‌جوړه *">
                  <input className={inputCls} inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} />
                </Field>
              </div>
              <button
                className="mb-3 w-full rounded-xl border border-amber-500 bg-white py-2 text-sm font-bold text-amber-800"
                onClick={() => {
                  const selected = options?.find((option) => option.variantId === variantId)
                  const count = parseNum(qty)
                  const agreed = parseNum(price)
                  if (!selected || !Number.isInteger(count) || count <= 0 || count > selected.stockQty || agreed <= 0) {
                    setError('کفش، تعداد موجود و قیمت توافقی را درست وارد کنید')
                    return
                  }
                  setLines((old) => [...old, {
                    variantId: selected.variantId,
                    productName: selected.productName,
                    size: selected.size,
                    color: selected.color,
                    qty: count,
                    unitPrice: agreed
                  }])
                  setVariantId('')
                  setQty('1')
                  setPrice('')
                  setError('')
                }}
              >
                ＋ افزودن کفش
              </button>
            </>
          )}
          {lines.map((line, index) => (
            <div key={String(line.variantId) + '-' + index} className="mb-1 flex items-center justify-between rounded-lg bg-white p-2 text-xs">
              <span>{line.productName} {line.size} {line.color} ×{fmtNum(line.qty)} — {fmtMoney(line.qty * line.unitPrice)}</span>
              <button className="font-bold text-red-600" onClick={() => setLines((old) => old.filter((_, i) => i !== index))}>حذف</button>
            </div>
          ))}
          {lines.length > 0 && <p className="my-2 font-bold text-slate-700">مجموع توافقی: {fmtMoney(goodsTotal)}</p>}
          {excess > 0 && (
            <Field label={'مازاد ' + fmtMoney(excess) + ' چگونه حساب شود؟'}>
              <div className="grid grid-cols-2 gap-2">
                <button className={'rounded-xl py-2 text-sm font-bold ' + (excessMode === 'cash' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600')} onClick={() => setExcessMode('cash')}>
                  نقداً دریافت شد
                </button>
                <button className={'rounded-xl py-2 text-sm font-bold ' + (excessMode === 'credit' ? 'bg-teal-700 text-white' : 'bg-white text-slate-600')} onClick={() => setExcessMode('credit')}>
                  قرض او به دکان
                </button>
              </div>
            </Field>
          )}
          <Field label="یادداشت">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <PrimaryBtn
            disabled={lines.length === 0}
            onClick={async () => {
              try {
                await payExpenseCreditorGoods(current.id!, lines, Date.now(), note, excessMode)
                setMode('none')
                reset()
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            }}
          >
            ثبت پرداخت با کفش
          </PrimaryBtn>
        </div>
      )}

      <p className="mb-2 font-bold text-slate-700">دفتر حساب مصرف</p>
      {[...(expenses ?? []).map((e) => ({ date: e.date, label: e.categoryName, amount: e.creditAmount ?? 0, kind: 'expense' as const, id: e.id!, note: e.note })),
        ...(payments ?? []).map((p) => ({ date: p.date, label: p.expenseCreditorSettlement === 'goods' ? 'پرداخت با کفش' : 'پرداخت نقدی', amount: -p.amount, kind: 'payment' as const, id: p.id!, note: p.note }))]
        .sort((a, b) => b.date - a.date)
        .map((row) => (
          <div key={row.kind + '-' + row.id} className="mb-2 rounded-lg bg-slate-50 p-2 text-sm">
            <div className="flex justify-between">
              <div>
                <p className="font-bold text-slate-700">{row.label}</p>
                <p className="text-xs text-slate-500">{fmtDate(row.date)}</p>
                {row.note && <p className="text-xs text-slate-500">{row.note}</p>}
              </div>
              <p className={row.amount > 0 ? 'font-bold text-red-600' : 'font-bold text-teal-700'}>
                {row.amount > 0 ? '+' : '−'}{fmtMoney(Math.abs(row.amount))}
              </p>
            </div>
            {row.kind === 'payment' && (
              <button
                className="mt-1 w-full border-t border-red-100 pt-1 text-xs font-bold text-red-600"
                onClick={async () => {
                  if (!confirm('این پرداخت اشتباه بود و حذف شود؟')) return
                  try {
                    await deletePayment(row.id)
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  }
                }}
              >
                اشتباه بود — حذف پرداخت
              </button>
            )}
          </div>
        ))}
    </Modal>
  )
}
