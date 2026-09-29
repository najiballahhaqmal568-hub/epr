/**
 * یادآوری بکاپ — یک قاعده، یک جا.
 *
 * تا حالا اپ نمی‌دانست کی بکاپ گرفته شده. اگر موبایل گم یا خراب می‌شد و همگام‌سازی هم قطع بود،
 * همهٔ حساب‌ها می‌رفت. قاعده:
 *  • فقط وقتی یادآوری می‌آید که چیزی برای محافظت باشد: از آخرین بکاپ سندی (فروش، دریافت/پرداخت، خرید،
 *    مصرف، مرجوعی) روی همین موبایل ثبت شده. دکان تازه یا بی‌تغییر مزاحم نمی‌شود.
 *  • و آخرین بکاپ ۷ روز یا بیشتر پیش بوده، یا هرگز بکاپ نگرفته‌اند.
 *  • «بعداً» تا فردا خاموشش می‌کند.
 * این‌ها تنظیم همین موبایل است (در فایل بکاپ نمی‌رود) و هیچ عددی از حساب‌ها را عوض نمی‌کند.
 */
import { db } from '../db'
import { addCalendarDays, startOfDay } from './format'
import { exportBackup } from './ops'

export const BACKUP_STALE_DAYS = 7
const DAY = 86400000
/** جدول‌هایی که «سند تازه» از آن‌ها شمرده می‌شود */
const DOC_TABLES = ['sales', 'payments', 'purchases', 'expenses', 'returns'] as const

export interface BackupNudge {
  kind: 'never' | 'stale'
  /** چند روز از آخرین بکاپ گذشته (برای «هرگز» صفر است) */
  days: number
  /** چند سند بعد از آخرین بکاپ ثبت یا عوض شده */
  changes: number
}

/** قاعدهٔ خالص — بدون دیتابیس، پس با آزمایش می‌شود قفلش کرد */
export function backupNudge(input: { lastBackupAt: number; snoozedUntil: number; now: number; changes: number }): BackupNudge | null {
  if (input.changes <= 0) return null
  if (input.now < input.snoozedUntil) return null
  if (input.lastBackupAt <= 0) return { kind: 'never', days: 0, changes: input.changes }
  const days = Math.floor((input.now - input.lastBackupAt) / DAY)
  if (days < BACKUP_STALE_DAYS) return null
  return { kind: 'stale', days, changes: input.changes }
}

/** از دیتابیس می‌خواند؛ داخل useLiveQuery با تغییر تنظیم یا سند خودش تازه می‌شود */
export async function readBackupNudge(now = Date.now()): Promise<BackupNudge | null> {
  const lastBackupAt = Number((await db.settings.get('lastBackupAt'))?.value ?? 0)
  const snoozedUntil = Number((await db.settings.get('backupSnoozeUntil'))?.value ?? 0)
  let changes = 0
  for (const table of DOC_TABLES) {
    changes += lastBackupAt <= 0 ? await db.table(table).count() : await db.table(table).where('localUpdatedAt').above(lastBackupAt).count()
  }
  return backupNudge({ lastBackupAt, snoozedUntil, now, changes })
}

export async function readLastBackupAt(): Promise<number> {
  return Number((await db.settings.get('lastBackupAt'))?.value ?? 0)
}

export async function noteBackupDone(at = Date.now()): Promise<void> {
  await db.settings.bulkPut([{ key: 'lastBackupAt', value: at }, { key: 'backupSnoozeUntil', value: 0 }])
}

/** «بعداً» — تا شروع فردا */
export async function snoozeBackupNudge(now = Date.now()): Promise<void> {
  await db.settings.put({ key: 'backupSnoozeUntil', value: addCalendarDays(startOfDay(now), 1) })
}

/** فایل بکاپ را می‌سازد و دانلود می‌کند؛ فقط بعد از موفقیت «بکاپ گرفته شد» ثبت می‌شود */
export async function downloadBackupNow(): Promise<string> {
  const json = await exportBackup()
  const filename = `shoe-erp-backup-${new Date().toISOString().slice(0, 10)}.json`
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
  await noteBackupDone()
  return filename
}
