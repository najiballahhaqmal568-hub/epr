/** آزمایش واقعی مرورگر: یکجا کردن اجناس تکراری در تب گدام */
import { chromium } from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'

const page = await (
  await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
).newPage()
const fail = (m) => {
  console.error('❌ ' + m)
  process.exit(1)
}

await page.goto(URL)
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

// دو جنس تکراری با موجودی
await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  const put = (store, obj) =>
    new Promise((res, rej) => {
      const t = dbx.transaction(store, 'readwrite')
      const q = t.objectStore(store).add(obj)
      q.onsuccess = () => res(q.result)
      q.onerror = () => rej(q.error)
    })
  const pA = await put('products', { name: 'کوهستان', createdAt: Date.now() })
  const pB = await put('products', { name: 'کوهستان جوړه‌ای', createdAt: Date.now() })
  const mk = (pid, size, qty) =>
    put('variants', {
      productId: pid,
      size,
      color: 'سیاه',
      stockQty: qty,
      purchasePrice: 500,
      retailPrice: 900,
      wholesalePrice: 800,
      lowStock: 2
    })
  await mk(pA, '42', 480)
  await mk(pA, '43', 240)
  await mk(pB, '42', 12)
  await mk(pB, '44', 7)
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=گدام')
await page.waitForTimeout(800)

const banner = page.locator('text=/جنس چند بار ثبت شده/')
if (!(await banner.count())) fail('بنر «تکراری» نیامد')
await banner.first().click()
await page.waitForSelector('text=یکجا کردن اجناس تکراری')
await page.click('text=این‌ها یک جنس است — یکجا کن')
await page.waitForSelector('text=کدام نام بماند؟')
await page.click('text=✓ یکجا کن')
await page.waitForSelector('text=/بدون تغییر/', { timeout: 10000 })
const msg = await page.locator('text=/مجموع جوړه:/').first().innerText()
console.log('پیام: ' + msg.replace(/\s+/g, ' '))
await page.click('[aria-label="بستن"], button:has-text("✕")').catch(() => {})
await page.keyboard.press('Escape')

// در گدام باید یک «کوهستان» با ۷۳۹ جوړه بماند
await page.waitForTimeout(500)
const body = await page.locator('body').innerText()
if (!/۷۳۹ جوړه/.test(body)) fail('مجموع ۷۳۹ جوړه در گدام دیده نشد:\n' + body.slice(0, 600))
if (/جوړه‌ای/.test(body)) fail('جنس تکراری هنوز در گدام است')
console.log('✅ یکجا شدن در مرورگر واقعی درست کار کرد')

// انتخاب دستی: دو نامِ کاملاً متفاوت که یک جنس‌اند
await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  const put = (store, obj) =>
    new Promise((res, rej) => {
      const t = dbx.transaction(store, 'readwrite')
      const q = t.objectStore(store).add(obj)
      q.onsuccess = () => res(q.result)
      q.onerror = () => rej(q.error)
    })
  const p1 = await put('products', { name: 'بامیان', createdAt: Date.now() })
  const p2 = await put('products', { name: 'بوجی بامیان کلان', createdAt: Date.now() })
  const mk = (pid, size, qty) =>
    put('variants', {
      productId: pid,
      size,
      color: 'سیاه',
      stockQty: qty,
      purchasePrice: 500,
      retailPrice: 900,
      wholesalePrice: 800,
      lowStock: 2
    })
  await mk(p1, '42', 100)
  await mk(p2, '42', 25)
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=گدام')
// بنر تکراری این‌جا نمی‌آید چون نام‌ها فرق دارد — باید دکمهٔ همیشگی باشد
await page.click('button:has-text("🔗 یکجا کردن")')
await page.waitForSelector('text=یکجا کردن اجناس تکراری')
await page.click('button:has-text("انتخاب دستی")')
await page.waitForSelector('text=دو یا چند جنس را خودتان انتخاب کنید')
await page.click('button:has-text("بامیان"):not(:has-text("بوجی"))')
await page.click('button:has-text("بوجی بامیان کلان")')
const cont = page.locator('button:has-text("ادامه (۲ جنس)")')
if (!(await cont.count())) fail('دکمهٔ «ادامه» با ۲ انتخاب نیامد — انتخاب دستی باز هم خراب است')
await cont.click()
await page.waitForSelector('text=کدام نام بماند؟')
await page.click('text=✓ یکجا کن')
await page.waitForSelector('text=/بدون تغییر/', { timeout: 10000 })
const m2 = await page.locator('text=/مجموع جوړه:/').first().innerText()
console.log('پیام دستی: ' + m2.replace(/\s+/g, ' '))
if (!/۱۲۵ ← ۱۲۵/.test(m2)) fail('انتخاب دستی مجموع را تغییر داد: ' + m2)
console.log('✅ انتخاب دستی هم درست کار کرد')
process.exit(0)
