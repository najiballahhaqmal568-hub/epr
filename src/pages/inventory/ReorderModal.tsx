import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../../db'
import { fmtNum } from '../../lib/format'
import { Modal } from '../../components/ui'

export function ReorderModal({ onClose }: { onClose: () => void }) {
  const products = useLiveQuery(() => db.products.toArray(), [])
  const variants = useLiveQuery(() => db.variants.filter((v) => !v.deleted).toArray(), [])
  const low = (variants ?? []).filter((v) => v.stockQty <= v.lowStock)
  const productMap = new Map(products?.map((p) => [p.id!, p]))

  return (
    <Modal title="لیست خرید مجدد" onClose={onClose}>
      {low.length === 0 && <p className="text-slate-400">همه اجناس کافی است ✓</p>}
      {low.map((v) => {
        const p = productMap.get(v.productId)
        return (
          <div key={v.id} className="mb-2 flex justify-between rounded-lg bg-slate-50 p-2 text-sm">
            <span>
              {p?.name} — {v.size} {v.color}
              {p?.brand && <span className="text-slate-400"> ({p.brand})</span>}
            </span>
            <span className="font-bold text-red-600">
              {fmtNum(v.stockQty)} / حد {fmtNum(v.lowStock)}
            </span>
          </div>
        )
      })}
    </Modal>
  )
}

export default ReorderModal
