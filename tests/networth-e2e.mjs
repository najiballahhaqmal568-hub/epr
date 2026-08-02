/** آزمایش واقعی مرورگر: مصارف رسیدنِ پرداخت‌نشده در ویزارد شروع سال قرض شمرده شود */
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

// گدام ۷٬۰۰۰ (شامل ۲٬۰۰۰ مصارف رسیدن)، صندوق ۴۵٬۰۰۰، مصارف رسیدنِ نداده ۲٬۰۰۰
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
  const vid = await put('variants', {
    productId: pid, size: '42', color: 'سیاه',
    stockQty: 10, purchasePrice: 700, retailPrice: 900, wholesalePrice: 800, lowStock: 2
  })
  const sup = await put('suppliers', { name: 'تأمین', balance: 0 })
  await put('cashMovements', { date: Date.now(), type: 'openingSet', amount: 45000, note: 'اول' })
  await put('purchases', {
    date: Date.now(), supplierId: sup, supplierName: 'تأمین',
    lines: [{ variantId: vid, productName: 'کوهستان', size: '42', color: 'سیاه', qty: 10, unitCost: 500 }],
    total: 5000, paid: 5000,
    landingCost: 2000, landingVia: 'later', landingUnpaid: 2000, landingPaid: false
  })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

await page.click('text=⚙️')
await page.waitForSelector('text=🎬 شروع سال مالی')
await page.click('button:has-text("شروع سال مالی")')
await page.waitForSelector('text=اول این‌ها را در اپ ثبت کنید')
await page.waitForTimeout(600)

const body = await page.locator('body').innerText()
if (!/مصارف رسیدنِ پرداخت‌نشده/.test(body)) fail('قرضِ مصارف رسیدن در فهرست نیامد:\n' + body.slice(0, 900))
// گدام ۷٬۰۰۰ + صندوق ۴۵٬۰۰۰ − قرضِ مصارف ۲٬۰۰۰ = ۵۰٬۰۰۰
if (!/۵۰٬۰۰۰/.test(body)) fail('دارایی خالص باید ۵۰٬۰۰۰ باشد (نه ۵۲٬۰۰۰):\n' + body.slice(0, 900))
if (/۵۲٬۰۰۰/.test(body)) fail('دارایی خالص هنوز مصارف رسیدن را قرض حساب نمی‌کند')
console.log('✅ ویزارد شروع سال مصارف رسیدنِ پرداخت‌نشده را قرض حساب می‌کند — دارایی ۵۰٬۰۰۰')
process.exit(0)
