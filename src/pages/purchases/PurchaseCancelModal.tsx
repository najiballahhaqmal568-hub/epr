import { useEffect, useState } from 'react'
import type { Purchase } from '../../db'
import { cancelPurchase, cancelPurchaseImpact, type PurchaseCancelImpact } from '../../lib/ops'
import { fmtMoney, fmtNum } from '../../lib/format'
import { Modal } from '../../components/ui'

export default function PurchaseCancelModal({ purchase, onClose }: { purchase: Purchase; onClose: () => void }) {
  const [impact, setImpact] = useState<PurchaseCancelImpact | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void cancelPurchaseImpact(purchase.id!).then((value) => {
      if (active) setImpact(value)
    })
    return () => {
      active = false
    }
  }, [purchase.id])

  async function confirm() {
    if (!purchase.id || !impact || impact.blockedReason || saving) return
    setSaving(true)
    setError('')
    try {
      await cancelPurchase(purchase.id)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ابطال خرید انجام نشد')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="باطل‌کردن خرید اشتباهی" onClose={onClose}>
      <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold leading-6 text-red-800">
        این خرید از لیست فعال حذف می‌شود، اما برای سابقه با علامت «باطل» نگه داشته می‌شود. اثرهای زیر کامل برمی‌گردند.
      </p>

      {!impact && <p className="py-6 text-center text-sm text-slate-500">در حال حساب اثرها…</p>}
      {impact && (
        <>
          <div className="mb-3 rounded-xl border border-slate-200 p-3 text-sm">
            <p className="mb-2 font-bold text-slate-800">اثر بر گدام</p>
            {impact.stockChanges.length === 0 ? (
              <p className="text-slate-500">جنس هنوز در راه است؛ گدام تغییر نمی‌کند.</p>
            ) : (
              impact.stockChanges.map((change) => (
                <div key={change.variantId} className="flex justify-between py-1 text-slate-700">
                  <span>{change.productName} {change.size} {change.color}</span>
                  <span className="font-bold text-red-700">{fmtNum(change.qtyChange)} جوړه</span>
                </div>
              ))
            )}
          </div>

          <div className="mb-3 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="flex justify-between"><span>برگشت پول به {impact.cashBox}</span><span className="font-bold text-teal-700">{fmtMoney(impact.cashReturn)}</span></div>
            {impact.landingCashReturn > 0 && <p className="mt-1 text-xs text-slate-500">شامل {fmtMoney(impact.landingCashReturn)} مصارف رسیدن پرداخت‌شده</p>}
            <div className="mt-2 flex justify-between"><span>کاهش قرض تأمین‌کننده</span><span className="font-bold text-red-700">{fmtMoney(impact.supplierDebtDecrease)}</span></div>
            {impact.sarrafDebtDecrease > 0 && (
              <div className="mt-1 flex justify-between"><span>کاهش قرض صراف</span><span className="font-bold text-red-700">{fmtMoney(impact.sarrafDebtDecrease)}</span></div>
            )}
          </div>

          {impact.blockedReason && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-bold leading-6 text-amber-800">{impact.blockedReason}</p>}
        </>
      )}

      {error && <p className="mb-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p>}
      <button
        onClick={() => void confirm()}
        disabled={!impact || Boolean(impact.blockedReason) || saving}
        className="w-full rounded-xl bg-red-700 py-3 font-bold text-white active:bg-red-800 disabled:opacity-40"
      >
        {saving ? 'در حال ابطال…' : 'بلی، این خرید اشتباهی است — باطل شود'}
      </button>
    </Modal>
  )
}
