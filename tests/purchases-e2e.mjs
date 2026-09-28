// Purchase history redesign: every action reachable, receive/landing guarded, readable at all widths.
// Actual App, disposable IndexedDB, external requests blocked by localApp.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/task-7-screenshots'
mkdirSync(shots, { recursive: true })
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { addPurchase, addLandingCost } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const variantId = await db.variants.add({ productId, size: '42', color: 'سیاه', stockQty: 0, purchasePrice: 0, retailPrice: 900, wholesalePrice: 800 })
    const supplierId = await db.suppliers.add({ name: 'تأمین‌کنندهٔ آزمایشی', balance: 0, createdAt: Date.now() })
    const line = { variantId, productName: 'کوهستان', size: '42', color: 'سیاه', qty: 10, unitCost: 500 }
    window.receivedId = await addPurchase({ date: Date.now() - 60_000, supplierId, supplierName: 'تأمین‌کنندهٔ آزمایشی', lines: [line], total: 5000, paid: 0 })
    await addLandingCost([window.receivedId], 300, 'later')
    window.transitId = await addPurchase({ date: Date.now(), supplierId, supplierName: 'تأمین‌کنندهٔ آزمایشی', lines: [{ ...line, qty: 6 }], total: 3000, paid: 0, received: false })
    window.state = async () => ({
      stock: (await db.variants.get(variantId)).stockQty,
      transitReceived: (await db.purchases.get(window.transitId)).received,
      landingUnpaid: (await db.purchases.get(window.receivedId)).landingUnpaid ?? 0,
      cash: (await db.cashMovements.toArray()).filter(x => !x.deleted).reduce((sum, x) => sum + x.amount, 0),
      adjustments: (await db.adjustments.toArray()).filter(x => !x.deleted).length
    })
  })
  assert.deepEqual(await page.evaluate(() => window.state()), { stock: 10, transitReceived: false, landingUnpaid: 300, cash: 0, adjustments: 0 })

  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button', { name: /گدام و خرید/ }).click()
  await page.getByRole('region', { name: 'مدیریت گدام' }).getByRole('button', { name: 'خرید', exact: true }).click()
  const main = page.getByRole('region', { name: 'خریدها' })
  await main.waitFor()

  // Every entry point stays reachable without an extra filter tap.
  for (const name of ['ثبت خرید جدید', 'ثبت مصارف رسیدن', 'کاندیدهای خرید', 'همه', 'قرض‌دار', 'در راه']) {
    assert.equal(await page.getByRole('button', { name, exact: true }).count() > 0, true, `button ${name}`)
  }
  assert.equal(await page.getByRole('button', { name: /^موجودی/ }).count() > 0, true, 'back to stock')
  assert.equal(await page.getByRole('button', { name: /^خرید مجدد/ }).count() > 0, true, 'reorder')
  assert.equal(await page.getByRole('searchbox', { name: 'جستجوی خرید' }).count(), 1, 'search')

  const received = main.getByRole('article').filter({ hasText: '۵٬۰۰۰' })
  const transit = main.getByRole('article').filter({ hasText: 'در راه' })
  for (const name of ['مرجوعی به تأمین‌کننده', 'اصلاح خرید', 'خرید اشتباهی']) {
    assert.equal(await received.getByRole('button', { name, exact: true }).count(), 1, `received purchase: ${name}`)
  }
  for (const name of ['اصلاح خرید', 'خرید اشتباهی']) {
    assert.equal(await transit.getByRole('button', { name, exact: true }).count(), 1, `in-transit purchase: ${name}`)
  }
  assert.equal(await transit.getByRole('button', { name: 'مرجوعی به تأمین‌کننده', exact: true }).count(), 0, 'no return before goods arrive')

  // Paying landing from an empty till is refused with a visible Dari reason, not silently.
  await received.getByRole('button', { name: /پرداخت مصارف رسیدن/ }).click()
  const alert = page.getByRole('alert').filter({ hasText: 'کافی نیست' })
  await alert.waitFor()
  assert.deepEqual(await page.evaluate(() => window.state()), { stock: 10, transitReceived: false, landingUnpaid: 300, cash: 0, adjustments: 0 })

  // In-transit filter, then receive with a double tap: stock rises exactly once.
  await page.getByRole('button', { name: 'در راه', exact: true }).click()
  assert.equal(await page.getByRole('button', { name: 'در راه', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await main.getByRole('article').count(), 1, 'only the in-transit purchase')
  await transit.getByRole('button', { name: /جنس رسید/ }).evaluate(button => { button.click(); button.click() })
  await page.waitForFunction(async () => (await window.state()).transitReceived === true)
  const after = await page.evaluate(() => window.state())
  assert.equal(after.stock, 16, 'received once')
  await main.getByText('خریدی با این جستجو یا فلتر پیدا نشد.').waitFor()
  await page.getByRole('button', { name: 'همه', exact: true }).click()
  assert.equal(await main.getByRole('article').count(), 2)

  // Search narrows by product text.
  await page.getByRole('searchbox', { name: 'جستجوی خرید' }).fill('بامیان')
  assert.equal(await main.getByRole('article').count(), 0)
  await page.getByRole('searchbox', { name: 'جستجوی خرید' }).fill('کوهستان')
  assert.equal(await main.getByRole('article').count(), 2)

  // Readable at every width with enlarged text.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => document.documentElement.style.fontSize = '20px')
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) }).map(el => [el.tagName, el.className]))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `fits ${width}: ${JSON.stringify(overflow)}`)
    await page.evaluate(() => document.documentElement.style.fontSize = '')
    await page.screenshot({ path: `${shots}/purchases-${width}.png`, fullPage: true })
  }

  // Every purchase form opens, fits 320px with enlarged text, and writes nothing until saved.
  const before = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    return JSON.stringify(await Promise.all(['purchases', 'variants', 'suppliers', 'cashMovements', 'adjustments', 'returns'].map(t => db.table(t).toArray())))
  })
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => document.documentElement.style.fontSize = '20px')
  page.on('dialog', d => d.accept())
  const row = main.getByRole('article').filter({ hasText: '۵٬۰۰۰' })
  for (const [label, open] of [
    ['new', () => page.getByRole('button', { name: 'ثبت خرید جدید', exact: true }).click()],
    ['carton', async () => { await page.getByRole('button', { name: 'ثبت خرید جدید', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: /جنس جدید — خرید کارتنی/ }).click() }],
    ['landing', () => page.getByRole('button', { name: 'ثبت مصارف رسیدن', exact: true }).click()],
    ['return', () => row.getByRole('button', { name: 'مرجوعی به تأمین‌کننده', exact: true }).click()],
    ['correct', () => row.getByRole('button', { name: 'اصلاح خرید', exact: true }).click()],
    ['cancel', () => row.getByRole('button', { name: 'خرید اشتباهی', exact: true }).click()]
  ]) {
    await open()
    const dialog = page.locator('dialog[open]').last()
    await dialog.waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const overflow = await page.evaluate(() => [...document.querySelectorAll('dialog[open] *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) }).map(el => [el.tagName, el.className]))
    assert.deepEqual(overflow, [], `${label} form fits 320`)
    await dialog.screenshot({ path: `${shots}/form-${label}-320.png` })
    while (await page.locator('dialog[open]').count()) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(250)
    }
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '')
  const afterForms = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    return JSON.stringify(await Promise.all(['purchases', 'variants', 'suppliers', 'cashMovements', 'adjustments', 'returns'].map(t => db.table(t).toArray())))
  })
  assert.equal(afterForms, before, 'opening and closing forms writes nothing')

  // Candidates view opens and returns.
  await page.getByRole('button', { name: 'کاندیدهای خرید', exact: true }).click()
  await page.getByRole('button', { name: 'بازگشت به خریدهای اخیر', exact: true }).click()
  await main.waitFor()

  assert.deepEqual(errors, [])
  console.log('PASS purchases: actions reachable, landing refusal visible, receive once, filters/search, 320–1440 layout, six forms fit and write nothing, candidates')
} finally {
  await app.close()
}
