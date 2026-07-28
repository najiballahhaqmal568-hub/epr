/**
 * آزمایش همگام‌سازی دو موبایل با سرور واقعی.
 *
 * اجرا:  npx vite --port 4191 --strictPort   (در یک ترمینال)
 *        node tests/two-device.mjs
 *
 * هر بار یک دکان آزمایشی نو با ایمیل تصادفی می‌سازد، پس به دیتای واقعی
 * دست نمی‌زند. کلید پایین «anon key» عمومی است — همان که در خود اپ هم هست.
 */
import { chromium } from 'playwright-core'
const SUPA_URL = 'https://xkvpdeguayorxzvjgpmv.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrdnBkZWd1YXlvcnh6dmpncG12Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM1ODMyNzUsImV4cCI6MjA5OTE1OTI3NX0.tECj4Lx4wSO5ogtXbIVe2pQh2Su7HzHZV6EEzDU2jgE'
const rand = Math.random().toString(36).slice(2, 8)
const OWNER = `test.sync.${rand}@gmail.com`
let bad = 0
const log = (...a) => console.log('✔', ...a)
const check = (name, got, want) => {
  const ok = String(got) === String(want)
  if (!ok) bad++
  console.log(`${ok ? '✅' : '❌'} ${name}: ${got}${ok ? '' : ` (باید ${want})`}`)
}
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function newDevice() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await ctx.route(SUPA_URL + '/**', async (route) => {
    const req = route.request()
    try {
      const headers = { ...req.headers() }
      delete headers['accept-encoding']
      const resp = await fetch(req.url(), { method: req.method(), headers, body: ['GET','HEAD'].includes(req.method()) ? undefined : req.postDataBuffer() })
      const body = Buffer.from(await resp.arrayBuffer())
      const out = {}
      resp.headers.forEach((v, k) => { if (!['content-encoding','content-length','transfer-encoding'].includes(k)) out[k] = v })
      await route.fulfill({ status: resp.status, headers: out, body })
    } catch { await route.abort('failed').catch(() => {}) }
  })
  const page = await ctx.newPage()
  page.on('dialog', d => d.accept())
  await page.goto('http://localhost:4191/')
  return { ctx, page }
}
async function configureServer(page) {
  await page.waitForSelector('nav >> text=داشبورد')
  await page.click('button[aria-label="تنظیمات"]')
  await page.click('button:has-text("تنظیم سرور")')
  await page.fill('input[placeholder="https://xxxx.supabase.co"]', SUPA_URL)
  await page.fill('input[placeholder="eyJhbGciOi..."]', SUPA_KEY)
  await page.click('button:has-text("ذخیره و اتصال")')
  await page.waitForSelector('text=ورود به حساب', { timeout: 20000 })
}
async function fullSync(page) {
  await page.click('nav >> text=داشبورد')
  await page.waitForTimeout(400)
  for (let i = 0; i < 3; i++) {
    await page.waitForFunction(() => { const b = document.querySelector('button[aria-label="sync"]'); return b && !b.textContent.includes('⏳') }, { timeout: 60000 })
    await page.click('button[aria-label="sync"]')
    await page.waitForTimeout(1000)
    await page.waitForFunction(() => { const b = document.querySelector('button[aria-label="sync"]'); return b && !b.textContent.includes('⏳') }, { timeout: 90000 })
  }
  await page.waitForTimeout(800)
}
const read = (page, fn) => page.evaluate(fn)

// ── دستگاه الف ──────────────────────────────────────────────
const A = await newDevice()
await configureServer(A.page)
await A.page.click('button:has-text("حساب ندارید؟")')
await A.page.locator('label:has-text("نام شما *") input').fill('مالک')
await A.page.locator('label:has-text("نام دکان *") input').fill(`دکان آزمایشی ${rand}`)
await A.page.locator('label:has-text("ایمیل *") input').fill(OWNER)
await A.page.locator('label:has-text("رمز عبور *") input').fill('test123456')
await A.page.click('button:has-text("ثبت‌نام")')
await A.page.waitForSelector('nav >> text=داشبورد', { timeout: 30000 })
log('الف ثبت‌نام شد:', OWNER)

const m = (p) => p.locator('.fixed.inset-0').last()
// جنس با موجودی اولیه ۵۰
await A.page.click('nav >> text=گدام')
await A.page.click('button:has-text("بوت جدید")')
await A.page.click('text=ثبت عادی بدون کارتن')
await A.page.fill('input[placeholder="مثلاً بوت چرمی مردانه"]', 'اسپرتکس')
await m(A.page).locator('label:has-text("سایز *") input').fill('42')
await m(A.page).locator('label:has-text("قیمت خرید") input').fill('500')
await m(A.page).locator('label:has-text("تعداد موجود") input').fill('50')
await m(A.page).locator('label:has-text("قیمت پرچون") input').fill('900')
await m(A.page).locator('label:has-text("قیمت عمده") input').fill('800')
await A.page.click('button:has-text("ذخیره")')
await A.page.waitForSelector('text=اسپرتکس')
log('الف: جنس با ۵۰ جوړه')

// تأمین‌کننده + خرید «در راه» ۳۰ جوړه، بعد رسید  ← همان باگی که اصلاح شد
await A.page.click('nav >> text=خرید')
await A.page.click('button:has-text("تأمین‌کنندگان")')
await A.page.locator('button:has-text("تأمین‌کننده")').last().click()
await m(A.page).locator('label:has-text("نام *") input').fill('تأمین‌کننده')
await A.page.click('button:has-text("ذخیره")')
await A.page.waitForTimeout(800)
await A.page.click('button:has-text("خریدها")')
await A.page.click('button:has-text("خرید جدید")')
await m(A.page).locator('select').first().selectOption({ index: 1 })
await m(A.page).locator('input[placeholder="نام، سایز یا رنگ..."]').fill('42')
await A.page.waitForTimeout(600)
await m(A.page).locator('button:has-text("اسپرتکس — 42")').first().click()
await A.page.waitForTimeout(400)
// تعداد ۳۰ — خانهٔ تعداد در سطر جنس
await m(A.page).locator('.rounded-xl.bg-slate-50 input').nth(1).fill('30')
await A.page.waitForTimeout(300)
await m(A.page).locator('input[type="checkbox"]').first().uncheck()
await A.page.waitForTimeout(300)
await m(A.page).locator('label:has-text("مبلغ پرداختی") input').fill('0')
await A.page.click('button:has-text("ثبت خرید")')
await A.page.waitForTimeout(1000)
await A.page.click('button:has-text("جنس رسید")')
await A.page.waitForTimeout(1000)
log('الف: خرید «در راه» ۳۰ جوړه ثبت و رسید')

// فروش قرضی + انتقال پول به خانه
await A.page.click('nav >> text=فروش')
await A.page.click('button:has-text("فروش جدید")')
await A.page.fill('input[placeholder="نام، سایز، رنگ یا کود..."]', '42')
await A.page.click('.fixed.inset-0 button:has-text("×۳")')
await A.page.click('button:has-text("قرضی؟ انتخاب مشتری")')
await A.page.fill('input[placeholder="جستجوی نام یا تلفن مشتری..."]', 'احمد')
await A.page.click('button:has-text("＋ مشتری جدید")')
await m(A.page).locator('label:has-text("مبلغ دریافتی") input').click()
await m(A.page).locator('label:has-text("مبلغ دریافتی") input').fill('700')
await A.page.click('button:has-text("ثبت فروش")')
await A.page.waitForSelector('text=➕ فروش بعدی')
await A.page.click('button:has-text("بستن")')
log('الف: فروش ۳ جوړه × ۹۰۰، نقد ۷۰۰، قرض ۲٬۰۰۰')

await A.page.click('nav >> text=مصارف'); await A.page.click('button:has-text("صندوق")')
await A.page.click('text=انتقال پول بین جاها')
await m(A.page).locator('select').nth(1).selectOption({ label: 'خانه (جای نو)' })
await m(A.page).locator('label:has-text("مبلغ") input').fill('300')
await A.page.click('button:has-text("ثبت انتقال")')
await A.page.waitForTimeout(1000)
log('الف: ۳۰۰ به خانه منتقل شد')

const snapA = await read(A.page, async () => {
  const db = (await import('/src/db.ts')).db
  const vs = await db.variants.filter(v => !v.deleted).toArray()
  const ms = await db.cashMovements.filter(x => !x.deleted).toArray()
  const cs = await db.customers.filter(c => !c.deleted).toArray()
  const ss = await db.suppliers.filter(s => !s.deleted).toArray()
  const box = (x) => (x.box || 'دکان')
  return {
    stock: vs.reduce((s, v) => s + v.stockQty, 0),
    cash: ms.reduce((s, x) => s + x.amount, 0),
    shop: ms.filter(x => box(x) === 'دکان').reduce((s, x) => s + x.amount, 0),
    home: ms.filter(x => box(x) === 'خانه').reduce((s, x) => s + x.amount, 0),
    debt: cs.reduce((s, c) => s + c.balance, 0),
    supp: ss.reduce((s, x) => s + x.balance, 0)
  }
})
console.log('\n── وضعیت دستگاه الف ──')
check('موجودی گدام', snapA.stock, 77)
check('پول کل', snapA.cash, 700)
check('دکان', snapA.shop, 400)
check('خانه', snapA.home, 300)
check('قرض مشتری', snapA.debt, 2000)
check('قرض ما به تأمین‌کننده', snapA.supp, 15000)

await fullSync(A.page)
log('الف همگام شد')

// ── دستگاه ب ────────────────────────────────────────────────
const B = await newDevice()
await configureServer(B.page)
await B.page.locator('label:has-text("ایمیل") input').fill(OWNER)
await B.page.locator('label:has-text("رمز") input').fill('test123456')
await B.page.click('button:has-text("ورود"):not(:has-text("حساب"))')
await B.page.waitForSelector('nav >> text=داشبورد', { timeout: 30000 })
log('ب وارد شد')
await fullSync(B.page)

const snapB = await read(B.page, async () => {
  const db = (await import('/src/db.ts')).db
  const vs = await db.variants.filter(v => !v.deleted).toArray()
  const ms = await db.cashMovements.filter(x => !x.deleted).toArray()
  const cs = await db.customers.filter(c => !c.deleted).toArray()
  const ss = await db.suppliers.filter(s => !s.deleted).toArray()
  const box = (x) => (x.box || 'دکان')
  const { runIntegrityCheck } = await import('/src/lib/integrity.ts')
  const rep = await runIntegrityCheck()
  return {
    stock: vs.reduce((s, v) => s + v.stockQty, 0),
    cash: ms.reduce((s, x) => s + x.amount, 0),
    shop: ms.filter(x => box(x) === 'دکان').reduce((s, x) => s + x.amount, 0),
    home: ms.filter(x => box(x) === 'خانه').reduce((s, x) => s + x.amount, 0),
    debt: cs.reduce((s, c) => s + c.balance, 0),
    supp: ss.reduce((s, x) => s + x.balance, 0),
    mismatches: rep.mismatches.length
  }
})
console.log('\n── دستگاه ب بعد از همگام‌سازی ──')
check('موجودی گدام (باگ خرید در راه)', snapB.stock, snapA.stock)
check('پول کل', snapB.cash, snapA.cash)
check('دکان', snapB.shop, snapA.shop)
check('خانه (جای پول همگام شد)', snapB.home, snapA.home)
check('قرض مشتری', snapB.debt, snapA.debt)
check('قرض ما به تأمین‌کننده', snapB.supp, snapA.supp)
check('کنترل حساب‌ها در ب', snapB.mismatches, 0)

// ── ب تغییر می‌دهد، الف می‌گیرد ─────────────────────────────
await B.page.click('nav >> text=فروش')
await B.page.click('button:has-text("فروش جدید")')
await B.page.fill('input[placeholder="نام، سایز، رنگ یا کود..."]', '42')
await B.page.click('.fixed.inset-0 button:has-text("×۲")')
await B.page.click('button:has-text("ثبت فروش")')
await B.page.waitForSelector('text=➕ فروش بعدی')
await B.page.click('button:has-text("بستن")')
log('ب: فروش نقدی ۲ جوړه × ۹۰۰')
await fullSync(B.page)
await fullSync(A.page)

const back = await read(A.page, async () => {
  const db = (await import('/src/db.ts')).db
  const vs = await db.variants.filter(v => !v.deleted).toArray()
  const ms = await db.cashMovements.filter(x => !x.deleted).toArray()
  const { runIntegrityCheck } = await import('/src/lib/integrity.ts')
  const rep = await runIntegrityCheck()
  return {
    stock: vs.reduce((s, v) => s + v.stockQty, 0),
    cash: ms.reduce((s, x) => s + x.amount, 0),
    mismatches: rep.mismatches.length
  }
})
console.log('\n── الف بعد از گرفتن تغییر ب ──')
check('موجودی گدام', back.stock, 75)
check('پول کل', back.cash, 2500)
check('کنترل حساب‌ها در الف', back.mismatches, 0)

console.log(bad === 0 ? '\n✅ همه درست — همگام‌سازی دو موبایل سالم' : `\n❌ ${bad} بررسی ناکام`)
await browser.close()
process.exit(bad === 0 ? 0 : 1)
