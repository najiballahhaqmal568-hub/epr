/**
 * e2e — دکمهٔ برگشتِ تلیفون: یک قدم عقب داخل اپ، نه خروج.
 * اجرا: سرور توسعه روی 4191 و URL با ?ui-preview=1
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
const executablePath = candidates.find((c) => existsSync(c))
if (!executablePath) throw new Error('Chromium/Chrome/Edge پیدا نشد')

let bad = 0
const check = (name, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${got}${ok ? '' : ` (باید ${want})`}`)
}

const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
await page.goto(URL)
await page.waitForSelector('nav >> text=بیشتر', { timeout: 30000 })

// خانه ← بیشتر ← مصارف
await page.click('nav >> text=بیشتر')
await page.waitForSelector('text=مصارف و صندوق', { timeout: 10000 })
await page.click('text=مصارف و صندوق')
await page.waitForSelector('button:has-text("ثبت مصرف جدید")', { timeout: 10000 })

// برگشت تلیفون ← باید روی «بیشتر» برگردد، نه خروج
await page.goBack()
await page.waitForSelector('text=مصارف و صندوق', { timeout: 10000 })
check('برگشت اول: به بیشتر برگشت', true, true)

// برگشت دوم ← خانه
await page.goBack()
await page.waitForSelector('button:has-text("خرید جدید")', { timeout: 10000 })
check('برگشت دوم: به خانه برگشت', true, true)

// مودال: باز کردن فروش جدید، برگشت تلیفون باید فقط مودال را ببندد
await page.click('nav >> text=فروش')
await page.waitForSelector('button:has-text("فروش جدید")', { timeout: 10000 })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.click('button:has-text("فروش جدید")')
await page.waitForSelector('button:has-text("ثبت فروش")', { timeout: 10000 })
await page.goBack()
await page.waitForTimeout(500)
const modalGone = (await page.locator('.fixed.inset-0').count()) === 0
const stillSales = await page.locator('button:has-text("فروش جدید")').count()
check('برگشت روی مودال: مودال بسته شد', modalGone, true)
check('برگشت روی مودال: در تب فروش ماند', stillSales > 0, true)

console.log(bad === 0 ? '\n✅ دکمهٔ برگشت تلیفون سالم است' : `\n❌ ${bad} بررسی ناکام`)
await browser.close()
process.exit(bad === 0 ? 0 : 1)
