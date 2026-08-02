/** آزمایش واقعی مرورگر: ویزارد شروع سال و محافظ سرمایه */
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

// گدام ۵۰٬۰۰۰ + صندوق ۵۰٬۰۰۰ = دارایی خالص ۱۰۰٬۰۰۰
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
    stockQty: 100, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2
  })
  await put('cashMovements', { date: Date.now(), type: 'openingSet', amount: 50000, note: 'اول' })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

await page.click('text=⚙️')
await page.waitForSelector('text=🎬 شروع سال مالی')
await page.click('button:has-text("شروع سال مالی")')
await page.waitForSelector('text=اول این‌ها را در اپ ثبت کنید')
await page.waitForTimeout(500)
let body = await page.locator('body').innerText()
if (!/۱۰۰٬۰۰۰/.test(body)) fail('دارایی خالص ۱۰۰٬۰۰۰ نشان نداد:\n' + body.slice(0, 800))

await page.click('button:has-text("اعداد درست است")')
await page.waitForSelector('text=شرکا و سرمایه‌ها')

// محافظ: سرمایهٔ بیشتر از دارایی باید رد شود
await page.click('button:has-text("افزودن شریک")')
await page.waitForSelector('text=شریک نو')
const form = page.locator('.bg-purple-50').first()
const nameBox = form.locator('input').nth(0)
const capBox = form.locator('input').nth(1)
const shareBox = form.locator('input').nth(2)
const addBtn = form.locator('button:has-text("افزودن شریک")')

await nameBox.fill('شریک')
await capBox.fill('999999')
await shareBox.fill('30')
await page.waitForTimeout(400)
// محافظ ظاهری: دکمه باید خاموش شود
if (await addBtn.isEnabled()) fail('دکمه با سرمایهٔ بیشتر از دارایی باید خاموش باشد')
body = await page.locator('body').innerText()
if (!/زیادتر|بیشتر/.test(body)) fail('هشدارِ سرمایهٔ زیادی نیامد:\n' + body.slice(0, 700))
console.log('✅ محافظ: دکمه خاموش شد و هشدار آمد')

// حالا عدد درست
await capBox.fill('20000')
await addBtn.click()
await page.waitForTimeout(800)
body = await page.locator('body').innerText()
if (!/۲۰٬۰۰۰/.test(body)) fail('شریک ثبت نشد:\n' + body.slice(0, 700))
if (!/۸۰٬۰۰۰/.test(body)) fail('سرمایهٔ خودکار مالک ۸۰٬۰۰۰ نشد:\n' + body.slice(0, 900))
if (!/۷۰٪/.test(body)) fail('فیصدی خودکار مالک ۷۰٪ نشد')
console.log('✅ سرمایه و فیصدی مالک خودکار حساب شد — ۸۰٬۰۰۰ و ۷۰٪')
process.exit(0)
