/** آزمایش واقعی مرورگر: صفحهٔ دفتر فزیکی — نوشتن، دیدن، جستجو و چیدمان */
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

// سه مشتری پرچون: صفحه‌ها عمداً مخالف حروف — «۱۰» نباید پیش از «۲» بیاید
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
  await put('customers', { name: 'الف', type: 'retail', balance: 0, bookPage: '۱۰', createdAt: Date.now() })
  await put('customers', { name: 'ب', type: 'retail', balance: 0, bookPage: '۲', createdAt: Date.now() })
  await put('customers', { name: 'پ', type: 'retail', balance: 0, createdAt: Date.now() })
  // خانواده: یکی صفحه دارد، یکی ندارد — همان چیزی که مالک دید
  await put('customers', { name: 'کریم', type: 'retail', balance: 0, family: 'کریمی', bookPage: '۴', createdAt: Date.now() })
  await put('customers', { name: 'رحیم', type: 'retail', balance: 0, family: 'کریمی', createdAt: Date.now() })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })
await page.click('nav >> text=مشتریان')
await page.waitForTimeout(700)

const order = async () => {
  const names = await page.locator('.mt-3 p.font-bold.text-slate-800').allInnerTexts()
  return names.map((n) => n.trim().split(/\s/)[0]).filter((n) => ['الف', 'ب', 'پ'].includes(n))
}

// نشانِ صفحه روی کارت
if (!(await page.locator('text=📖 صفحهٔ ۱۰').count())) fail('نشان صفحهٔ دفتر روی کارت نیامد')
console.log('✅ صفحهٔ دفتر روی کارت مشتری دیده می‌شود')

// خانواده: هم صفحهٔ موجود، هم هشدارِ بی‌صفحه
if (!(await page.locator('text=📖 صفحهٔ ۴').count())) fail('صفحهٔ عضو خانواده روی کارت خانواده نیامد')
// صفحه اختیاری است — عضو بی‌صفحه نباید هیچ هشداری بگیرد
if (await page.locator('text=بی‌صفحه').count()) fail('برای عضو بی‌صفحه هشدار داده شد — صفحه اختیاری است')
console.log('✅ کارت خانواده صفحهٔ ۴ را نشان داد و عضو بی‌صفحه را سرزنش نکرد')

await page.click('text=خانوادهٔ کریمی')
await page.waitForTimeout(600)
await page.locator('button:has-text("✕"), button:has-text("×")').first().click().catch(() => {})
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// چیدمان «صفحهٔ دفتر»: ب (۲) ← الف (۱۰) ← پ (بی‌صفحه)
await page.click('button:has-text("صفحهٔ دفتر")')
await page.waitForTimeout(400)
let o = await order()
if (o.join(',') !== 'ب,الف,پ') fail('چیدمان صفحهٔ دفتر درست نیست: ' + o.join(','))
console.log('✅ چیدمان صفحهٔ دفتر: ' + o.join(' ← ') + ' — ۱۰ پیش از ۲ نیامد و بی‌صفحه آخر ماند')

// جستجو با شمارهٔ صفحه
await page.fill('input[placeholder*="جستجو"]', '۲')
await page.waitForTimeout(500)
o = await order()
if (o.join(',') !== 'ب') fail('جستجو با شمارهٔ صفحه درست نیست: ' + o.join(','))
console.log('✅ جستجو با شمارهٔ صفحه فقط همان مشتری را آورد')
await page.fill('input[placeholder*="جستجو"]', '')
await page.waitForTimeout(400)

// صفحه در فرم «ثبت مشتری» نیست — با خودِ قرض نوشته می‌شود
await page.click('button:has-text("مشتری جدید")')
await page.waitForTimeout(600)
if (await page.locator('input[placeholder="مثلاً ۱۲ یا ۱۲/الف"]').count()) fail('خانهٔ صفحه هنوز در فرم ثبت مشتری است')
if (await page.locator('text=قرض قبلی (اختیاری)').count()) fail('قرض قبلی هنوز در فرم ثبت مشتری است')
console.log('✅ در فرم ثبت مشتری نه خانهٔ صفحه است نه قرض قبلی')
await page.locator('button:has-text("✕")').last().click()
await page.waitForTimeout(500)

// «پ» تنها حرف است و در «پرچون» هم می‌آید — پس دقیقاً همان کارت را می‌گیریم
await page.locator('.mt-3 p.font-bold.text-slate-800', { hasText: /^پ$/ }).click()
await page.waitForTimeout(500)
await page.click('button:has-text("قرض قبلی")')
await page.waitForTimeout(400)
await page.locator('text=مبلغ قرض قبلی').locator('..').locator('input').fill('۲۰۰۰')
await page.locator('text=صفحهٔ دفتر (اختیاری)').locator('..').locator('input').fill('۵')
await page.click('button:has-text("ثبت قرض قبلی")')
await page.waitForTimeout(900)
if (!(await page.locator('text=صفحهٔ ۵').count())) fail('صفحهٔ قرض قبلی دیده نشد')
console.log('✅ صفحهٔ دفتر همراه خودِ قرض قبلی نوشته شد')

const saved = await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  return await new Promise((res) => {
    const q = dbx.transaction('customers').objectStore('customers').getAll()
    q.onsuccess = () => res(q.result.find((c) => c.name === 'پ'))
  })
})
if (saved.bookPage !== '۵') fail('آخرین صفحهٔ مشتری ۵ نشد: ' + saved.bookPage)
if (saved.balance !== 2000) fail('قرض قبلی درست ننشست: ' + saved.balance)
console.log('✅ قرض ۲٬۰۰۰ در صفحهٔ ۵ نشست و آخرین صفحهٔ مشتری هم ۵ شد')
process.exit(0)
