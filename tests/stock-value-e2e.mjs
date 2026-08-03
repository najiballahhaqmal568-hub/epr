/** آزمایش واقعی مرورگر: ارزش هر جنس در گدام، و برابری با ویزارد شروع سال */
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

// کوهستان: ۱۰×۵۰۰ + ۵×۶۰۰ = ۸٬۰۰۰   بامیان: ۴×۱٬۰۰۰ = ۴٬۰۰۰   مجموع ۱۲٬۰۰۰
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
  const mkV = (pid, size, qty, cost) =>
    put('variants', {
      productId: pid, size, color: 'سیاه',
      stockQty: qty, purchasePrice: cost, retailPrice: cost * 2, wholesalePrice: cost * 2, lowStock: 2
    })
  const p1 = await put('products', { name: 'کوهستان', createdAt: Date.now() })
  await mkV(p1, '42', 10, 500)
  await mkV(p1, '43', 5, 600)
  const p2 = await put('products', { name: 'بامیان', createdAt: Date.now() })
  await mkV(p2, '40', 4, 1000)
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=گدام')
await page.waitForTimeout(700)

const body = await page.locator('body').innerText()
if (!/ارزش: ۸٬۰۰۰/.test(body)) fail('ارزش کوهستان ۸٬۰۰۰ نیامد:\n' + body.slice(0, 900))
if (!/ارزش: ۴٬۰۰۰/.test(body)) fail('ارزش بامیان ۴٬۰۰۰ نیامد:\n' + body.slice(0, 900))
if (!/مجموع گدام/.test(body)) fail('نوار مجموع نیامد')
if (!/۱۲٬۰۰۰/.test(body)) fail('مجموع ۱۲٬۰۰۰ نیامد:\n' + body.slice(0, 900))
if (!/۱۹ جوړه/.test(body)) fail('مجموع جوړه ۱۹ نیامد')
console.log('✅ ارزش هر جنس و مجموع گدام درست است')

// همان عدد باید در ویزارد شروع سال هم بیاید
await page.click('nav >> text=داشبورد')
await page.click('text=⚙️')
await page.waitForSelector('text=🎬 شروع سال مالی')
await page.click('button:has-text("شروع سال مالی")')
await page.waitForSelector('text=اول این‌ها را در اپ ثبت کنید')
await page.waitForTimeout(600)
const body2 = await page.locator('body').innerText()
if (!/۱۲٬۰۰۰/.test(body2)) fail('ویزارد شروع سال عدد دیگری می‌گوید:\n' + body2.slice(0, 900))
console.log('✅ همان عدد در ویزارد شروع سال هم می‌آید — ۱۲٬۰۰۰')
process.exit(0)
