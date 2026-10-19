// «مصرف دکان» در میز فروش: نجار میز دکان را ساخت و بابت مزدش کفش برد. کفش از گدام، مصرف در مصارف، صندوق دست‌نخورده.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.setViewportSize({ width: 360, height: 800 })
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { addVariant } = await import('/src/lib/ops.ts')
    await db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount: 5000, note: 'سرمایه' })
    const productId = await db.products.add({ name: 'فضل سلطان چرمی', createdAt: Date.now() })
    await addVariant({ productId, size: '41', color: 'سیاه', purchasePrice: 1500, retailPrice: 2100, wholesalePrice: 2000, lowStock: 1, stockQty: 3 }, 'فضل سلطان چرمی')
  })
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('button', { name: /فضل سلطان چرمی 41 سیاه/ }).click()
  await page.getByRole('button', { name: 'ادامه به پرداخت' }).click()
  const methods = page.getByRole('group', { name: 'روش پرداخت' })
  await methods.getByRole('button', { name: 'مصرف دکان' }).click()
  const form = page.getByRole('group', { name: 'کفش بابت مزد کار' })
  await form.waitFor()
  assert.equal(await page.getByLabel('مبلغ دریافتی (نقد)').count(), 0, 'no cash box in expense mode')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), 'four payment buttons fit a small phone')

  // بی نام شخص رد می‌شود و چیزی ثبت نمی‌شود
  await form.getByLabel('بابت چه مصرفی؟').fill('دیکور دکان')
  await page.getByRole('button', { name: 'ثبت مصرف با کفش' }).click()
  await page.getByText('نام کسی که کفش را بابت کارش برد بنویسید').waitFor()
  await form.getByLabel('کفش را چه کسی بابت کارش برد؟').fill('استاد کریم نجار')
  await form.getByLabel('یادداشت (اختیاری)').fill('جور کردن میز دکان')
  await page.screenshot({ path: process.env.SHOT ?? '/dev/null' }).catch(() => {})
  await page.getByRole('button', { name: 'ثبت مصرف با کفش' }).click()
  await page.waitForFunction(async () => (await (await import('/src/db.ts')).db.expenses.count()) === 1)

  const r = await page.evaluate(async () => {
    const { db, saleCashPaid, saleCreditAmount } = await import('/src/db.ts')
    const { runIntegrityCheck } = await import('/src/lib/integrity.ts')
    const expense = (await db.expenses.toArray())[0]
    const sale = (await db.sales.toArray())[0]
    const person = await db.suppliers.where('name').equals('استاد کریم نجار').first()
    const cash = (await db.cashMovements.toArray()).reduce((s, m) => s + m.amount, 0)
    return {
      expense: [expense.amount, expense.cashPaid, expense.categoryName, expense.note],
      sale: [sale.total, saleCashPaid(sale), saleCreditAmount(sale)],
      stock: (await db.variants.toArray())[0].stockQty,
      person: [person?.kind, person?.balance],
      cash,
      mismatches: (await runIntegrityCheck()).mismatches.length
    }
  })
  assert.deepEqual(r.expense, [2100, 0, 'دیکور دکان', 'جور کردن میز دکان'])
  assert.deepEqual(r.sale, [2100, 0, 0])
  assert.equal(r.stock, 2)
  assert.deepEqual(r.person, ['expenseCreditor', 0])
  assert.equal(r.cash, 5000, 'the till did not move')
  assert.equal(r.mismatches, 0)
  assert.deepEqual(errors, [])
  console.log('PASS: «مصرف دکان» gives shoes for a job — expense recorded, stock down, till untouched, person settled')
} finally {
  await app.close()
}
