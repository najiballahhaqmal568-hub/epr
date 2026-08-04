/** آزمایش واقعی مرورگر: رفتن از ویزارد کارتنی به فورم کامل، بدون گم شدن جزئیات */
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
await page.click('button:has-text("بوت جدید")')
await page.waitForSelector('text=جنس کارتنی جدید')

// جزئیات را در ویزارد کارتنی می‌نویسیم
await page.fill('input[placeholder="مثلاً اسکچرز"]', 'چرمی شهرت')
await page.fill('input[placeholder="خاکی"]', 'سرخ')
const nums = page.locator('input[inputmode="numeric"]')
await nums.nth(0).fill('750') // قیمت خرید
await nums.nth(1).fill('1200') // پرچون
await nums.nth(2).fill('1000') // عمده
// برند هم — تنها فیلد متنیِ بدون placeholder در همان شبکه
const brandBox = page.locator('.grid input:not([inputmode="numeric"])').first()
await brandBox.fill('البشیر')
await page.waitForTimeout(300)

// حالا نظرمان عوض می‌شود و به فورم عادی می‌رویم
await page.click('text=ثبت عادی بدون کارتن')
await page.waitForSelector('text=نام بوت', { timeout: 10000 })
await page.waitForTimeout(500)

const val = async (sel) => (await page.locator(sel).inputValue()).trim()
if ((await val('input[placeholder="مثلاً بوت چرمی مردانه"]')) !== 'چرمی شهرت')
  fail('نام جنس منتقل نشد')
// رنگ و قیمت‌ها در ردیف اول سایز باید آماده باشند
const rowNums = page.locator('input[inputmode="numeric"]')
const cost = await rowNums.nth(0).inputValue()
const retail = await rowNums.nth(2).inputValue()
const wholesale = await rowNums.nth(3).inputValue()
if (cost !== '750') fail(`قیمت خرید منتقل نشد: «${cost}»`)
if (retail !== '1200') fail(`قیمت پرچون منتقل نشد: «${retail}»`)
if (wholesale !== '1000') fail(`قیمت عمده منتقل نشد: «${wholesale}»`)
const color = await page.locator('input[placeholder="سیاه"]').first().inputValue()
if (color !== 'سرخ') fail(`رنگ منتقل نشد: «${color}»`)
console.log('✅ نام، رنگ و هر سه قیمت با خود آمدند — دوباره نوشتن لازم نیست')

// و ثبت هم کار می‌کند
await page.locator('input[placeholder="۴۲"]').first().fill('38')
await rowNums.nth(1).fill('6') // موجودی
await page.click('button:has-text("ذخیره")')
await page.waitForTimeout(1200)
const body2 = await page.locator('body').innerText()
if (!/چرمی شهرت/.test(body2)) fail('جنس ثبت نشد:\n' + body2.slice(0, 600))
if (!/۶ جوړه/.test(body2)) fail('موجودی ۶ نیامد')
if (!/ارزش: ۴٬۵۰۰/.test(body2)) fail('ارزش ۶×۷۵۰ = ۴٬۵۰۰ نیامد:\n' + body2.slice(0, 600))
console.log('✅ ثبت شد — ۶ جوړه، ارزش ۴٬۵۰۰')
process.exit(0)
