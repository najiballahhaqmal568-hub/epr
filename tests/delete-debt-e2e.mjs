/** آزمایش واقعی مرورگر: قرض اشتباهی در حساب مشتری پاک شود */
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

// مشتری‌ای که حسابش خلاص بود، و یک قرض قبلیِ اشتباهی ۳٬۰۰۰ به نامش
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
  const id = await put('customers', { name: 'نصیر', type: 'retail', balance: 3000, createdAt: Date.now() })
  await put('payments', {
    date: Date.now(), partyType: 'customer', partyId: id, partyName: 'نصیر',
    amount: -3000, note: 'قرض قبلی'
  })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=مشتریان')
await page.waitForTimeout(700)
await page.click('text=نصیر')
await page.waitForTimeout(500)

if (!(await page.locator('text=قرض مشتری').count())) fail('حساب مشتری باز نشد')
if (!(await page.locator('text=۳٬۰۰۰').count())) fail('قرض ۳٬۰۰۰ نشان داده نشد')

const del = page.locator('button:has-text("اشتباه بود — پاک کن")')
if (!(await del.count())) fail('دکمهٔ پاک کردن در دفتر حساب نیامد')
await del.first().click()
await page.waitForTimeout(500)

// پیش از تأیید باید اثرش را نشان دهد
if (!(await page.locator('text=قرض بعد از پاک کردن').count())) fail('اثر پاک کردن پیش از تأیید نشان داده نشد')
console.log('✅ اثر پاک کردن پیش از تأیید نشان داده شد')

await page.click('button:has-text("بلی، پاک کن")')
await page.waitForTimeout(800)

if (!(await page.locator('text=حساب تصفیه است').count())) fail('حساب بعد از پاک کردن تصفیه نشد')
console.log('✅ حساب تصفیه شد')

const bal = await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  return await new Promise((res) => {
    const q = dbx.transaction('customers').objectStore('customers').getAll()
    q.onsuccess = () => res(q.result.find((c) => c.name === 'نصیر').balance)
  })
})
if (bal !== 0) fail('بیلانس در دیتابیس صفر نشد: ' + bal)
console.log('✅ بیلانس در دیتابیس هم صفر شد')
process.exit(0)
