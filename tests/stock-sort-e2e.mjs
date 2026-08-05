/** آزمایش واقعی مرورگر: چیدمان گدام — حرف، تاریخ، ارزش */
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

// سه جنس با حرف، تاریخ و ارزش عمداً مخالف هم:
//  «الف» → کهنه‌ترین (۱۰۰ روز پیش)، ارزش کم   ۵×۱۰۰ = ۵۰۰
//  «ب»  → تازه‌ترین (امروز)،          ارزش زیاد ۱۰×۲٬۰۰۰ = ۲۰٬۰۰۰
//  «پ»  → میانه (۱۰ روز پیش)،         ارزش میانه ۴×۱٬۰۰۰ = ۴٬۰۰۰
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
  const day = 86400000
  const mk = async (name, ago, qty, cost) => {
    const pid = await put('products', { name, createdAt: Date.now() - ago })
    await put('variants', {
      productId: pid, size: '42', color: 'سیاه',
      stockQty: qty, purchasePrice: cost, retailPrice: cost * 2, wholesalePrice: cost * 2,
      lowStock: 2, lastPurchaseAt: Date.now() - ago
    })
  }
  await mk('الف', 100 * day, 5, 100)
  await mk('ب', 0, 10, 2000)
  await mk('پ', 10 * day, 4, 1000)
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=گدام')
await page.waitForTimeout(700)

// ترتیب نام‌ها در فهرست
const order = async () => {
  const names = await page.locator('.mt-3 p.font-bold.text-slate-800').allInnerTexts()
  return names.map((n) => n.trim().split(/\s/)[0]).filter((n) => ['الف', 'ب', 'پ'].includes(n))
}

if (!(await page.locator('text=چیدمان:').count())) fail('گزینهٔ چیدمان نیامد')

await page.click('button:has-text("حرف (الف–ی)")')
await page.waitForTimeout(400)
let o = await order()
if (o.join(',') !== 'الف,ب,پ') fail('چیدمان حرفی درست نیست: ' + o.join(','))
console.log('✅ حرف: ' + o.join(' ← '))

await page.click('button:has-text("تازه‌ترین")')
await page.waitForTimeout(400)
o = await order()
if (o.join(',') !== 'ب,پ,الف') fail('چیدمان تازه‌ترین درست نیست: ' + o.join(','))
console.log('✅ تازه‌ترین: ' + o.join(' ← '))

await page.click('button:has-text("کهنه‌ترین در گدام")')
await page.waitForTimeout(400)
o = await order()
if (o.join(',') !== 'الف,پ,ب') fail('چیدمان کهنه‌ترین درست نیست: ' + o.join(','))
console.log('✅ کهنه‌ترین: ' + o.join(' ← '))

await page.click('button:has-text("ارزش")')
await page.waitForTimeout(400)
o = await order()
if (o.join(',') !== 'ب,پ,الف') fail('چیدمان ارزش درست نیست: ' + o.join(','))
console.log('✅ ارزش: ' + o.join(' ← '))

// انتخاب باید بعد از بستن و باز کردن اپ یادش بماند
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=گدام')
await page.waitForTimeout(700)
o = await order()
if (o.join(',') !== 'ب,پ,الف') fail('چیدمان انتخابی یادش نماند: ' + o.join(','))
console.log('✅ چیدمان انتخابی بعد از باز کردن دوباره یادش ماند')
process.exit(0)
