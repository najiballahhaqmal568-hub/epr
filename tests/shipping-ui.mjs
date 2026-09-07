// Local-only UI and real accounting. No production account or remote requests.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5196/shipping-ui'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5196', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Shipping } = await import('/src/pages/sales/SaleShipping.tsx')
    const c = await db.customers.add({ name: 'مشتری آزمایشی', balance: 0, type: 'wholesale' })
    const id = await db.sales.add({ date: Date.now(), saleType: 'wholesale', customerId: c, customerName: 'مشتری آزمایشی', total: 0, paid: 0, lines: [] })
    await db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount: 2000 })
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Shipping, { sale: await db.sales.get(id) }))
    window.result = async () => ({ cash: (await db.cashMovements.toArray()).filter(x => !x.deleted).reduce((a, x) => a + x.amount, 0), debt: (await db.customers.get(c)).balance, active: (await db.payments.toArray()).filter(x => !x.deleted).length })
  })
  await page.getByRole('button', { name: 'ثبت کرایهٔ بار', exact: true }).click()
  await page.getByLabel('کل کرایه (افغانی)', { exact: true }).fill('۵۰۰')
  await page.getByLabel('مسئول کرایه', { exact: true }).selectOption('split')
  await page.getByLabel('سهم مشتری (افغانی)', { exact: true }).fill('۳۰۰')
  await page.getByLabel('دریافت نقدی کرایه از مشتری', { exact: true }).fill('۱۰۰')
  await page.getByText(/قرض کرایه:.*۲۰۰/).waitFor()
  await page.getByLabel('دریافت نقدی کرایه از مشتری', { exact: true }).fill('۴۰۰')
  assert.equal(await page.getByRole('button', { name: 'ذخیرهٔ کرایه', exact: true }).isDisabled(), true)
  await page.getByLabel('دریافت نقدی کرایه از مشتری', { exact: true }).fill('۱۰۰')
  await page.screenshot({ path: 'qa-shipping-form.png', fullPage: true })
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  }
  await page.getByRole('button', { name: 'ذخیرهٔ کرایه', exact: true }).click()
  await page.getByRole('button', { name: 'اصلاح کرایه', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.result()), { cash: 1600, debt: 200, active: 1 })
  await page.getByRole('button', { name: 'اصلاح کرایه', exact: true }).click()
  await page.getByLabel('کل کرایه (افغانی)', { exact: true }).fill('۶۰۰')
  await page.getByLabel('مسئول کرایه', { exact: true }).selectOption('customer')
  await page.getByLabel('دلیل اصلاح', { exact: true }).fill('مبلغ اشتباه بود')
  await page.getByRole('button', { name: 'ذخیرهٔ اصلاح', exact: true }).click()
  await page.getByRole('button', { name: 'لغو کرایه', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.result()), { cash: 1500, debt: 500, active: 1 })
  await page.getByRole('button', { name: 'لغو کرایه', exact: true }).click()
  await page.getByLabel('دلیل لغو', { exact: true }).fill('ثبت اشتباهی')
  await page.getByRole('button', { name: 'تأیید لغو کرایه', exact: true }).click()
  await page.getByText('هنوز کرایه‌ای ثبت نشده است.').waitFor()
  assert.deepEqual(await page.evaluate(() => window.result()), { cash: 2000, debt: 0, active: 0 })
  assert.deepEqual(errors, [])
  console.log('PASS: freight create/correct/cancel UI, Dari amounts, responsive layout, real cash and customer debt')
} finally { await browser?.close(); server.kill() }
