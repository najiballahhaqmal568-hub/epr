// Profit tools: below-cost warning at sale time, «مفاد هر جنس» in Reports, monthly target on Home, «بستن روز» in the evening card.
// Actual App, disposable IndexedDB, external requests blocked by localApp.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/profit-tools-screenshots'
mkdirSync(shots, { recursive: true })
try {
  // 1) Evening clock (19:00 local) so «بستن امروز» is offered; the day's documents are seeded after reload.
  const evening = await page.evaluate(() => { const d = new Date(); d.setHours(19, 0, 0, 0); return d.getTime() })
  await page.clock.setFixedTime(evening)
  await page.goto(`${origin}/?ui-preview=1`, { waitUntil: 'domcontentloaded' })
  await page.locator('.app-nav').waitFor()
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale } = await import('/src/lib/ops.ts')
    const good = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    window.goodId = await db.variants.add({ productId: good, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(window.goodId, 20)
    const bad = await db.products.add({ name: 'بامیان', createdAt: Date.now() })
    const badId = await db.variants.add({ productId: bad, size: '42', color: 'قهوه‌ای', stockQty: 0, purchasePrice: 1000, retailPrice: 1500, wholesalePrice: 1400 })
    await setOpeningStock(badId, 5)
    const c = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: Date.now() })
    const catId = await db.expenseCategories.add({ name: 'نان' })
    // Profit: 3 × 400 = 1,200 and 1 × (800 − 1,000) = −200 → 1,000; expense 300 → net 700; credit 800.
    await addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: window.goodId, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 3, unitPrice: 900 }], total: 2700, paid: 2700 })
    await addSale({ date: Date.now(), customerId: c, customerName: 'احمد', saleType: 'retail', lines: [{ variantId: badId, productName: 'بامیان', size: '42', color: 'قهوه‌ای', qty: 1, unitPrice: 800 }], total: 800, paid: 0 })
    await db.expenses.add({ date: Date.now(), categoryId: catId, categoryName: 'نان', amount: 300, type: 'business' })
  })
  await page.getByRole('heading', { name: 'خانه' }).waitFor()

  // 2) «بستن امروز»: numbers, then the task disappears and dayClosed is stored.
  await page.getByRole('region', { name: 'پیام این ساعت' }).getByRole('button', { name: 'بستن روز' }).click()
  const close = page.getByRole('dialog', { name: /بستن روز/ })
  const summary = await close.getByRole('region', { name: 'خلاصهٔ روز' }).innerText()
  assert.match(summary, /فروش \(۲\)\s*۳٬۵۰۰ ؋[\s\S]*مفاد فروش\s*۱٬۰۰۰ ؋[\s\S]*مصارف تجارت\s*−۳۰۰ ؋[\s\S]*مفاد خالص امروز\s*۷۰۰ ؋/)
  assert.match(await close.getByRole('region', { name: 'قرض امروز' }).innerText(), /قرض تازه به مشتریان\s*۸۰۰ ؋/)
  await page.screenshot({ path: `${shots}/daily-close-390.png`, fullPage: true })
  await close.getByRole('button', { name: 'دیدم — روز بسته شد' }).click()
  await close.getByRole('status').filter({ hasText: 'روز بسته شد ✓' }).waitFor()
  await close.waitFor({ state: 'detached' })
  await page.getByRole('region', { name: 'پیام این ساعت' }).waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('dayClosed'))?.value), (await page.evaluate(async () => (await import('/src/lib/format.ts')).startOfDay(Date.now()))))

  // 3) Monthly target: set 2,000 → 700 / 2,000 = 35٪ on the Home card.
  const card = page.getByRole('button', { name: /مفاد خالص این ماه .* از کجا آمد/ })
  await card.click()
  const target = page.getByRole('region', { name: 'هدف مفاد ماهانه' })
  await target.getByLabel('هدف مفاد خالص هر ماه').fill('۲۰۰۰')
  await target.getByRole('button', { name: 'ثبت هدف' }).click()
  await target.getByText(/هدف فعلی: ۲٬۰۰۰ ؋/).waitFor()
  await page.keyboard.press('Escape')
  await card.getByText(/هدف ۲٬۰۰۰ ؋ — ۳۵٪ رسیده · [۰-۹]+ روز مانده/).waitFor()
  await page.screenshot({ path: `${shots}/target-390.png`, fullPage: true })

  // Reaching the target: one small celebration this month, and a lasting mark on the card.
  const confetti = () => page.evaluate(() => new Promise(resolve => {
    let n = 0
    const obs = new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(x => { if (x.classList?.contains('confetti-bit')) n++ })))
    obs.observe(document.body, { childList: true })
    setTimeout(() => { obs.disconnect(); resolve(n) }, 1500)
  }))
  const burst = confetti()
  await page.evaluate(async () => {
    const { addSale } = await import('/src/lib/ops.ts')
    await addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: window.goodId, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 4, unitPrice: 900 }], total: 3600, paid: 3600 })
  })
  assert.ok(await burst > 0, 'confetti once target reached')
  await card.getByText('🎉 هدف این ماه رسید').waitFor()
  const again = confetti()
  await page.evaluate(async () => {
    const { addSale } = await import('/src/lib/ops.ts')
    await addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: window.goodId, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 1, unitPrice: 900 }], total: 900, paid: 900 })
  })
  assert.equal(await again, 0, 'no second celebration in the same month')

  // 4) Reports «مفاد هر جنس»: best first, the below-cost product in red.
  await card.click()
  await page.locator('dialog[open]').getByRole('button', { name: 'راپور کامل' }).click()
  await page.getByRole('heading', { name: 'راپورها' }).waitFor()
  const perProduct = await page.getByRole('region', { name: 'مفاد هر جنس' }).innerText()
  assert.match(perProduct, /کوهستان\s*۳٬۲۰۰ ؋\s*۸ جوړه · مفاد ۴۴٪\s*بامیان\s*[\u200e−-]*۲۰۰ ؋\s*۱ جوړه · مفاد [\u200e−-]*۲۵٪[\s\S]*زیر قیمت خرید فروخته شده/)

  // 5) Sale time: a price under cost warns the owner with the cost and the loss.
  await page.locator('nav').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('button', { name: /کوهستان 40 سیاه/ }).click()
  const price = page.getByLabel('قیمت کوهستان 40', { exact: true })
  await price.fill('450')
  await page.getByRole('alert').filter({ hasText: 'زیر قیمت خرید (۵۰۰ ؋) — زیان ۵۰ ؋' }).waitFor()
  await price.fill('900')
  await page.getByRole('alert').filter({ hasText: 'زیر قیمت خرید' }).waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  console.log('PASS profit tools: daily close numbers + stored, monthly target progress, per-product profit, below-cost warning')
} finally {
  await app.close()
}
