import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { startOfDay, toDateInput } from './format'

/** یادآوری آخر روز: اگر فعال باشد، ساعت گذشته باشد و امروز مصرفی ثبت نشده باشد */
export function useExpenseReminder() {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 15 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const data = useLiveQuery(async () => {
    const on = (await db.settings.get('expenseReminderOn'))?.value === true
    if (!on) return { show: false }
    const hour = Number((await db.settings.get('expenseReminderHour'))?.value ?? 18)
    const dismissed = (await db.settings.get('expenseReminderDismissed'))?.value
    const todayKey = toDateInput(Date.now())
    if (dismissed === todayKey) return { show: false }
    if (new Date().getHours() < hour) return { show: false }
    const todayCount = await db.expenses.where('date').aboveOrEqual(startOfDay()).count()
    return { show: todayCount === 0 }
  }, [tick])

  const show = data?.show ?? false

  useEffect(() => {
    if (show && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      const key = `notified-${toDateInput(Date.now())}`
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1')
        try {
          new Notification('فروشگاه اتل', { body: 'مصارف امروز را ثبت نکرده‌اید. فراموش نشود!' })
        } catch {
          /* بعضی مرورگرها در PWA اجازه نمی‌دهند — بنر داخل اپ کافی است */
        }
      }
    }
  }, [show])

  async function dismissToday() {
    await db.settings.put({ key: 'expenseReminderDismissed', value: toDateInput(Date.now()) })
  }

  return { show, dismissToday }
}
