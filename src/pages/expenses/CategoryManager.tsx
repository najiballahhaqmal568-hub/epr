import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { renameCategory } from '../../lib/ops'
import { Modal, inputCls } from '../../components/ui'

export function CategoryManager({ onClose }: { onClose: () => void }) {
  const categories = useLiveQuery(() => db.expenseCategories.orderBy('name').filter((c) => !c.deleted).toArray(), [])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [newCat, setNewCat] = useState('')
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

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
        <div key={c.id} className="mb-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2">
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
      ))}
    </Modal>
  )
}

export default CategoryManager
