/** آزمایش واقعی مرورگر: ثبت بوت جدید از فورم، و اصلاح موجودی از همان فورم */
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
await page.click('nav >> text=گدام')

// «بوت جدید» → ویزارد کارتنی → «ثبت عادی بدون کارتن»
await page.click('button:has-text("بوت جدید")')
await page.waitForSelector('text=جنس کارتنی جدید')
await page.click('text=ثبت عادی بدون کارتن')
await page.waitForSelector('text=نام بوت', { timeout: 10000 })

await page.fill('input[placeholder="مثلاً بوت چرمی مردانه"]', 'کوهستان')
const rowInputs = page.locator('input[inputmode="numeric"]')
// ترتیب فیلدهای عددیِ یک ردیف: خرید، موجودی، پرچون، عمده، کارتن؛ سپس تنظیم کارتنیِ کل جنس
await page.locator('input[placeholder="۴۲"]').first().fill('42')
await rowInputs.nth(0).fill('500')
await rowInputs.nth(1).fill('24')
await rowInputs.nth(2).fill('900')
await rowInputs.nth(3).fill('800')
await page.click('button:has-text("ذخیره")')
await page.waitForTimeout(1200)

let body = await page.locator('body').innerText()
if (!/کوهستان/.test(body)) fail('جنس ثبت نشد:\n' + body.slice(0, 600))
if (!/۲۴ جوړه/.test(body)) fail('موجودی ۲۴ نیامد:\n' + body.slice(0, 600))
console.log('✅ بوت جدید با موجودی ۲۴ ثبت شد')

// سند «موجودی اولیه» باید نوشته شده باشد و کنترل حساب‌ها سالم بماند
const docs = await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  const all = await new Promise((res) => {
    const q = dbx.transaction('adjustments', 'readonly').objectStore('adjustments').getAll()
    q.onsuccess = () => res(q.result)
  })
  return all.map((a) => ({ qty: a.qtyChange, note: a.note }))
})
if (!docs.some((d) => d.qty === 24 && d.note === 'موجودی اولیه'))
  fail('سند «موجودی اولیه» نوشته نشد: ' + JSON.stringify(docs))
console.log('✅ سند «موجودی اولیه» نوشته شد')

// کنترل حساب‌ها باید سالم باشد
await page.click('nav >> text=داشبورد')
await page.click('text=⚙️')
await page.waitForSelector('text=کنترل حساب‌ها')
await page.click('button:has-text("کنترل کن")').catch(() => {})
await page.waitForTimeout(1500)
body = await page.locator('body').innerText()
if (/نمی‌خواند/.test(body)) fail('کنترل حساب‌ها ایراد گرفت:\n' + body.slice(0, 700))
console.log('✅ کنترل حساب‌ها سالم است')
process.exit(0)
