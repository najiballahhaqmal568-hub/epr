/** آزمایش واقعی مرورگر: چیدمان مشتریان — حرف، قرض، وعده، دیر آمده */
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

// سه مشتری با حرف، قرض، وعده و آخرین معامله عمداً مخالف هم:
//  الف — قرض ۱٬۰۰۰ · وعده ۳۰ روز بعد · آخرین معامله امروز
//  ب  — قرض ۹٬۰۰۰ · وعده دیروز (گذشته) · آخرین معامله ۱۰ روز پیش
//  پ  — قرض ۵٬۰۰۰ · بدون وعده · آخرین معامله ۱۰۰ روز پیش
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
  const mk = async (name, balance, promise, seenAgo) => {
    const id = await put('customers', {
      name, type: 'retail', balance,
      ...(promise !== null ? { promiseDate: promise } : {})
    })
    await put('payments', {
      date: Date.now() - seenAgo, partyType: 'customer', partyId: id, partyName: name, amount: 1
    })
  }
  await mk('الف', 1000, Date.now() + 30 * day, 0)
  await mk('ب', 9000, Date.now() - day, 10 * day)
  await mk('پ', 5000, null, 100 * day)
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=مشتریان')
await page.waitForTimeout(800)

const order = async () => {
  const names = await page.locator('.mt-3 p.font-bold.text-slate-800').allInnerTexts()
  return names.map((n) => n.trim().split(/\s/)[0]).filter((n) => ['الف', 'ب', 'پ'].includes(n))
}

if (!(await page.locator('text=چیدمان:').count())) fail('گزینهٔ چیدمان در مشتریان نیامد')

await page.click('button:has-text("حرف (الف–ی)")')
await page.waitForTimeout(400)
let o = await order()
if (o.join(',') !== 'الف,ب,پ') fail('چیدمان حرفی درست نیست: ' + o.join(','))
console.log('✅ حرف: ' + o.join(' ← '))

await page.click('button:has-text("بیشترین قرض")')
await page.waitForTimeout(400)
o = await order()
if (o.join(',') !== 'ب,پ,الف') fail('چیدمان قرض درست نیست: ' + o.join(','))
console.log('✅ بیشترین قرض: ' + o.join(' ← '))

await page.click('button:has-text("وعدهٔ نزدیک")')
await page.waitForTimeout(400)
o = await order()
// «ب» وعده‌اش گذشته پس اول، بعد «الف»، و «پ» که وعده ندارد آخر
if (o.join(',') !== 'ب,الف,پ') fail('چیدمان وعده درست نیست: ' + o.join(','))
console.log('✅ وعدهٔ نزدیک: ' + o.join(' ← '))

await page.click('button:has-text("دیر آمده")')
await page.waitForTimeout(400)
o = await order()
if (o.join(',') !== 'پ,ب,الف') fail('چیدمان «دیر آمده» درست نیست: ' + o.join(','))
console.log('✅ دیر آمده: ' + o.join(' ← '))

// یادش بماند
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=مشتریان')
await page.waitForTimeout(800)
o = await order()
if (o.join(',') !== 'پ,ب,الف') fail('چیدمان یادش نماند: ' + o.join(','))
console.log('✅ چیدمان انتخابی یادش ماند')
process.exit(0)
