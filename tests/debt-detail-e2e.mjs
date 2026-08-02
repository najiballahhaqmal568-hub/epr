/** آزمایش واقعی مرورگر: جزئیات قرض پرچون — کدام بوت و کدام تاریخ */
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

// دو مشتری از یک خانواده، هر کدام یک بوت قرضی
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
  const mk = (size, color) =>
    put('variants', {
      productId: pid, size, color,
      stockQty: 20, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2
    })
  const v42 = await mk('42', 'سیاه')
  const v40 = await mk('40', 'خاکی')
  const karim = await put('customers', { name: 'کریم', type: 'retail', balance: 1800, family: 'احمدی' })
  const nasir = await put('customers', { name: 'نصیر', type: 'retail', balance: 900, family: 'احمدی' })
  await put('sales', {
    date: Date.parse('2026-05-10'), customerId: karim, customerName: 'کریم', saleType: 'retail',
    lines: [{ variantId: v42, productName: 'کوهستان', size: '42', color: 'سیاه', qty: 2, unitPrice: 900, unitCost: 500 }],
    total: 1800, paid: 0
  })
  await put('sales', {
    date: Date.parse('2026-06-01'), customerId: nasir, customerName: 'نصیر', saleType: 'retail',
    lines: [{ variantId: v40, productName: 'کوهستان', size: '40', color: 'خاکی', qty: 1, unitPrice: 900, unitCost: 500 }],
    total: 900, paid: 0
  })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=مشتریان')
await page.waitForTimeout(600)

// ۱) خانواده — هر دو عضو با بوت خودشان
await page.click('text=خانوادهٔ احمدی')
await page.waitForTimeout(700)
let body = await page.locator('body').innerText()
if (!/کوهستان 42 سیاه ×۲/.test(body)) fail('بوت کریم در دفتر خانواده نیامد:\n' + body.slice(0, 900))
if (!/کوهستان 40 خاکی ×۱/.test(body)) fail('بوت نصیر در دفتر خانواده نیامد:\n' + body.slice(0, 900))
console.log('✅ دفتر خانواده: بوت هر دو عضو آمد')

// ۲) شخص — کریم، از داخل همان خانواده
await page.click('button:has-text("کریم")')
await page.waitForSelector('text=دفتر حساب', { timeout: 10000 })
await page.waitForTimeout(500)
body = await page.locator('body').innerText()
if (!/کوهستان 42 سیاه ×۲/.test(body)) fail('بوت در دفتر شخص نیامد:\n' + body.slice(0, 1000))
if (/کوهستان 40 خاکی/.test(body)) fail('بوت نصیر نباید در دفتر کریم باشد')
if (!/فروش قرضی/.test(body)) fail('نوع سند نیامد')
console.log('✅ دفتر شخص: فقط بوت خودش، با نوع سند و تاریخ')
process.exit(0)
