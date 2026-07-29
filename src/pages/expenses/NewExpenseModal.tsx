import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Expense } from '../../db'
import { addExpense, addPartnerWithdrawal } from '../../lib/ops'
import { parseNum } from '../../lib/format'
import { Modal, Field, inputCls, PrimaryBtn } from '../../components/ui'
import { TYPE_LABELS, type ExpenseMode } from './labels'

export function NewExpenseModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<ExpenseMode>('business')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [partnerId, setPartnerId] = useState<number | ''>('')
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [newCat, setNewCat] = useState('')
  const [showNewCat, setShowNewCat] = useState(false)
  const [error, setError] = useState('')

  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const partners = useLiveQuery(() => db.suppliers.filter((x) => !x.deleted && x.kind === 'partner').toArray(), [])

  const type = mode === 'partner' ? 'withdrawal' : mode
  const modeLabels: Record<ExpenseMode, string> = { ...TYPE_LABELS, partner: 'شریک' }
  const hasPartners = (partners?.length ?? 0) > 0
  // با وجود شریک، هر پولی که از تجارت بیرون می‌رود باید به نام کسی باشد
  const modes: ExpenseMode[] = hasPartners
    ? ['business', 'home', 'personal', 'partner']
    : ['business', 'home', 'personal', 'withdrawal']
  const needsPartner = hasPartners && mode !== 'business'
  // اگر فقط یک شریک باشد، خودکار انتخاب می‌شود
  const soloPartner = partners?.length === 1 ? partners[0] : undefined
  const chosenPartner = partners?.find((x) => x.id === partnerId) ?? soloPartner

  async function save() {
    const amt = parseNum(amount)
    if (amt <= 0) return setError('مبلغ را وارد کنید')
    try {
      if (needsPartner && !chosenPartner) return setError('انتخاب کنید این پول از سهم چه کسی کم شود')
      if (mode === 'partner') {
        await addPartnerWithdrawal(chosenPartner!.name, amt, note.trim() || undefined)
        onClose()
        return
      }
      let catId = categoryId as number | undefined
      let catName = 'برداشت مالک'
      if (mode !== 'withdrawal') {
        if (!categoryId) return setError('کتگوری را انتخاب کنید')
        catName = categories?.find((c) => c.id === categoryId)?.name ?? ''
      } else {
        catId = undefined
      }
      const e: Expense = { date: Date.now(), categoryId: catId, categoryName: catName, amount: amt, note: note.trim() || undefined, type }
      await addExpense(e, needsPartner ? chosenPartner!.name : undefined)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Modal title="ثبت مصرف" onClose={onClose}>
      <div className={`mb-1 grid gap-1 ${modes.length > 4 ? 'grid-cols-3' : 'grid-cols-4'}`}>
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-xl py-2 text-sm font-bold ${mode === m ? (m === 'business' ? 'bg-teal-700 text-white' : m === 'partner' ? 'bg-purple-600 text-white' : 'bg-amber-600 text-white') : 'bg-slate-100 text-slate-600'}`}
          >
            {modeLabels[m]}
          </button>
        ))}
      </div>
      <p className="mb-3 text-xs text-slate-400">
        {mode === 'business'
          ? 'از مفاد تجارت کم می‌شود.'
          : mode === 'partner'
            ? 'برداشت/مصرف شریک — آخر سال از سهم فایدهٔ همان شریک کم می‌شود.'
            : 'از صندوق کم می‌شود اما در مفاد تجارت حساب نمی‌شود.'}
        {needsPartner && mode !== 'partner' && ' این پول آخر سال از سهم همان شریک کم می‌شود.'}
      </p>

      {needsPartner && (
        <Field label={mode === 'partner' ? 'کدام شریک؟ *' : 'از سهم چه کسی کم شود؟ *'}>
          <select className={inputCls} value={partnerId} onChange={(e) => setPartnerId(e.target.value ? Number(e.target.value) : '')}>
            <option value="">انتخاب کنید...</option>
            {partners?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {mode !== 'withdrawal' && mode !== 'partner' && (
        <>
          <Field label="کتگوری *">
            <select className={inputCls} value={categoryId} onChange={(e) => setCategoryId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">انتخاب کنید...</option>
              {categories?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          {!showNewCat ? (
            <button className="mb-3 text-sm text-teal-700" onClick={() => setShowNewCat(true)}>
              ＋ کتگوری جدید
            </button>
          ) : (
            <div className="mb-3 flex gap-2">
              <input className={inputCls} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="نام کتگوری" />
              <button
                className="whitespace-nowrap rounded-xl bg-teal-700 px-4 font-bold text-white"
                onClick={async () => {
                  if (!newCat.trim()) return
                  const id = (await db.expenseCategories.add({ name: newCat.trim() })) as number
                  setCategoryId(id)
                  setNewCat('')
                  setShowNewCat(false)
                }}
              >
                افزودن
              </button>
            </div>
          )}
        </>
      )}

      <Field label="مبلغ *">
        <input className={inputCls} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="یادداشت">
        <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
      <PrimaryBtn onClick={save}>ذخیره</PrimaryBtn>
    </Modal>
  )
}

export default NewExpenseModal
