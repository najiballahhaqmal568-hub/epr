// Actual App: hardware back closes the top modal, then follows tab history.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const heading = name => page.getByRole('heading', { name, exact: true }).waitFor()
const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true })
try {
  await heading('خانه')
  await nav('بیشتر').click()
  await page.getByRole('button', { name: /^مصارف و صندوق/ }).click()
  await heading('پول و مصارف')
  await page.goBack(); await heading('بیشتر')
  await page.goBack(); await heading('خانه')
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const productId = await db.products.add({ name: 'آزمایشی', createdAt: Date.now() })
    await db.variants.add({ productId, size: '42', color: 'سیاه', stockQty: 10, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, lowStock: 2 })
  })
  await nav('فروش').click(); await heading('میز فروش')
  // the size window is gone (sizes sit on the card); a sale's receipt is the window we close with back
  await page.getByRole('button', { name: /آزمایشی 42 سیاه/ }).click()
  await page.getByRole('button', { name: 'نقد', exact: true }).click()
  await page.getByRole('button', { name: 'رسید', exact: true }).click()
  await page.locator('dialog[open]').waitFor()
  await page.goBack()
  await page.locator('dialog[open]').waitFor({ state: 'hidden' })
  await heading('میز فروش')
  assert.equal(await nav('فروش').getAttribute('aria-current'), 'page')
  await page.goBack(); await heading('خانه')
  console.log('PASS hardware back: More → expenses → More → Home; receipt window closes without leaving Sales; next back returns Home')
} finally { await app.close() }
