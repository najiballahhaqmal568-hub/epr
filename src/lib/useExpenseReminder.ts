import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { dailyReminderItems } from './dailyExpenses'
import { toDateInput } from './format'

/** یادآوری کتگوری‌های روزانهٔ ثبت‌نشده؛ عقب‌مانده‌های گذشته همیشه دیده می‌شوند. */
export function useExpenseReminder() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 15 * 60 * 1000)
    return () => clearInterval(timer)
  }, [])

  const data = useLiveQuery(async () => {
    const on = (await db.settings.get('expenseReminderOn'))?.value === true
    if (!on) return { show: false, count: 0 }
    const hour = Number((await db.settings.get('expenseReminderHour'))?.value ?? 18)
    const dismissed = (await db.settings.get('expenseReminderDismissed'))?.value
    const todayKey = toDateInput(Date.now())
    if (dismissed === todayKey) return { show: false, count: 0 }
    const items = await dailyReminderItems(Date.now(), hour)
    return { show: items.length > 0, count: items.length }
  }, [tick])

  const show = data?.show ?? false
  const count = data?.count ?? 0

  useEffect(() => {
    if (show && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const key = `daily-expenses-${toDateInput(Date.now())}`
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1')
        try {
          new Notification('فروشگاه اتل', { body: `${count} مصرف روزانه ثبت نشده است.` })
        } catch {
          /* بنر داخل اپ کافی است */
        }
      }
    }
  }, [show, count])

  async function dismissToday() {
    await db.settings.put({ key: 'expenseReminderDismissed', value: toDateInput(Date.now()) })
  }

  return { show, count, dismissToday }
}
