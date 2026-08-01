/** آزمایش واقعی مرورگر: لیست اجناس فروخته‌شده + شمارش کوتاه */
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

// دو سایز در گدام؛ فقط یکی امروز فروخته می‌شود
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
  const mk = (size) =>
    put('variants', {
      productId: pid,
      size,
      color: 'سیاه',
      stockQty: 50,
      purchasePrice: 500,
      retailPrice: 900,
      wholesalePrice: 800,
      lowStock: 2
    })
  const v42 = await mk('42')
  await mk('44')
  await put('sales', {
    date: Date.now(),
    lines: [{ variantId: v42, productName: 'کوهستان', size: '42', color: 'سیاه', qty: 3, unitPrice: 900, unitCost: 500 }],
    total: 2700,
    paid: 2700,
    saleType: 'retail'
  })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

// ۱) لیست فروخته‌شده در تب فروش ← آمار
await page.click("nav >> text=فروش")
await page.click('button:has-text("آمار")')
await page.click('text=اجناس فروخته‌شدهٔ این دوره')
await page.waitForTimeout(400)
let body = await page.locator('body').innerText()
if (!/کوهستان 42/.test(body)) fail('سایز فروخته‌شده در لیست نیامد')
if (/کوهستان 44/.test(body)) fail('سایز فروخته‌نشده نباید در لیست باشد')
if (!/گدام: ۵۰/.test(body)) fail('موجودی فعلی کنار لیست نیامد')
console.log('✅ لیست اجناس فروخته‌شده درست است')

// ۲) شمارش کوتاه در گدام
await page.click("nav >> text=گدام")
await page.click('text=📋 شمارش')
await page.waitForSelector('text=شمارش فزیکی گدام')
await page.click('button:has-text("فروخته‌شدهٔ این ماه")')
await page.waitForTimeout(500)
body = await page.locator('body').innerText()
if (!/۰ از ۱ شمارش شده/.test(body)) fail('شمارش باید فقط ۱ سایز را بخواهد:\n' + body.slice(0, 500))
if (!/۱ سایز دیگر حرکت نکرده/.test(body)) fail('پیام «حرکت نکرده» نیامد')
await page.click('button:has-text("همهٔ گدام")')
await page.waitForTimeout(400)
body = await page.locator('body').innerText()
if (!/۰ از ۲ شمارش شده/.test(body)) fail('حالت «همهٔ گدام» باید ۲ سایز بدهد')
console.log('✅ شمارش کوتاه درست کار کرد')
process.exit(0)
