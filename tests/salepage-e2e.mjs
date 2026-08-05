/** آزمایش واقعی مرورگر: صفحهٔ دفتر در فروش قرضی و «کدام صفحه چقدر است» */
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

// مشتری عمده که صفحهٔ فعلی‌اش ۱۲ است و در همان صفحه ۵٬۰۰۰ قرض دارد
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
    stockQty: 50, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2
  })
  const cid = await put('customers', {
    name: 'حاجی نور', type: 'wholesale', balance: 5000, bookPage: '۱۲', createdAt: Date.now()
  })
  await put('payments', {
    date: Date.now() - 86400000, partyType: 'customer', partyId: cid, partyName: 'حاجی نور',
    amount: -5000, note: 'قرض قبلی', bookPage: '۱۲'
  })
})
await page.reload()
await page.waitForSelector('text=داشبورد', { timeout: 30000 })

// فروش قرضی — صفحه باید خودش «۱۲» پیشنهاد شود، ما آن را به «۱۳» عوض می‌کنیم
await page.click('nav >> text=فروش')
await page.click('button:has-text("فروش جدید")')
await page.waitForTimeout(700)
await page.click('button:has-text("عمده")')
await page.waitForTimeout(300)
await page.click('button:has-text("قرضی؟ انتخاب مشتری")')
await page.fill('input[placeholder*="جستجوی نام"]', 'حاجی')
await page.waitForTimeout(500)
await page.click('button:has-text("حاجی نور")')
await page.waitForTimeout(400)

await page.locator('button:has-text("کوهستان")').first().click()
await page.waitForSelector('text=انتخاب سایز')
await page.click('button:has-text("42 سیاه")')
await page.waitForTimeout(500)

// قرضی کامل: دریافتی صفر
await page.locator('text=دریافتی').locator('..').locator('input').fill('0')
await page.waitForTimeout(400)

const pageInput = page.locator('input[placeholder*="صفحهٔ فعلی"]')
if (!(await pageInput.count())) fail('خانهٔ صفحهٔ دفتر در فروش قرضی نیامد')
const prefill = await pageInput.inputValue()
if (prefill !== '۱۲') fail('صفحهٔ فعلی مشتری خودش پیشنهاد نشد: «' + prefill + '»')
console.log('✅ در فروش قرضی، صفحهٔ فعلی مشتری (۱۲) خودش پیشنهاد شد')

await pageInput.fill('۱۳')
await page.click('button:has-text("ثبت فروش")')
await page.waitForTimeout(1200)

// حالا در حساب مشتری: صفحهٔ ۱۲ = ۵٬۰۰۰ و صفحهٔ ۱۳ = ۸۰۰
await page.click('nav >> text=مشتریان')
await page.waitForTimeout(500)
await page.click('button:has-text("دفتر عمده")')
await page.waitForTimeout(500)
await page.click('text=حاجی نور')
await page.waitForTimeout(700)

const body = await page.locator('body').innerText()
if (!/قرض هر صفحهٔ دفتر/.test(body)) fail('قطیِ «قرض هر صفحهٔ دفتر» نیامد:\n' + body.slice(0, 900))
if (!/صفحهٔ ۱۲/.test(body) || !/صفحهٔ ۱۳/.test(body)) fail('هر دو صفحه نیامد:\n' + body.slice(0, 900))
console.log('✅ در حساب مشتری، قرض هر صفحه جدا معلوم است')

// عددها را از دیتابیس تأیید کن — جمع صفحه‌ها باید با قرض کل برابر باشد
const chk = await page.evaluate(async () => {
  const open = indexedDB.open('shoeErp')
  await new Promise((r) => (open.onsuccess = r))
  const dbx = open.result
  const all = (store) =>
    new Promise((res) => {
      const q = dbx.transaction(store).objectStore(store).getAll()
      q.onsuccess = () => res(q.result)
    })
  const [customers, sales, payments] = await Promise.all([all('customers'), all('sales'), all('payments')])
  const c = customers.find((x) => x.name === 'حاجی نور')
  const byPage = {}
  for (const s of sales.filter((s) => !s.deleted && s.customerId === c.id)) {
    const k = s.bookPage ?? '—'
    byPage[k] = (byPage[k] ?? 0) + (s.total - s.paid)
  }
  for (const p of payments.filter((p) => !p.deleted && p.partyId === c.id && p.partyType === 'customer')) {
    const k = p.bookPage ?? '—'
    byPage[k] = (byPage[k] ?? 0) - p.amount
  }
  return { balance: c.balance, page: c.bookPage, byPage }
})
if (chk.byPage['۱۲'] !== 5000) fail('صفحهٔ ۱۲ باید ۵۰۰۰ می‌بود: ' + JSON.stringify(chk.byPage))
if (chk.byPage['۱۳'] !== 800) fail('صفحهٔ ۱۳ باید ۸۰۰ می‌بود: ' + JSON.stringify(chk.byPage))
const sum = Object.values(chk.byPage).reduce((s, n) => s + n, 0)
if (sum !== chk.balance) fail('جمع صفحه‌ها با قرض کل برابر نیست: ' + sum + ' ≠ ' + chk.balance)
console.log('✅ صفحهٔ ۱۲ = ۵٬۰۰۰ · صفحهٔ ۱۳ = ۸۰۰ · جمع = قرض کل ' + chk.balance)
if (chk.page !== '۱۳') fail('صفحهٔ فعلی مشتری به ۱۳ نرفت: ' + chk.page)
console.log('✅ صفحهٔ فعلی مشتری خودش ۱۳ شد — فروش بعدی همان را پیشنهاد می‌کند')
process.exit(0)
