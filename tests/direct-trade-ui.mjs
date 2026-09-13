// Only synthetic data in a disposable browser. All external requests blocked.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5201/direct-ui'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5201', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 200)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', error => { errors.push(error.message); console.error('UI error:', error.message) })
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async () => {
    const { seed } = await import('/tests/direct-trade-fixtures.ts')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Sales } = await import('/src/pages/Sales.tsx')
    window.fixture = await seed()
    window.root = ReactDOM.createRoot(document.getElementById('root'))
    window.root.render(React.createElement(Sales))
  })
  // This must be reachable from the real sales workspace, not a test-only form.
  assert.equal(await page.getByRole('button', { name: 'فروش مستقیم', exact: true }).count(), 1)
  await page.getByRole('button', { name: 'فروش مستقیم', exact: true }).click()
  await page.getByLabel('مشتری', { exact: true }).selectOption({ label: 'مشتری مستقیم' })
  await page.getByLabel('فروشنده', { exact: true }).selectOption({ label: 'فروشنده مستقیم' })
  await page.getByLabel('نام جنس', { exact: true }).fill('بوت مستقیم')
  await page.getByLabel('سایز', { exact: true }).fill('۴۰')
  await page.getByLabel('رنگ', { exact: true }).fill('سیاه')
  await page.getByLabel('تعداد جوره', { exact: true }).fill('۱۰')
  await page.getByLabel('قیمت خرید فی جوره', { exact: true }).fill('۱۰۰۰')
  await page.getByLabel('قیمت فروش فی جوره', { exact: true }).fill('۱۲۰۰')
  await page.getByLabel('دریافت از مشتری', { exact: true }).fill('۳۰۰۰')
  await page.getByLabel('مشتری مستقیم به فروشنده داده', { exact: true }).fill('۷۰۰۰')
  await page.getByLabel('معلومات معامله را بررسی کردم').check()
  await page.getByLabel('تعداد جوره', { exact: true }).fill('-2')
  assert.equal(await page.getByRole('button', { name: 'ثبت معامله', exact: true }).isDisabled(), true)
  await page.getByLabel('تعداد جوره', { exact: true }).fill('۱۰')
  await page.getByLabel('معلومات معامله را بررسی کردم').check()
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'qa-direct-trade-form.png', fullPage: true })
  await page.getByRole('button', { name: 'ثبت معامله', exact: true }).evaluate(button => { button.click(); button.click() })
  await page.getByRole('heading', { name: 'جزئیات فروش مستقیم', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { loadDirectTrade } = await import('/src/lib/directTradeState.ts')
    const { cashBalance } = await import('/src/lib/ops.ts')
    const sales = await db.sales.filter(s => !!s.directTrade).toArray()
    const state = await loadDirectTrade(sales[0].directTrade.uuid)
    return [sales.length, state.totals.profit, state.balances.customerRemaining, state.balances.supplierRemaining,
      (await db.customers.get(window.fixture.customerId)).balance, (await db.suppliers.get(window.fixture.supplierId)).balance,
      await cashBalance(), (await db.variants.get(window.fixture.variantId)).stockQty]
  }), [1, 2000, 2000, 3000, 3000, 5000, 19000, 30])
  assert.equal(await page.getByRole('button', { name: 'حذف فروش', exact: true }).count(), 0)
  await page.getByRole('button', { name: 'رسید مشتری', exact: true }).click()
  const receipt = page.getByRole('dialog').last()
  assert.doesNotMatch(await receipt.innerText(), /قیمت خرید|مفاد|۱٬۰۰۰/)
  assert.match(await receipt.innerText(), /بوت مستقیم/)
  await receipt.getByRole('button', { name: 'بستن', exact: true }).click()
  await page.getByRole('button', { name: 'پرداخت تازه', exact: true }).click()
  await page.getByLabel('دریافت از مشتری', { exact: true }).fill('۱۰۰۰')
  await page.getByRole('button', { name: 'ثبت پرداخت مستقیم', exact: true }).click()
  await page.getByRole('heading', { name: 'پرداخت فروش مستقیم', exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { cashBalance } = await import('/src/lib/ops.ts')
    return [(await db.customers.get(window.fixture.customerId)).balance, await cashBalance()]
  }), [2000, 20000])
  await page.getByRole('button', { name: 'پرداخت تازه', exact: true }).click()
  await page.getByRole('combobox').filter({ has: page.locator('option[value="supplierPayment"]') }).selectOption('supplierPayment')
  await page.getByLabel('پرداخت به فروشنده', { exact: true }).fill('۲۰۰۰')
  await page.getByLabel('سهم صراف از پرداخت فروشنده', { exact: true }).fill('۱۰۰۰')
  await page.getByRole('combobox').filter({ has: page.locator('option', { hasText: 'صراف آزمایشی' }) }).selectOption({ label: 'صراف آزمایشی' })
  await page.getByRole('button', { name: 'ثبت پرداخت مستقیم', exact: true }).click()
  await page.getByRole('heading', { name: 'پرداخت فروش مستقیم', exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { cashBalance } = await import('/src/lib/ops.ts')
    return [(await db.suppliers.get(window.fixture.supplierId)).balance, (await db.suppliers.get(window.fixture.sarrafId)).balance, await cashBalance()]
  }), [3000, -3000, 19000])
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.settings.put({ key: 'cachedProfile', value: { role: 'staff' } })
  })
  await page.getByRole('button', { name: 'پرداخت تازه', exact: true }).waitFor({ state: 'hidden' })
  const staffDetail = await page.getByRole('dialog').last().innerText()
  assert.doesNotMatch(staffDetail, /مجموع خرید|مفاد:|فروشنده:|پرداخت به فروشنده/)
  assert.match(staffDetail, /مشتری مستقیم به فروشنده داده/)
  assert.deepEqual(errors, [])
  console.log('PASS: actual Sales direct form, Dari inputs, invalid quantity, responsive widths, double-submit accounting and customer-safe receipt')
} finally { await browser?.close(); server.kill() }
