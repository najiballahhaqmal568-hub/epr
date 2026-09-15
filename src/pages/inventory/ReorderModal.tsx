import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum } from '../../lib/format'
import { Modal } from '../../components/ui'
import { reorderProducts } from '../../lib/reorder'

export function ReorderModal({ onClose }: { onClose: () => void }) {
  const products = useLiveQuery(() => db.products.filter((p) => !p.deleted).toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const low = reorderProducts(products ?? [], variants ?? [])

  return (
    <Modal title="لیست خرید مجدد" onClose={onClose}>
      {low.length === 0 && <p className="rounded-2xl bg-blue-50 p-4 text-center text-sm text-blue-800">همه اجناس کافی است.</p>}
      {low.map((info) => (
          <section key={info.product.id} className="mb-3 rounded-2xl border border-blue-100 bg-white p-4 text-sm shadow-sm" aria-label={`خرید مجدد ${info.product.name}`}>
            <div className="flex justify-between gap-2">
            <span className="font-bold text-slate-800">
              {info.product.name}
              {info.product.brand && <span className="text-slate-400"> ({info.product.brand})</span>}
            </span>
            <span className="text-left font-bold text-red-600">
              {fmtNum(info.stockPairs)} / {fmtNum(info.thresholdPairs)} جفت
            </span>
            </div>
            <p className="mt-3 rounded-xl bg-blue-50 p-2.5 text-xs leading-5 text-blue-900">
              موجودی همهٔ رنگ‌ها و سایزها: <b>{fmtNum(info.stockPairs)} جفت</b> · حد خرید مجدد: <b>{fmtNum(info.reorderCartons)} کارتن × {fmtNum(info.pairsPerCarton)} جفت</b>
            </p>
            <p className="mt-2 text-xs text-slate-500">
              {info.product.carton?.items.length
                ? `${fmtNum(info.fullCartons)} کارتن کامل${info.loosePairs ? ` و ${fmtNum(info.loosePairs)} جفت` : ''}`
                : `معادل ${fmtNum(info.fullCartons)} کارتن${info.loosePairs ? ` و ${fmtNum(info.loosePairs)} جفت` : ''}؛ ترکیب کامل کارتن ثبت نشده است`}
            </p>
          </section>
      ))}
    </Modal>
  )
}

export default ReorderModal
