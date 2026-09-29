// میز فروش نو: سایزها روی کارت باز است؛ «نقد» فروش را با دو لمس ثبت می‌کند؛ «قرض» مشتری می‌خواهد.
// Synthetic data only; every external request is blocked by localApp.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const state = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts')
  return {
    stock: (await db.variants.toArray()).map((v) => v.stockQty),
    cash: (await db.cashMovements.toArray()).filter((x) => !x.deleted).reduce((s, x) => s + x.amount, 0),
    sales: (await db.sales.toArray()).filter((x) => !x.deleted).map((s) => ({ total: s.total, paid: s.paid, customer: s.customerName ?? null })),
    debt: (await db.customers.toArray()).map((c) => c.balance)
  }
})

try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    for (const [size, color, qty] of [['41', 'سیاه', 5], ['42', 'سیاه', 5], ['42', 'قهوه‌ای', 2]]) {
      const id = await db.variants.add({ productId, size, color, stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
      await setOpeningStock(id, qty)
    }
    await db.customers.add({ name: 'مشتری آزمایشی', type: 'retail', balance: 0, createdAt: Date.now() })
  })
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  const card = page.locator('.sale-product-card').filter({ hasText: 'کوهستان' })
  await card.getByRole('group', { name: 'رنگ سیاه' }).waitFor()
  const cash = page.getByRole('button', { name: 'نقد', exact: true })
  assert.equal(await cash.count(), 0, 'the cash button is hidden while the cart is empty')

  // 1) Cash sale = two touches: a size, then «نقد». No payment page, no customer, nothing typed.
  await card.getByRole('button', { name: /42 سیاه/ }).click()
  await card.getByRole('button', { name: /42 سیاه/ }).click()
  await card.getByRole('button', { name: /42 قهوه‌ای/ }).click()
  await cash.click()
  await page.getByText(/فروش ثبت شد/).first().waitFor()
  assert.deepEqual(await state(), { stock: [5, 3, 1], cash: 2700, sales: [{ total: 2700, paid: 2700, customer: null }], debt: [0] })

  // 2) A sold-out size cannot be tapped (1 left of 42 قهوه‌ای → after one tap it is finished).
  await card.getByRole('button', { name: /42 قهوه‌ای/ }).click()
  await card.getByRole('button', { name: /42 قهوه‌ای — ختم شده/ }).waitFor()
  assert.equal(await card.getByRole('button', { name: /42 قهوه‌ای — ختم شده/ }).isDisabled(), true)
  await page.getByRole('textbox', { name: 'تعداد کوهستان 42', exact: true }).waitFor()

  // 3) «قرض» opens the payment page with nothing paid; without a customer the sale is refused, and no money moved.
  await page.getByRole('button', { name: 'قرض', exact: true }).click()
  await page.getByRole('button', { name: 'ثبت فروش', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'باید مشتری' }).waitFor()
  assert.equal((await state()).sales.length, 1, 'a credit sale without a customer is not written')
  await page.getByPlaceholder('جستجوی نام یا تلفن مشتری...').fill('آزمایشی')
  await page.getByRole('button', { name: 'مشتری آزمایشی', exact: true }).click()
  await page.getByRole('button', { name: 'ثبت فروش', exact: true }).click()
  await page.getByText(/فروش ثبت شد/).first().waitFor()
  assert.deepEqual(await state(), { stock: [5, 3, 0], cash: 2700, sales: [{ total: 2700, paid: 2700, customer: null }, { total: 900, paid: 0, customer: 'مشتری آزمایشی' }], debt: [900] })

  // 4) «ادامه به پرداخت» is still the way to a discount: it starts as cash, not as the earlier credit choice.
  await card.getByRole('button', { name: /41 سیاه/ }).click()
  await page.getByRole('button', { name: 'ادامه به پرداخت', exact: true }).click()
  assert.equal(await page.getByLabel('مبلغ دریافتی (نقد)', { exact: true }).inputValue(), '900')

  assert.deepEqual(errors, [])
  console.log('PASS quick sale: sizes open on the card, cash in two touches, credit needs a customer, sold-out tile off, details path kept')
} finally {
  await app.close()
}
