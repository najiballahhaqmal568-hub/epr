// Actual App, disposable local database and blocked external transport.
// Preserve carton-wizard -> ordinary form values and resulting stock/value.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.getByRole('navigation').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button', { name: /^گدام و خرید/ }).click()
  await page.getByRole('button', { name: /بوت جدید/ }).click()
  await page.getByRole('heading', { name: /جنس کارتنی جدید/ }).waitFor()
  await page.locator('input[placeholder="مثلاً اسکچرز"]').fill('چرمی شهرت')
  await page.locator('input[placeholder="خاکی"]').fill('سرخ')
  const nums = page.locator('dialog input[inputmode="numeric"]')
  await nums.nth(0).fill('750')
  await nums.nth(1).fill('1200')
  await nums.nth(2).fill('1000')
  await page.locator('.grid input:not([inputmode="numeric"])').first().fill('البشیر')
  await page.getByRole('button', { name: /ثبت عادی بدون کارتن/ }).click()
  await page.locator('input[placeholder="مثلاً بوت چرمی مردانه"]').waitFor()
  assert.equal(await page.locator('input[placeholder="مثلاً بوت چرمی مردانه"]').inputValue(), 'چرمی شهرت')
  assert.equal(await nums.nth(0).inputValue(), '750')
  assert.equal(await nums.nth(2).inputValue(), '1200')
  assert.equal(await nums.nth(3).inputValue(), '1000')
  assert.equal(await page.locator('input[placeholder="سیاه"]').first().inputValue(), 'سرخ')
  await page.locator('input[placeholder="۴۲"]').first().fill('38')
  await nums.nth(1).fill('6')
  await page.getByRole('button', { name: 'ذخیره', exact: true }).click()
  await page.waitForFunction(async () => (await (await import('/src/db.ts')).db.products.count()) === 1)
  const result = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    return { product: (await db.products.toArray())[0], variant: (await db.variants.toArray())[0] }
  })
  assert.equal(result.product.name, 'چرمی شهرت')
  assert.equal(result.product.brand, 'البشیر')
  assert.equal(result.variant.color, 'سرخ')
  assert.equal(result.variant.stockQty, 6)
  assert.equal(result.variant.purchasePrice, 750)
  assert.equal(result.variant.retailPrice, 1200)
  assert.equal(result.variant.wholesalePrice, 1000)
  await page.getByText(/۶ جوړه/).first().waitFor()
  await page.getByText(/ارزش: ۴٬۵۰۰/).first().waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS: new navigation -> carton wizard -> ordinary form preserves name, brand, color and all prices; saved six pairs worth 4,500')
} finally { await app.close() }
