// The year figure is  دارایی + برداشت‌های سال − سرمایه‌ها , and the capital was fixed on the day the year started.
// Moving the start date afterwards drops (or adds) withdrawals from the sum while the capital stays, so the year
// would show a profit or loss that never happened — and «بستن سال» takes that number. The date is a guarded change.
// Actual App, disposable IndexedDB, synthetic data; external requests blocked by localApp.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ')
const startValue = () => page.evaluate(async () => Number((await (await import('/src/db.ts')).db.settings.get('partnershipStart'))?.value ?? 0))

try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const { startYear } = await import('/src/lib/partnership.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: 1 })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await ops.setOpeningStock(v, 100) // 50,000
    await db.cashMovements.add({ date: Date.now(), type: 'openingSet', amount: 50000, note: 'اول' }) // + 50,000 = 100,000
    await startYear('مالک') // capital = 100,000, share 100%, year starts now
    await new Promise((r) => setTimeout(r, 20))
    await ops.addPartnerWithdrawal('مالک', 1000, 'برداشت آزمایشی') // assets 99,000, draws 1,000 → profit 0
  })
  await page.getByRole('navigation').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'راپورها' }).first().click()
  await page.getByRole('heading', { name: 'راپورها' }).waitFor()
  await page.getByRole('button', { name: /بازکردن/ }).first().click() // the partners card lives in the details
  const openYear = async () => {
    await page.getByRole('button', { name: /حساب سال شراکت/ }).click()
    return page.locator('dialog[open]')
  }
  const yearRow = async () => {
    const sheet = await openYear()
    const t = await text(sheet)
    await sheet.getByRole('button', { name: /بستن|✕|انصراف/ }).first().click().catch(() => page.keyboard.press('Escape'))
    return t
  }

  assert.match(await yearRow(), /فایده\/نقص خالص سال ۰ ؋/, 'the year starts at exactly 0, a withdrawal does not change it')
  const before = await startValue()

  // move the start date to tomorrow: the 1,000 withdrawal now falls before the start
  const tomorrow = await page.evaluate(() => { const d = new Date(Date.now() + 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` })
  await page.locator('input[type="date"]').fill(tomorrow)
  await page.waitForTimeout(400)
  const after = await yearRow()
  assert.match(after, /فایده\/نقص خالص سال ۰ ؋/, `the year figure did not move: ${after.match(/فایده\/نقص خالص سال [^ ]+ ؋/)?.[0]}`)
  assert.equal(await startValue(), before, 'the start date was refused, not silently accepted')
  await page.locator('[role="alert"]').filter({ hasText: /برداشت|تاریخ/ }).first().waitFor({ timeout: 4000 })

  assert.deepEqual(errors, [])
  console.log('PASS partnership start date: moving it across a withdrawal is refused; the year stays at its true figure')
} finally {
  await app.close()
}
