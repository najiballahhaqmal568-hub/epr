import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { normalizeName } from '../lib/merge'

/**
 * وقتی نامی نوشته می‌شود که در گدام هست، هشدار می‌دهد — تا یک جنس
 * دو بار (کارتنی و جوړه‌ای) ثبت نشود.
 */
export default function DuplicateNameHint({ name, ignoreId }: { name: string; ignoreId?: number }) {
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const key = normalizeName(name)
  if (!key || !products) return null
  const hits = products.filter((p) => p.id !== ignoreId && normalizeName(p.name) === key)
  if (hits.length === 0) return null

  return (
    <p className="-mt-2 mb-3 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-900">
      ⚠️ «{hits[0].name}» از قبل در گدام هست. اگر همین جنس است، <b>جنس نو نسازید</b> — همان را انتخاب کنید و جوړه‌ها را
      به آن اضافه کنید. بسته‌بندی (کارتن، بوجی، جوړه) جنس را جدا نمی‌کند.
    </p>
  )
}
