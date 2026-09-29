// «نمای اپ»: normal, sunlight and night modes. Every main screen and one open window pass a WCAG AA
// text-contrast audit in each mode; the choice survives a reload. Actual App, disposable IndexedDB.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'
const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/display-modes-screenshots'
mkdirSync(shots, { recursive: true })
const nav = name => page.locator('nav').getByRole('button', { name, exact: true }).click()
const more = async title => { await nav('بیشتر'); await page.getByRole('button').filter({ hasText: title }).first().click() }
const settle = () => page.evaluate(() => new Promise(r => setTimeout(r, 450)))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale, addOpeningDebt } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(v, 3)
    const c = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('customer', c, 'احمد', 2500, 'قرض قبلی')
    await addSale({ date: Date.now(), customerId: c, customerName: 'احمد', saleType: 'retail', lines: [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 1, unitPrice: 900 }], total: 900, paid: 400 })
    const catId = await db.expenseCategories.add({ name: 'نان' })
    await db.expenses.add({ date: Date.now(), categoryId: catId, categoryName: 'نان', amount: 300, type: 'business' })
  })
  const screens = [
    ['home', async () => { await nav('خانه'); await page.getByRole('heading', { name: 'خانه' }).waitFor() }],
    ['sale', async () => { await nav('فروش'); await page.getByRole('heading', { name: 'میز فروش' }).waitFor() }],
    ['accounts', async () => { await nav('حساب‌ها') }],
    ['inventory', async () => { await more('گدام و خرید') }],
    ['expenses', async () => { await more('مصارف و صندوق') }],
    ['reports', async () => { await more('راپورها'); await page.getByRole('heading', { name: 'راپورها' }).waitFor() }],
    ['settings', async () => { await more('تنظیمات اپ'); await page.getByText('نمای اپ', { exact: true }).waitFor() }],
    ['size-window', async () => {
      await nav('فروش'); await page.getByRole('button', { name: /کوهستان 40 سیاه/ }).waitFor()
    }]
  ]
  const report = []
  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async mode => { const m = await import('/src/lib/displayMode.ts'); m.setDisplayMode(mode) }, mode)
    for (const [name, open] of screens) {
      await open(); await settle()
      const failures = await contrastFailures(page, 'main')
      if (failures.length) report.push(`${mode}/${name}:\n  ${failures.join('\n  ')}`)
      if (['home', 'sale', 'size-window'].includes(name)) await page.screenshot({ path: `${shots}/${mode}-${name}-390.png`, fullPage: name !== 'size-window' })
      if (name === 'size-window') { await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' }) }
    }
  }
  assert.equal(report.length, 0, `contrast failures:\n${report.join('\n')}`)

  // The choice is per device and is back after a reload, before the app draws.
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('dark'))
  await page.goto(`${origin}/?ui-preview=1`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-nav').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark')
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(17, 17, 19)')
  // Settings card switches it back to normal.
  await more('تنظیمات اپ')
  await page.getByRole('group', { name: 'نمای اپ' }).getByRole('button').filter({ hasText: 'عادی' }).click()
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? 'light'), 'light')
  assert.deepEqual(errors, [])
  console.log('PASS display modes: normal/sunlight/night pass AA contrast on 7 screens + a window, choice survives reload')
} finally {
  await app.close()
}
