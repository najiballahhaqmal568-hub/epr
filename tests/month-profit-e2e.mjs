// Home «مفاد خالص این ماه»: same number as Reports, steps add up, expense alert red/yellow, hidden from staff.
// Actual App, disposable IndexedDB, external requests blocked by localApp.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/profit-screenshots'
mkdirSync(shots, { recursive: true })
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale } = await import('/src/lib/ops.ts')
    const { startOfMonth } = await import('/src/lib/format.ts')
    const monthStart = startOfMonth(), prevStart = startOfMonth(monthStart - 1)
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    window.variantId = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(window.variantId, 100)
    const catId = await db.expenseCategories.add({ name: 'ترانسپورت' })
    window.addExpense = async (date, amount) => db.expenses.add({ date, categoryId: catId, categoryName: 'ترانسپورت', amount, type: 'business' })
    window.sell = async (qty, unitPrice) => addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: window.variantId, productName: 'کوهستان', size: '40', color: 'سیاه', qty, unitPrice }], total: qty * unitPrice, paid: qty * unitPrice })
    // This month: profit 2 × (900 − 500) = 800; expenses 3,000 → net −2,200. Last month so far: expense 500 → net −500.
    await window.sell(2, 900)
    await window.addExpense(Date.now(), 3000)
    await window.addExpense(prevStart + 3_600_000, 500)
  })
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  const card = page.getByRole('button', { name: /مفاد خالص این ماه .* از کجا آمد/ })
  assert.match(await card.innerText(), /▼ ۲٬۲۰۰ ؋ زیان[\s\S]*مفاد فروش\s*۸۰۰ ؋[\s\S]*مصرف\s*۳٬۰۰۰ ؋[\s\S]*▼ ۱٬۷۰۰ ؋ کمتر/)
  const alert = page.getByRole('button').filter({ hasText: 'مصرف از مفاد بیشتر شده' })
  assert.match(await alert.innerText(), /ترانسپورت/)
  await page.screenshot({ path: `${shots}/home-danger-390.png`, fullPage: true })

  // Steps in the window add up to the card.
  await card.click()
  const steps = await page.getByRole('region', { name: 'مفاد قدم‌به‌قدم' }).innerText()
  assert.match(steps, /قیمت فروش اجناس\s*۱٬۸۰۰ ؋[\s\S]*−۱٬۰۰۰ ؋[\s\S]*مفاد فروش\s*۸۰۰ ؋[\s\S]*مصارف تجارت\s*−۳٬۰۰۰ ؋[\s\S]*مفاد خالص\s*[\u200e−-]*۲٬۲۰۰ ؋/)
  await page.locator('dialog[open]').getByRole('button', { name: 'راپور کامل' }).click()
  // Reports «این ماه» shows the very same net profit.
  await page.getByRole('heading', { name: 'راپورها' }).waitFor()
  const reportNet = await page.getByText('مفاد خالص', { exact: true }).first().locator('..').innerText()
  assert.match(reportNet, /۲٬۲۰۰ ؋/)

  // A big sale turns the month positive; expenses are still 6× last month → yellow warning.
  await page.evaluate(() => window.sell(20, 1500))
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  // 800 + 20 × 1,000 = 20,800 profit − 3,000 = 17,800; vs −500 → ▲ 18,300.
  assert.match(await card.innerText(), /۱۷٬۸۰۰ ؋[\s\S]*▲ ۱۸٬۳۰۰ ؋ بیشتر/)
  const warn = page.getByRole('button').filter({ hasText: 'مصرف این ماه بالا رفته' })
  assert.match(await warn.innerText(), /۵۰۰٪ بیشتر از همین وقت ماه گذشته/)
  await page.screenshot({ path: `${shots}/home-warning-390.png`, fullPage: true })

  // Staff visibility is covered in navigation-roles-e2e (a real staff session).
  assert.deepEqual(errors, [])
  console.log('PASS month profit: card = reports, steps add up, red then yellow alert, comparison with last month')
} finally {
  await app.close()
}
