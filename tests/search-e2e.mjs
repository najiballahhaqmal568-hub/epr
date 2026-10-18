// جستجوی جنس بدون نام کامل: «go pu»، «gopu»، یک حرف اشتباه — در میز فروش و در گدام. دیتای مصنوعی.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { addVariant } = await import('/src/lib/ops.ts')
    for (const [name, size] of [['Go pu بهاری', '۴۰ تا ۴۵ مکس'], ['فوتبال مردانه', '42'], ['اسکچرز خاکی', '40']]) {
      const productId = await db.products.add({ name, createdAt: Date.now() })
      await addVariant({ productId, size, color: '', purchasePrice: 400, retailPrice: 1200, wholesalePrice: 1100, lowStock: 1, stockQty: 5 }, name)
    }
  })
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  const box = page.getByPlaceholder('نام، سایز، رنگ یا کود...')
  const rows = page.locator('.sale-search-choice')
  for (const [query, want] of [['go pu', 'Go pu بهاری'], ['gopu', 'Go pu بهاری'], ['فوتبل', 'فوتبال مردانه'], ['اسک خاک', 'اسکچرز خاکی']]) {
    await box.fill(query)
    await rows.first().waitFor()
    assert.equal(await rows.count(), 1, `${query}: one result`)
    assert.ok((await rows.first().innerText()).includes(want), `${query} → ${want}`)
  }
  await box.fill('')
  await page.getByRole('navigation').getByRole('button', { name: 'گدام', exact: true }).click()
  const stock = page.getByLabel('جستجوی موجودی')
  await stock.fill('gopu')
  await page.getByText('Go pu بهاری', { exact: false }).first().waitFor()
  assert.equal(await page.getByText('فوتبال مردانه').count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS: search finds a boot from part of its name, any case, no spaces, one typo — sale desk and stock')
} finally {
  await app.close()
}
