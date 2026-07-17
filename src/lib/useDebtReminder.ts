import { useEffect } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { fmtNum, fmtMoney, toDateInput } from './format'

/** یادآوری روزانهٔ قرضداران: هر روز یک بار لیست مشتریان قرضدار را یادآوری می‌کند */
export function useDebtReminder() {
  const data = useLiveQuery(async () => {
    const off = (await db.settings.get('debtReminderOn'))?.value === false
    if (off) return { show: false, count: 0, total: 0 }
    const dismissed = (await db.settings.get('debtReminderDismissed'))?.value
    if (dismissed === toDateInput(Date.now())) return { show: false, count: 0, total: 0 }
    const debtors = await db.customers.filter((c) => !c.deleted && c.balance > 0).toArray()
    return {
      show: debtors.length > 0,
      count: debtors.length,
      total: debtors.reduce((s, c) => s + c.balance, 0)
    }
  }, [])

  const show = data?.show ?? false
  const count = data?.count ?? 0
  const total = data?.total ?? 0

  useEffect(() => {
    if (show && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const key = `debt-notified-${toDateInput(Date.now())}`
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1')
        try {
          new Notification('فروشگاه اتل', {
            body: `${fmtNum(count)} مشتری قرضدار — مجموع ${fmtMoney(total)}. امروز تقاضای قرض فراموش نشود!`
          })
        } catch {
          /* بنر داخل اپ کافی است */
        }
      }
    }
  }, [show, count, total])

  async function dismissToday() {
    await db.settings.put({ key: 'debtReminderDismissed', value: toDateInput(Date.now()) })
  }

  return { show, count, total, dismissToday }
}
