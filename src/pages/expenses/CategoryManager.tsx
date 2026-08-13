import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { renameCategory } from '../../lib/ops'
import { configureDailyCategory } from '../../lib/dailyExpenses'
import { parseNum } from '../../lib/format'
import { Modal, inputCls } from '../../components/ui'

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [newCat, setNewCat] = useState('')
  const [confirmingId, setConfirmingId] = useState<number | null>(null)
  const [dailyId, setDailyId] = useState<number | null>(null)
  const [dailyAmount, setDailyAmount] = useState('')
  const [dailyPayment, setDailyPayment] = useState<'cash' | 'credit' | 'mixed'>('cash')

  return (
    <Modal title="مدیریت کتگوری‌ها" onClose={onClose}>
      <div className="mb-4 flex gap-2">
        <input className={inputCls} value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder="کتگوری جدید..." />
        <button
          className="whitespace-nowrap rounded-xl bg-teal-700 px-4 font-bold text-white disabled:opacity-40"
          disabled={!newCat.trim()}
          onClick={async () => {
            await db.expenseCategories.add({ name: newCat.trim() })
            setNewCat('')
          }}
        >
          افزودن
        </button>
      </div>

      {categories?.map((c) => (
        <div key={c.id} className="mb-2 rounded-xl bg-slate-50 p-2">
          <div className="flex items-center gap-2">
          {editingId === c.id ? (
            <>
              <input className={inputCls} value={editName} onChange={(e) => setEditName(e.target.value)} />
              <button
                className="whitespace-nowrap rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-bold text-white"
                onClick={async () => {
                  if (editName.trim()) await renameCategory(c.id!, editName.trim())
                  setEditingId(null)
                }}
              >
                ذخیره
              </button>
            </>
          ) : (
            <>
              <span className="flex-1 font-bold text-slate-700">{c.name}</span>
              <button
                className={`rounded-lg px-2 py-1 text-xs font-bold ${c.dailyEnabled ? 'bg-amber-100 text-amber-800' : 'text-slate-500'}`}
                onClick={() => {
                  setDailyId(dailyId === c.id ? null : c.id!)
                  setDailyAmount(c.dailyDefaultAmount ? String(c.dailyDefaultAmount) : '')
                  setDailyPayment(c.dailyDefaultPaymentMode ?? 'cash')
                }}
              >
                {c.dailyEnabled ? 'روزانه ✓' : 'روزانه'}
              </button>
              <button
                className="text-sm text-teal-700"
                onClick={() => {
                  setEditingId(c.id!)
                  setEditName(c.name)
                }}
              >
                تغییر نام
              </button>
              {confirmingId === c.id ? (
                <button
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-bold text-white"
                  onClick={async () => {
                    await db.expenseCategories.update(c.id!, { deleted: true })
                    setConfirmingId(null)
                  }}
                >
                  تأیید حذف؟
                </button>
              ) : (
                <button
                  className="text-sm text-red-500"
                  onClick={() => {
                    setConfirmingId(c.id!)
                    setTimeout(() => setConfirmingId((id) => (id === c.id ? null : id)), 4000)
                  }}
                >
                  حذف
                </button>
              )}
            </>
          )}
          </div>
          {dailyId === c.id && (
            <div className="mt-2 border-t border-slate-200 pt-2">
              <label className="mb-1 block text-xs font-bold text-slate-600">مبلغ پیشنهادی (هر روز قابل تغییر)</label>
              <input className={inputCls} inputMode="numeric" value={dailyAmount} onChange={(e) => setDailyAmount(e.target.value)} />
              <div className="my-2 grid grid-cols-3 gap-1">
                {([['cash', 'نقدی'], ['credit', 'قرضی'], ['mixed', 'نقد و قرض']] as const).map(([value, label]) => (
                  <button key={value} className={`rounded-lg py-1.5 text-xs font-bold ${dailyPayment === value ? 'bg-teal-700 text-white' : 'bg-white text-slate-600'}`} onClick={() => setDailyPayment(value)}>{label}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="rounded-lg bg-teal-700 py-2 text-sm font-bold text-white" onClick={async () => {
                  await configureDailyCategory(c.id!, true, parseNum(dailyAmount), dailyPayment)
                  setDailyId(null)
                }}>فعال و ذخیره</button>
                <button className="rounded-lg bg-slate-200 py-2 text-sm font-bold text-slate-700" onClick={async () => {
                  await configureDailyCategory(c.id!, false, parseNum(dailyAmount), dailyPayment)
                  setDailyId(null)
                }}>غیرفعال</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </Modal>
  )
}

export default CategoryManager
