// The owner's case: a heavy-expense month shows a loss, but the year is in profit. The home headline is the
// year (1 Hamal → today), this month sits below it, and tapping the year opens «امسال» in the report with the
// same number. Synthetic data only; external requests blocked by localApp.
// Numbers are worked out by hand in the comments so a wrong screen cannot pass by accident.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'

const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ')
// 29 Sep 2026 = 7 Mizan 1405. This year began 1 Hamal 1405 = 21 Mar 2026; this month began 1 Mizan = 23 Sep.
const now = new Date(2026, 8, 29, 14, 30)

try {
  await page.clock.setFixedTime(now)
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    await db.settings.bulkPut([
      { key: 'supaUrl', value: 'https://example.invalid' },
      { key: 'supaKey', value: 'synthetic-test-key' },
      { key: 'cachedProfile', value: { user_id: 'synthetic-owner', shop_id: 'synthetic-shop', role: 'owner', name: 'مالک آزمایشی' } },
      { key: 'firstDayDone', value: true }
    ])
    const productId = await db.products.add({ name: 'کوهستان', createdAt: 1 })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 1000, retailPrice: 3000, wholesalePrice: 2500 })
    await ops.setOpeningStock(v, 100)
    const line = (qty) => [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', unitPrice: 3000, qty }]
    const day = (y, m, d) => new Date(y, m, d, 11, 0).getTime()
    const cat = await db.expenseCategories.add({ name: 'کرایهٔ دکان' })
    const expense = (date, amount) => ops.addExpense({ date, categoryId: cat, categoryName: 'کرایهٔ دکان', amount, type: 'business' })
    // last year (10 Mar 2026 = 19 Hoot 1404): not in «امسال» — 5 pairs, profit 10,000
    await ops.addSale({ date: day(2026, 2, 10), saleType: 'retail', lines: line(5), total: 15000, paid: 15000 })
    // earlier this year (10 Aug 2026 = 19 Asad 1405): 10 pairs × 2,000 = 20,000 profit, rent 3,000
    await ops.addSale({ date: day(2026, 7, 10), saleType: 'retail', lines: line(10), total: 30000, paid: 30000 })
    await expense(day(2026, 7, 11), 3000)
    // this month (25 Sep 2026 = 3 Mizan): 2 pairs × 2,000 = 4,000 profit, rent 9,000 → month −5,000
    await ops.addSale({ date: day(2026, 8, 25), saleType: 'retail', lines: line(2), total: 6000, paid: 6000 })
    await expense(day(2026, 8, 26), 9000)
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()

  // year: profit 20,000 + 4,000 = 24,000; expenses 3,000 + 9,000 = 12,000; net +12,000 (last year's sale excluded)
  const hero = page.getByRole('region', { name: 'سرخط امروز' })
  const year = hero.getByRole('button', { name: /^مفاد خالص امسال .*۱۲٬۰۰۰ ؋ — از کجا آمد$/ })
  await year.waitFor()
  const yearText = await text(year)
  assert.match(yearText, /▲ ۱۲٬۰۰۰ ؋ مفاد/)
  assert.match(yearText, /مفاد فروش امسال ۲۴٬۰۰۰ ؋/)
  assert.match(yearText, /مصرف امسال ۱۲٬۰۰۰ ؋/)
  assert.match(await text(hero), /امسال تا امروز · از ۱ حمل/)

  // month: 4,000 − 9,000 = −5,000, still said plainly, below the year
  const month = hero.getByRole('button', { name: /^مفاد خالص این ماه .*−?۵٬۰۰۰ ؋ — از کجا آمد$/ })
  const monthText = await text(month)
  assert.match(monthText, /این ماه تا امروز ▼ ۵٬۰۰۰ ؋ زیان/)
  assert.match(monthText, /مفاد فروش ۴٬۰۰۰ ؋ · مصرف ۹٬۰۰۰ ؋/)
  const [yBox, mBox] = [await year.boundingBox(), await month.boundingBox()]
  assert.ok(yBox.y < mBox.y, 'the year comes first')

  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async (m) => (await import('/src/lib/displayMode.ts')).setDisplayMode(m), mode)
    await page.waitForTimeout(450)
    assert.deepEqual(await contrastFailures(page, 'main'), [], `year card contrast in ${mode} mode`)
  }
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('light'))

  // tap the year → the report opens on «امسال» with the same net; back returns home
  await year.click()
  await page.getByRole('heading', { name: 'راپورها' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'امسال', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.match(await text(page.getByRole('region', { name: 'مفاد', exact: true })), /مفاد خالص ۱۲٬۰۰۰ ؋/)
  await page.getByRole('button', { name: 'برگشت', exact: true }).click()
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()

  // tap the month → still the month explanation
  await hero.getByRole('button', { name: /^مفاد خالص این ماه/ }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')

  // the report from «بیشتر» still opens on «این ماه»
  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'راپورها' }).first().click()
  await page.getByRole('heading', { name: 'راپورها' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'این ماه', exact: true }).getAttribute('aria-pressed'), 'true')

  assert.deepEqual(errors, [])
  console.log('PASS home year: year (1 Hamal → today) is the headline and in profit while the month is a loss, last year excluded, report «امسال» agrees, month still explains, all modes readable')
} finally {
  await app.close()
}
