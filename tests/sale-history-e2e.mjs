import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5189/?ui-preview'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5189', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kabul' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(url)
  await page.getByRole('heading', { name: 'میز فروش' }).waitFor()
  const fixture = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { startOfDay, addCalendarDays, toDateInput } = await import('/src/lib/format.ts')
    const today = startOfDay()
    const yesterday = addCalendarDays(today, -1)
    const line = { variantId: 1, productName: 'بوت آزمایشی', size: '42', color: 'سیاه', qty: 1, unitPrice: 10 }
    await db.sales.bulkAdd([
      { date: today + 3600000, total: 50, paid: 50, lines: [line], saleType: 'retail', customerName: 'احمد آزمایشی' },
      ...Array.from({ length: 150 }, (_, i) => ({ date: yesterday + i * 1000, total: 10, paid: 10, lines: [line], saleType: 'retail' }))
    ])
    return { yesterday: toDateInput(yesterday), snapshot: JSON.stringify(await db.sales.toArray()) }
  })
  await page.getByRole('button', { name: 'تاریخچه', exact: true }).click()
  const history = page.getByRole('region', { name: 'تاریخچه فروش' })
  await history.locator('details').first().waitFor()
  assert.equal(await history.locator('details').count(), 2)
  assert.equal(await history.locator('details').first().getAttribute('open'), '')
  assert.equal(await history.locator('details').nth(1).getAttribute('open'), null)
  assert.match(await history.locator('summary').nth(1).innerText(), /۱۵۰ فروش/)
  assert.match(await history.locator('summary').nth(1).innerText(), /۱٬۵۰۰/)
  await history.locator('summary').nth(1).click()
  await page.waitForFunction(() => document.querySelectorAll('.sale-history-row').length === 151)
  await history.locator('summary').nth(1).click()
  await history.getByLabel('جستجوی مشتری یا جنس').fill('احمد')
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="تاریخچه فروش"] details').length === 1)
  await history.getByLabel('جستجوی مشتری یا جنس').fill('')
  await history.getByLabel('از تاریخ (میلادی)').fill(fixture.yesterday)
  await history.getByLabel('تا تاریخ (میلادی)').fill(fixture.yesterday)
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="تاریخچه فروش"] details').length === 1)
  assert.match(await history.locator('summary').innerText(), /۱۵۰ فروش/)
  await history.locator('summary').click()
  await history.locator('.sale-history-row').first().click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await history.getByRole('button', { name: 'پاک‌کردن فیلترها' }).click()
  await page.screenshot({ path: 'qa-history-mobile.png', fullPage: false })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: 'qa-history-desktop.png', fullPage: false })
  assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return JSON.stringify(await db.sales.toArray()) }), fixture.snapshot)
  assert.deepEqual(errors, [])
  console.log('PASS: complete daily totals, today open/past collapsed, toggles, search, inclusive range, existing sale details, mobile overflow, unchanged sales')
} finally { await browser?.close(); server.kill() }
