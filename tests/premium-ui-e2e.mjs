import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

// Isolated local-only profile; synthetic fixtures, never the business server.
const url = process.env.URL ?? 'http://localhost:5178/?ui-preview'
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname))
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
const page = await context.newPage()
const errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.goto(url)
  await page.getByRole('heading', { name: 'میز فروش' }).waitFor()
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const pid = await db.products.add({ name: 'کوهستان آزمایشی', createdAt: Date.now() })
    await db.variants.add({ productId: pid, size: '42', color: 'سیاه', stockQty: 20, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2 })
    await db.customers.add({ name: 'مشتری آزمایشی', balance: 200, type: 'retail' })
    await db.suppliers.add({ name: 'فروشنده آزمایشی', balance: 300, kind: 'supplier' })
  })
  await page.locator('.sale-product-card').first().waitFor()
  await page.screenshot({ path: 'qa-premium-desktop.png', fullPage: true })
  const add = async () => {
    await page.locator('.sale-product-card').first().click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true, 'dialog focus is trapped inside')
    await dialog.getByRole('button', { name: /42 سیاه/ }).click()
  }
  await add()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: 'qa-premium-mobile-cart.png', fullPage: false })
  const bar = await page.locator('.sale-commit-bar').boundingBox()
  const nav = await page.locator('.app-nav').boundingBox()
  assert.ok(bar.y + bar.height <= nav.y, 'checkout bar stays above mobile navigation')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.reload()
  await page.getByRole('button', { name: 'ثبت فروش', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'ثبت فروش', exact: true }).isEnabled(), true, 'draft recovers after reload')
  await page.getByRole('button', { name: 'ثبت فروش', exact: true }).dblclick()
  await page.getByText(/فروش ثبت شد —/).waitFor()
  const committed = await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return { sales: await db.sales.count(), stock: (await db.variants.toArray())[0].stockQty } })
  assert.deepEqual(committed, { sales: 1, stock: 19 }, 'rapid submit produces one sale')
  await page.reload()
  await page.getByRole('heading', { name: 'میز فروش' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'ثبت فروش', exact: true }).isDisabled(), true, 'committed cart does not return')
  await page.getByRole('navigation', { name: 'بخش‌های اصلی' }).getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.getByLabel('جستجوی حساب').fill('مشتری آزمایشی')
  await page.locator('.account-row').first().waitFor()
  assert.equal(await page.locator('.account-row').count(), 1)
  await page.locator('.account-row').click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('navigation', { name: 'بخش‌های اصلی' }).getByRole('button', { name: 'فروش', exact: true }).click()
  await page.screenshot({ path: 'qa-premium-mobile.png', fullPage: true })
  for (const name of ['فروش', 'گدام و خرید', 'حساب‌ها', 'پول و مصارف', 'مدیریت']) {
    await page.getByRole('navigation', { name: 'بخش‌های اصلی' }).getByRole('button', { name, exact: true }).click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no mobile overflow: ' + name)
    await page.screenshot({ path: 'qa-premium-' + ({ فروش: 'sales', 'گدام و خرید': 'stock', 'حساب‌ها': 'accounts', 'پول و مصارف': 'expenses', مدیریت: 'management' })[name] + '.png', fullPage: true })
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.locator('nav button').first().evaluate(el => getComputedStyle(el).transitionDuration), '1e-05s')
  assert.deepEqual(errors, [])
  console.log('PASS: default sales, draft reload, single commit, account search/detail, focus/Escape, five mobile pages, reduced motion, clean console')
} finally { await browser.close() }
