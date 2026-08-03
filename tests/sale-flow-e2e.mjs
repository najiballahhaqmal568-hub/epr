/** آزمایش واقعی مرورگر: بعد از ثبت فروش، رسید خودبه‌خود باز نشود */
import { chromium } from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const page = await (
  await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
).newPage()
page.on('pageerror', (e) => console.error('خطای صفحه:', e.message))
const fail = (m) => {
  console.error('❌ ' + m)
  process.exit(1)
}

await page.goto(URL)
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

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
  const pid = await put('products', { name: 'کوهستان', createdAt: Date.now() })
  await put('variants', {
    productId: pid, size: '42', color: 'سیاه',
    stockQty: 20, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2
  })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=فروش')
await page.click('button:has-text("فروش جدید")')
await page.waitForTimeout(700)

// جنس را از تایل پرفروش یا جستجو اضافه کن
const tile = page.locator('button:has-text("کوهستان")').first()
await tile.click()
await page.waitForSelector('text=انتخاب سایز')
await page.click('button:has-text("42 سیاه")')
await page.waitForTimeout(500)
await page.click('button:has-text("ثبت فروش")')
await page.waitForTimeout(1200)

const body = await page.locator('body').innerText()
// رسید نباید خودش باز شده باشد
if (/رسید فروش|چاپ|اشتراک/.test(body)) fail('رسید خودبه‌خود باز شد:\n' + body.slice(0, 700))
if (!/فروش ثبت شد/.test(body)) fail('تأیید ثبت فروش نیامد:\n' + body.slice(0, 700))
if (!/فروش بعدی/.test(body)) fail('دکمهٔ «فروش بعدی» نیامد')
console.log('✅ رسید خودبه‌خود باز نشد — فقط تأیید کوتاه آمد')

// ولی اگر رسید بخواهند، از همان‌جا باز می‌شود
await page.click('button:has-text("🧾 رسید")')
await page.waitForTimeout(700)
const body2 = await page.locator('body').innerText()
if (!/کوهستان/.test(body2)) fail('رسید با دکمه باز نشد:\n' + body2.slice(0, 700))
console.log('✅ رسید با دکمه باز می‌شود')
process.exit(0)
