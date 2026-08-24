/**
 * e2e — تقویم مصارف: سوییچ تقویم/فهرست، خانهٔ امروز، افزودن مصرف برای یک روز.
 * اجرا: سرور توسعه (vite) بالا باشد و URL با ?ui-preview=1 داده شود:
 *   URL='http://127.0.0.1:4191/?ui-preview=1' node tests/expense-calendar-e2e.mjs
 */
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'

const URL = process.env.URL ?? 'http://127.0.0.1:4191/?ui-preview=1'
const candidates = [
  process.env.CHROMIUM_PATH,
  '/opt/pw-browsers/chromium',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
].filter(Boolean)
const executablePath = candidates.find((candidate) => existsSync(candidate))
if (!executablePath) throw new Error('Chromium/Chrome/Edge پیدا نشد؛ CHROMIUM_PATH را تنظیم کنید')

let bad = 0
const check = (name, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${got}${ok ? '' : ` (باید ${want})`}`)
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('dialog', (d) => d.accept())

await page.goto(URL)
// صندوق خالی → ثبت مصرف رد می‌شود؛ سرمایهٔ آزمایشی می‌کاریم
await page.evaluate(async () => {
  const db = (await import('/src/db.ts')).db
  await db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount: 1000, note: 'سرمایهٔ دیباگ' })
})
await page.waitForSelector('nav >> text=بیشتر', { timeout: 30000 })
await page.click('nav >> text=بیشتر')
await page.click('text=مصارف و صندوق')
await page.waitForSelector('button:has-text("ثبت مصرف جدید")', { timeout: 30000 })

// پیش‌فرض: فهرست — سوییچ به تقویم
check('پیش‌فرض فهرست است', await page.locator('button:text-is("📋 فهرست")').getAttribute('class').then((c) => c.includes('bg-teal-700')), true)
await page.click('button:has-text("تقویم")')
await page.waitForSelector('text=لمس کنید تا مصارف روز باز شود', { timeout: 10000 })
check('تقویم باز شد', true, true)

// عنوان و شمارهٔ امروز باید واقعاً هجری شمسی باشد، نه ماه/روز میلادی با برچسب دری.
const persianParts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  year: 'numeric', month: 'numeric', day: 'numeric'
}).formatToParts(Date.now())
const persianPart = (type) => Number(persianParts.find((part) => part.type === type)?.value ?? 0)
const expectedMonth = new Intl.DateTimeFormat('fa-AF-u-ca-persian', {
  year: 'numeric', month: 'long'
}).format(Date.now())
const calendarText = await page.locator('div.rounded-2xl.bg-white').filter({ hasText: 'لمس کنید تا مصارف روز باز شود' }).first().innerText()
check('عنوان ماه هجری شمسی درست است', calendarText.includes(expectedMonth), true)

// هفت روز هفته — سرستون‌ها
const weekdayCount = await page.locator('span:text-is("ش")').count()
check('سرستون شنبه هست', weekdayCount >= 1, true)

// لمس خانهٔ امروز (حلقهٔ ring دارد) — آخرین خانهٔ فعال با متن عدد
const todayCell = page.locator('button.ring-2').first()
const expectedDay = persianPart('day').toLocaleString('fa-AF')
check('شمارهٔ خانهٔ امروز هجری شمسی است', (await todayCell.innerText()).split('\n')[0], expectedDay)
await todayCell.click()
await page.waitForSelector('text=مصرف برای این روز', { timeout: 10000 })
await page.click('button:has-text("مصرف برای این روز")')
await page.waitForSelector('text=ثبت مصرف برای روز انتخاب‌شده', { timeout: 10000 })
check('فورم مصرف با تاریخ روز انتخاب‌شده باز شد', true, true)

// ثبت یک مصرف ساده برای همان روز: کتگوری اول + مبلغ ۵۰
await page.locator('label:has-text("کتگوری *") select').selectOption({ index: 1 })
await page.locator('label:has-text("یادداشت") input').fill('چای دیباگ تقویم')
const amountInput = page.locator('label:has-text("مبلغ *") input').first()
await amountInput.fill('50')
await page.click('button:text-is("ذخیره")')
await page.waitForSelector('button:has-text("تقویم")', { timeout: 10000 })

// دوباره تقویم — خانهٔ امروز باید مجموع ۵۰ را نشان دهد
await page.click('button:has-text("تقویم")')
await page.waitForSelector('text=لمس کنید تا مصارف روز باز شود')
const todayText = await page.locator('button.ring-2').first().innerText()
check('مجموع امروز در خانه دیده می‌شود', todayText.includes('\u0650') || todayText.includes('50') || todayText.includes('۵۰'), true)

// برگشت به فهرست — مصرف تازه در فهرست هست
await page.click('button:has-text("فهرست")')
await page.waitForSelector('text=چای دیباگ تقویم', { timeout: 10000 })
check('فهرست: مصرف تازه دیده می‌شود', true, true)

console.log(bad === 0 ? '\n✅ تقویم مصارف سالم است' : `\n❌ ${bad} بررسی ناکام`)
await browser.close()
process.exit(bad === 0 ? 0 : 1)
