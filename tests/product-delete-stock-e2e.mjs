// Deleting a product (or one size) that still has stock must not make its value vanish from the books
// without a document. Actual App, disposable IndexedDB, synthetic data; external requests blocked by localApp.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => void dialog.accept())
const stockWorth = () => page.evaluate(async () => (await import('/src/lib/networth.ts')).netWorth().then((n) => n.stock))
const live = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts')
  return { products: (await db.products.toArray()).filter((p) => !p.deleted).length, variants: (await db.variants.toArray()).filter((v) => !v.deleted).length }
})

try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: 1 })
    const a = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    const b = await db.variants.add({ productId, size: '41', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(a, 10)
    await setOpeningStock(b, 0)
    const p2 = await db.products.add({ name: 'نمونهٔ بی‌موجودی', createdAt: 1 })
    await db.variants.add({ productId: p2, size: '42', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
  })
  assert.equal(await stockWorth(), 5000, '10 pairs × 500')
  const list = page.getByRole('region', { name: 'فهرست موجودی' })
  // the list is rebuilt each time: no row is left open from the step before, so the edit button is the right product's
  const open = async (name) => {
    await page.getByRole('navigation').getByRole('button', { name: 'خانه', exact: true }).click() // leaving the tab rebuilds the list
    await page.getByRole('navigation').getByRole('button', { name: 'گدام', exact: true }).click()
    await list.getByRole('button', { name: new RegExp(name) }).first().click()
    await list.getByRole('button', { name: 'ویرایش مشخصات جنس' }).click()
    await page.getByRole('heading', { name: 'ویرایش بوت' }).waitFor()
  }
  const names = () => page.evaluate(async () => (await (await import('/src/db.ts')).db.products.toArray()).filter((p) => !p.deleted).map((p) => p.name).sort())

  // 1) delete the whole product that holds 10 pairs → refused, value stays, product stays
  await open('کوهستان')
  await page.getByRole('button', { name: 'حذف بوت', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: /موجودی|گدام/ }).waitFor({ timeout: 4000 })
  assert.deepEqual(await live(), { products: 2, variants: 3 }, 'nothing was deleted')
  assert.equal(await stockWorth(), 5000, 'the 5,000 of stock is still counted')
  await page.getByRole('button', { name: 'بستن' }).first().click()

  // 2) drop the size that holds the stock from the form → save is refused, size stays
  await open('کوهستان')
  await page.getByRole('button', { name: 'حذف این سایز' }).first().click()
  await page.getByRole('button', { name: /^ذخیره/ }).click()
  await page.getByRole('alert').filter({ hasText: /موجودی|گدام/ }).waitFor({ timeout: 4000 })
  assert.equal((await live()).variants, 3, 'the size with stock was not deleted')
  assert.equal(await stockWorth(), 5000)
  await page.getByRole('button', { name: 'بستن' }).first().click()

  // 3) an empty size / product can still be removed (nothing to lose)
  await open('نمونهٔ بی‌موجودی')
  await page.getByRole('button', { name: 'حذف بوت', exact: true }).click()
  for (let i = 0; i < 40 && (await names()).length !== 1; i++) await page.waitForTimeout(100)
  assert.deepEqual(await names(), ['کوهستان'], 'the empty one went, the one with stock stayed')
  assert.equal(await stockWorth(), 5000)

  assert.deepEqual(errors, [])
  console.log('PASS product delete: stock-holding product/size refused, empty one removed, stock value unchanged')
} finally {
  await app.close()
}
