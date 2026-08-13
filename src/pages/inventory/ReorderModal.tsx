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
      {low.length === 0 && <p className="text-slate-400">همه اجناس کافی است ✓</p>}
      {low.map((info) => (
          <div key={info.product.id} className="mb-2 rounded-lg bg-slate-50 p-3 text-sm">
            <div className="flex justify-between gap-2">
            <span>
              {info.product.name}
              {info.product.brand && <span className="text-slate-400"> ({info.product.brand})</span>}
            </span>
            <span className="font-bold text-red-600">
              {fmtNum(info.stockPairs)} / حد {fmtNum(info.thresholdPairs)} جفت
            </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              هر کارتن {fmtNum(info.pairsPerCarton)} جفت · هشدار در {fmtNum(info.reorderCartons)} کارتن
            </p>
          </div>
      ))}
    </Modal>
  )
}

export default ReorderModal
