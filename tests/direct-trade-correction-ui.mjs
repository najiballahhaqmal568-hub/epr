// Direct-trade correction screens driven like the owner would. Synthetic data, in-memory fake server, external requests blocked.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5202/direct-correction-ui'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5202', '--strictPort'], { stdio: 'ignore' })
const shots = '.superpowers/sdd/plan/direct-correction-screenshots'
mkdirSync(shots, { recursive: true })
let browser
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 200)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('UI error:', error.message) })
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    if (u.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa(){return window.testServer}; export async function getProfile(){return {shop_id:"test-shop",role:"owner"}}' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async () => {
    // Empty in-memory server: forms really sync before previewing.
    const remote = new Map()
    window.testServer = {
      auth: { getSession: async () => ({ data: { session: {} } }) },
      from(table) {
        const q = { select() { return q }, eq() { return q }, gt() { return q }, gte() { return q }, or() { return q }, order() { return q }, limit() { return q },
          single: async () => ({ data: { restore_generation: 0 } }),
          upsert: async rows => { if (!remote.has(table)) remote.set(table, new Map()); for (const row of rows) remote.get(table).set(row.uuid, row); return { error: null } },
          then(resolve) { return resolve({ data: [], error: null }) } }
        return q
      }
    }
    const { seed } = await import('/tests/direct-trade-fixtures.ts')
    const { db, newUuid } = await import('/src/db.ts')
    const { createDirectTrade } = await import('/src/lib/directTradeOps.ts')
    const f = await seed()
    await db.settings.put({ key: 'cachedProfile', value: { role: 'owner', shop_id: 'test-shop' } })
    window.tradeUuid = newUuid()
    window.cashUuid = newUuid()
    await createDirectTrade({ tradeUuid: window.tradeUuid, date: Date.UTC(2026, 8, 8, 8), customerId: f.customerId, supplierId: f.supplierId,
      lines: [{ lineUuid: newUuid(), productName: 'بوت مستقیم', size: '40', color: 'سیاه', qty: 10, unitCost: 1000, unitPrice: 1200 }],
      payments: [
        { eventUuid: window.cashUuid, route: 'customerCash', date: Date.UTC(2026, 8, 8, 8), amount: 3000 },
        { eventUuid: newUuid(), route: 'customerToSupplier', date: Date.UTC(2026, 8, 8, 8), amount: 7000 }
      ] })
    window.fixture = f
    window.balances = async () => {
      const { cashBalance } = await import('/src/lib/ops.ts')
      return [(await db.customers.get(f.customerId)).balance, (await db.suppliers.get(f.supplierId)).balance, await cashBalance('دکان')]
    }
    window.cash0 = (await window.balances())[2]
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Detail } = await import('/src/pages/sales/direct/DirectTradeDetail.tsx')
    window.root = ReactDOM.createRoot(document.getElementById('root'))
    window.show = (isStaff = false) => window.root.render(React.createElement(Detail, { tradeUuid: window.tradeUuid, isStaff, onClose() {} }))
    window.show()
  })
  const balances = () => page.evaluate(() => window.balances())
  const cash0 = await page.evaluate(() => window.cash0)
  const detail = page.getByRole('dialog', { name: 'جزئیات فروش مستقیم' })
  await detail.waitFor()
  assert.deepEqual(await balances(), [3000, 5000, cash0])

  // 1) Correct the trade: 10 → 9 pairs.
  await detail.getByRole('button', { name: 'اصلاح معامله', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'اصلاح فروش مستقیم' })
  await form.getByLabel('تعداد 1', { exact: true }).fill('۹')
  await form.getByRole('button', { name: 'پیش‌نمایش اصلاح' }).click()
  await form.getByText('دلیل اصلاح را بنویسید.').waitFor()
  await form.getByLabel('دلیل اصلاح معامله').fill('یک جوره کم رسید')
  await form.getByRole('button', { name: 'پیش‌نمایش اصلاح' }).click()
  const effect = form.getByRole('region', { name: 'اثر اصلاح' })
  await effect.waitFor()
  assert.match(await effect.innerText(), /قرض مشتری: −۱٬۲۰۰[\s\S]*قرض ما به فروشنده: −۱٬۰۰۰[\s\S]*مفاد: −۲۰۰/)
  assert.deepEqual(await balances(), [3000, 5000, cash0], 'preview writes nothing')
  assert.equal(await form.getByRole('button', { name: 'ثبت اصلاح', exact: true }).isDisabled(), true, 'confirmation required')
  await form.getByRole('checkbox').check()
  await page.screenshot({ path: `${shots}/correct-trade-390.png`, fullPage: true })
  await form.getByRole('button', { name: 'ثبت اصلاح', exact: true }).evaluate(button => { button.click(); button.click() })
  await form.waitFor({ state: 'detached' })
  assert.deepEqual(await balances(), [1800, 4000, cash0])
  await detail.getByText('سابقهٔ اصلاح (۱)').click()
  await detail.getByText(/دلیل: یک جوره کم رسید/).waitFor()

  // 2) Correct the cash receipt: 3,000 → 2,500.
  await detail.locator('div', { hasText: /^دریافت از مشتری/ }).getByRole('button', { name: 'اصلاح یا لغو این پرداخت' }).click()
  const pay = page.getByRole('dialog', { name: 'اصلاح پرداخت' })
  await pay.getByLabel('مبلغ درست پرداخت').fill('۲۵۰۰')
  await pay.getByLabel('دلیل تغییر پرداخت').fill('پنجصد کمتر گرفته شد')
  await pay.getByRole('button', { name: 'پیش‌نمایش' }).click()
  assert.match(await pay.getByRole('region', { name: 'اثر تغییر پرداخت' }).innerText(), /قرض مشتری: \+۵۰۰[\s\S]*صندوق «دکان»: −۵۰۰/)
  await pay.getByRole('checkbox').check()
  await pay.getByRole('button', { name: 'ثبت اصلاح پرداخت' }).click()
  await pay.waitFor({ state: 'detached' })
  assert.deepEqual(await balances(), [2300, 4000, cash0 - 500])
  await detail.getByText(/اصلاح‌شده از ۳٬۰۰۰ ؋ — دلیل: پنجصد کمتر گرفته شد/).waitFor()

  // 3) Staff never see correction controls.
  await page.evaluate(() => window.show(true))
  await detail.getByText('مجموع فروش').waitFor()
  assert.equal(await detail.getByRole('button', { name: 'اصلاح معامله' }).count(), 0)
  assert.equal(await detail.getByRole('button', { name: /اصلاح یا لغو این پرداخت/ }).count(), 0)
  await page.evaluate(() => window.show(false))

  // 4) Cancel the trade.
  await detail.getByRole('button', { name: 'لغو معامله', exact: true }).click()
  const cancelBox = detail.getByRole('region', { name: 'لغو معامله' })
  assert.equal(await cancelBox.getByRole('button', { name: 'پیش‌نمایش لغو' }).isDisabled(), true, 'reason first')
  await cancelBox.getByLabel('دلیل لغو معامله').fill('اشتباه ثبت شده بود')
  await cancelBox.getByRole('button', { name: 'پیش‌نمایش لغو' }).click()
  const cancelEffect = cancelBox.getByLabel('اثر لغو', { exact: true })
  await cancelEffect.waitFor()
  assert.match(await cancelEffect.innerText(), /قرض مشتری: −۱۰٬۸۰۰[\s\S]*قرض ما به فروشنده: −۹٬۰۰۰[\s\S]*مفاد: −۱٬۸۰۰[\s\S]*دریافت نقد از مشتری ۲٬۵۰۰/)
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => document.documentElement.style.fontSize = '20px')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog[open] *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) }).length), 0, 'detail fits 320px with large text')
  await page.screenshot({ path: `${shots}/cancel-preview-320.png`, fullPage: true })
  await page.evaluate(() => document.documentElement.style.fontSize = '')
  await page.setViewportSize({ width: 390, height: 844 })
  await cancelBox.getByRole('checkbox').check()
  await cancelBox.getByRole('button', { name: 'تأیید لغو معامله' }).click()
  await detail.getByText(/این معامله لغو شده است/).waitFor()
  // 1,000 old − 2,500 − 7,000 = −8,500; supplier 2,000 − 7,000 = −5,000; till unchanged by the cancellation.
  assert.deepEqual(await balances(), [-8500, -5000, cash0 - 500])
  assert.equal(await detail.getByRole('button', { name: 'اصلاح معامله' }).count(), 0)
  assert.equal(await detail.getByRole('button', { name: 'لغو این پرداخت اشتباه' }).count(), 2)
  await page.screenshot({ path: `${shots}/cancelled-390.png`, fullPage: true })

  // 5) The cancelled trade stays visible in the customer's ledger without changing the balance.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: CustomerDetail } = await import('/src/pages/customers/CustomerDetail.tsx')
    window.root.render(React.createElement(CustomerDetail, { customer: await db.customers.get(window.fixture.customerId), onClose() {} }))
  })
  await page.getByText('فروش مستقیم — لغو شده').waitFor()
  await page.getByText('دلیل لغو: اشتباه ثبت شده بود').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: direct trade correction, payment correction, staff privacy, cancellation preview/confirm, cancelled audit row, 320px fit')
} finally { await browser?.close(); server.kill() }
