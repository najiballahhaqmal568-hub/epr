import { db, type Expense, type ExpenseCategory } from '../db'
import { startOfDay } from './format'

const DAY = 86_400_000

export interface DailyExpenseItem {
  day: number
  category: ExpenseCategory
}

export async function configureDailyCategory(
  categoryId: number,
  enabled: boolean,
  defaultAmount = 0,
  defaultPaymentMode: 'cash' | 'credit' | 'mixed' = 'cash'
): Promise<void> {
  const category = await db.expenseCategories.get(categoryId)
  if (!category || category.deleted) throw new Error('کتگوری یافت نشد')
  const amount = Math.round(defaultAmount)
  if (amount < 0) throw new Error('مبلغ پیشنهادی نمی‌تواند منفی باشد')
  await db.transaction('rw', db.expenseCategories, db.settings, async () => {
    await db.expenseCategories.update(categoryId, {
      dailyEnabled: enabled,
      dailyFrom: enabled ? (category.dailyEnabled && category.dailyFrom ? category.dailyFrom : Date.now()) : category.dailyFrom,
      dailyDefaultAmount: amount,
      dailyDefaultPaymentMode: defaultPaymentMode
    })
    if (enabled && (await db.settings.get('expenseReminderOn'))?.value !== false) {
      await db.settings.put({ key: 'expenseReminderOn', value: true })
    }
  })
}

function daySequence(from: number, through: number): number[] {
  const days: number[] = []
  for (let cursor = startOfDay(from); cursor <= startOfDay(through); ) {
    days.push(cursor)
    const next = new Date(cursor)
    next.setDate(next.getDate() + 1)
    cursor = startOfDay(next.getTime())
  }
  return days
}

/** کتگوری‌های ثبت‌نشده برای روزهای باز، فقط از زمان فعال‌شدن هر کتگوری. */
export async function dailyExpenseItems(now = Date.now()): Promise<DailyExpenseItem[]> {
  const categories = await db.expenseCategories
    .filter((category) => !category.deleted && category.dailyEnabled === true && typeof category.dailyFrom === 'number')
    .toArray()
  if (categories.length === 0) return []

  const firstDay = Math.min(...categories.map((category) => startOfDay(category.dailyFrom!)))
  const lastDay = startOfDay(now)
  const rows = await db.expenses.where('date').between(firstDay, lastDay + DAY, true, false).toArray()
  const live = rows.filter((row) => !row.deleted)
  const closedDays = new Set(live.filter((row) => row.shopClosed).map((row) => startOfDay(row.date)))
  const completed = new Set(
    live
      .filter((row) => !row.shopClosed && row.type === 'business' && typeof row.categoryId === 'number')
      .map((row) => `${startOfDay(row.date)}:${row.categoryId}`)
  )

  const missing: DailyExpenseItem[] = []
  for (const day of daySequence(firstDay, lastDay)) {
    if (closedDays.has(day)) continue
    for (const category of categories) {
      if (day < startOfDay(category.dailyFrom!)) continue
      if (!completed.has(`${day}:${category.id}`)) missing.push({ day, category })
    }
  }
  return missing
}

/** عقب‌مانده‌های گذشته همیشه؛ موارد امروز فقط پس از ساعت تنظیم‌شده. */
export async function dailyReminderItems(now = Date.now(), hour = 18): Promise<DailyExpenseItem[]> {
  const today = startOfDay(now)
  const currentHour = new Date(now).getHours()
  return (await dailyExpenseItems(now)).filter((item) => item.day < today || currentHour >= hour)
}

export async function isShopClosed(day = Date.now()): Promise<boolean> {
  const start = startOfDay(day)
  return Boolean(await db.expenses.where('date').between(start, start + DAY, true, false).filter((row) => !row.deleted && row.shopClosed === true).first())
}

/** روز بسته یک وضعیت همگام‌شونده است، نه مصرف صفر. */
export async function setShopClosed(day: number, closed: boolean): Promise<void> {
  const start = startOfDay(day)
  await db.transaction('rw', db.expenses, async () => {
    const existing = await db.expenses.where('date').between(start, start + DAY, true, false).filter((row) => row.shopClosed === true).first()
    if (closed) {
      if (existing) {
        if (existing.deleted) await db.expenses.update(existing.id!, { deleted: false, date: start + 12 * 60 * 60 * 1000 })
        return
      }
      const row: Expense = {
        date: start + 12 * 60 * 60 * 1000,
        categoryName: 'روز بسته',
        amount: 0,
        cashPaid: 0,
        creditAmount: 0,
        type: 'business',
        shopClosed: true
      }
      await db.expenses.add(row)
    } else if (existing && !existing.deleted) {
      await db.expenses.update(existing.id!, { deleted: true })
    }
  })
}
