// «ثبت کفش بابت تسویه» وقتی ما به قرض‌دهنده قرض نداریم: دکمه نباید بی‌صدا بماند — دلیل باید کنار دکمه دیده شود.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const { page, close } = await localApp()
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    // او ۱,۰۰۰ به ما بدهکار است (balance منفی = طلب ما از او)
    await db.suppliers.add({ name: 'اجمل', kind: 'lender', balance: -1000, createdAt: Date.now() })
    const productId = await db.products.add({ name: 'Go pu', createdAt: Date.now() })
    await db.variants.add({ productId, size: '44', color: 'مکس', stockQty: 3, purchasePrice: 900, retailPrice: 1500, wholesalePrice: 1300, sku: 'T-44' })
  })
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.locator('summary', { hasText: 'افزودن و مدیریت حساب‌ها' }).click()
  await page.getByRole('button', { name: 'تأمین‌کنندگان', exact: true }).click()
  await page.getByRole('group', { name: 'نوع حساب خرید' }).getByRole('button', { name: 'قرض‌دهنده‌ها' }).click()
  await page.getByRole('region', { name: 'فهرست قرض‌دهندگان' }).getByRole('button', { name: /اجمل/ }).click()
  await page.getByRole('button', { name: 'کفش دادیم', exact: true }).click()
  const picker = page.locator('select').filter({ hasText: 'انتخاب کنید...' })
  await picker.selectOption(await picker.locator('option', { hasText: 'Go pu' }).getAttribute('value'))
  await page.getByPlaceholder('قیمت توافق‌شده').fill('1500')
  await page.getByRole('button', { name: '＋ افزودن به سند' }).click()

  const submit = page.getByRole('button', { name: 'ثبت کفش بابت تسویه' })
  assert.equal(await submit.isDisabled(), true, 'settlement over debt is disabled')
  const reason = page.getByText('ما به او قرض نداریم؛ برعکس او')
  await reason.waitFor()
  assert.ok(await reason.isVisible(), 'reason shown next to the button')

  // با «کفش قرضی» همان سند ثبت می‌شود
  await page.locator('select').filter({ hasText: 'کفش بابت تسویهٔ قرض ما' }).selectOption('goodsCredit')
  await page.getByRole('button', { name: 'ثبت کفش قرضی' }).click()
  const balance = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    return (await db.suppliers.filter((s) => s.name === 'اجمل').first()).balance
  })
  assert.equal(balance, -2500)
  console.log('lender goods settlement e2e: ok')
} finally {
  await close()
}
