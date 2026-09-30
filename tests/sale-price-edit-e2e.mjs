// On a phone the cart sits below every product card, so the price must also be changeable on the payment
// screen: a 200 shoe sold for 170 records 170 in the till, and the loss warning follows the new price.
// Actual App, disposable IndexedDB, synthetic data; external requests blocked by localApp.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock } = await import('/src/lib/ops.ts')
    for (const [name, size] of [['کوهستان', '41'], ['اسکیچرز', '42'], ['سودا', '40']]) {
      const productId = await db.products.add({ name, createdAt: Date.now() })
      const v = await db.variants.add({ productId, size, color: 'سیاه', stockQty: 0, purchasePrice: 100, retailPrice: 200, wholesalePrice: 180 })
      await setOpeningStock(v, 5)
      if (name === 'سودا') window.variantId = v
    }
    window.result = async () => {
      const sales = (await db.sales.toArray()).filter((s) => !s.deleted)
      return { sales: sales.map((s) => [s.total, s.paid, s.lines[0].unitPrice]), cash: (await db.cashMovements.toArray()).filter((x) => !x.deleted).reduce((sum, x) => sum + x.amount, 0) }
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('button', { name: /سودا 40 سیاه/ }).click()
  await page.getByRole('button', { name: 'ادامه به پرداخت', exact: true }).click()

  // the owner's case: on the payment screen, change 200 to 170 by finger
  const price = page.getByLabel('قیمت فی جوړه سودا 40', { exact: true })
  assert.equal(await price.isVisible(), true, 'the price is on the payment screen')
  const box = await price.boundingBox()
  assert.ok(box.y + box.height < 844 - 90, `price box is on the first screen, above the nav (y=${box.y})`)
  await price.click()
  await price.pressSequentially('170')
  assert.equal(await price.inputValue(), '170', 'tap selects the old price, typing replaces it')
  assert.match(await page.locator('.sale-payment-summary').innerText(), /۱۷۰ ؋/)
  assert.equal(await page.getByLabel('مبلغ دریافتی (نقد)', { exact: true }).inputValue(), '170', 'cash follows the new total')

  // under cost shows the warning here too, and clears when fixed
  await price.fill('90')
  await page.getByRole('alert').filter({ hasText: 'زیر قیمت خرید' }).waitFor()
  await price.fill('170')
  assert.equal(await page.getByRole('alert').filter({ hasText: 'زیر قیمت خرید' }).count(), 0)

  // back to the cart: the same price is there
  await page.getByRole('button', { name: 'بازگشت به انتخاب', exact: true }).click()
  assert.equal(await page.getByLabel('قیمت سودا 40', { exact: true }).inputValue(), '170')
  await page.getByRole('button', { name: 'ادامه به پرداخت', exact: true }).click()

  await page.getByRole('button', { name: 'ثبت فروش', exact: true }).click()
  await page.getByText(/فروش ثبت شد/).first().waitFor()
  assert.deepEqual(await page.evaluate(() => window.result()), { sales: [[170, 170, 170]], cash: 170 })
  assert.deepEqual(errors, [])
  console.log('PASS sale price edit: 200 → 170 on the payment screen, cash follows, loss warning, cart agrees, books say 170')
} finally {
  await app.close()
}
