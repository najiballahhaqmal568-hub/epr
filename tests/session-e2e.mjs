/** آزمایش واقعی مرورگر: با تمام شدن سشن سرور، اپ نباید به صفحهٔ ورود بپرد */
import { chromium } from 'playwright-core'

const URL = process.env.URL ?? 'http://localhost:4173/'
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.error('خطای صفحه:', e.message))
const fail = (m) => {
  console.error('❌ ' + m)
  process.exit(1)
}

await page.goto(URL)
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

// دکانی که سرور تنظیم شده و پروفایلش ذخیره است، ولی سشن سرور تمام شده
// (توکن کهنه شده — همان چیزی که در گوشی مالک پیش می‌آمد)
await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  const put = (store, obj) =>
    new Promise((res, rej) => {
      const t = dbx.transaction(store, 'readwrite')
      const q = t.objectStore(store).put(obj)
      q.onsuccess = () => res(q.result)
      q.onerror = () => rej(q.error)
    })
  await put('settings', { key: 'supaUrl', value: 'https://example.invalid' })
  await put('settings', { key: 'supaKey', value: 'anon-key-for-test' })
  await put('settings', { key: 'cachedProfile', value: { user_id: 'u1', shop_id: 's1', role: 'owner', name: 'مالک' } })
  const pid = await put('products', { name: 'کوهستان', createdAt: Date.now() })
  await put('variants', {
    productId: pid, size: '42', color: 'سیاه',
    stockQty: 10, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2
  })
})
await page.reload()
await page.waitForTimeout(4000)

let body = await page.locator('body').innerText()
if (/ورود به حساب/.test(body)) fail('اپ به صفحهٔ ورود پرید — همان اشکالی که مالک دید:\n' + body.slice(0, 400))
if (!/داشبورد/.test(body)) fail('اپ باز نشد:\n' + body.slice(0, 400))
console.log('✅ با تمام شدن سشن سرور، اپ باز ماند و به صفحهٔ ورود نپرید')

if (!/همگام‌سازی متوقف است/.test(body)) fail('نوار «همگام‌سازی متوقف است» نیامد:\n' + body.slice(0, 400))
console.log('✅ نوار زرد گفت همگام‌سازی متوقف است — کار ادامه دارد')

// کار دکان باید ادامه یابد: یک فروش نقدی ثبت شود
await page.click('nav >> text=فروش')
await page.click('button:has-text("فروش جدید")')
await page.waitForTimeout(700)
await page.locator('button:has-text("کوهستان")').first().click()
await page.waitForSelector('text=انتخاب سایز')
await page.click('button:has-text("42 سیاه")')
await page.waitForTimeout(400)
await page.click('button:has-text("ثبت فروش")')
await page.waitForTimeout(1200)
const sold = await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  return await new Promise((res) => {
    const q = dbx.transaction('sales').objectStore('sales').getAll()
    q.onsuccess = () => res(q.result.filter((s) => !s.deleted).length)
  })
})
if (sold !== 1) fail('فروش ثبت نشد در حالی که سشن تمام شده بود: ' + sold)
console.log('✅ فروش با وجود قطع بودن سرور ثبت شد')

// «ورود دوباره» باید راه برگشت داشته باشد — دکان پشت صفحهٔ ورود نماند
await page.click('nav >> text=داشبورد')
await page.waitForTimeout(500)
await page.click('button:has-text("ورود دوباره")')
await page.waitForTimeout(700)
body = await page.locator('body').innerText()
if (!/ورود به حساب/.test(body)) fail('دکمهٔ «ورود دوباره» صفحهٔ ورود را باز نکرد')
await page.click('text=فعلاً بدون همگام‌سازی کار می‌کنم')
await page.waitForTimeout(700)
body = await page.locator('body').innerText()
if (!/داشبورد/.test(body)) fail('راه برگشت از صفحهٔ ورود بسته بود:\n' + body.slice(0, 400))
console.log('✅ از صفحهٔ ورود راه برگشت به اپ باز است')
process.exit(0)
