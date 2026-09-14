import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { localApp, businessSnapshot } from './local-app.mjs'

// Real App: catches inaccessible mode state, misleading lower-bound controls,
// clipped product names/amounts and accidental business writes while selecting.
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', e => errors.push(e.message))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const name = 'بوت چرمی مردانه کوهستان با نام بسیار طولانی آزمایشی'
    const productId = await db.products.add({ name, createdAt: 1 })
    await db.variants.add({ productId, size: '42', color: 'سیاه', stockQty: 20, purchasePrice: 500, retailPrice: 123456789, wholesalePrice: 123456000 })
  })
  const before = await businessSnapshot(page)
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  const retail = page.getByRole('button', { name: 'پرچون', exact: true })
  await retail.waitFor()
  assert.equal(await retail.getAttribute('aria-pressed'), 'true', 'selected sale mode is accessible')
  await page.locator('.sale-product-card').first().click()
  await page.getByRole('dialog').getByRole('button', { name: /42 سیاه/ }).click()
  const minus = page.getByRole('button', { name: /^کاهش تعداد/ })
  assert.equal(await minus.isDisabled(), true, 'minimum quantity has a disabled decrement')
  await page.getByRole('button', { name: /^افزایش تعداد/ }).click()
  assert.equal(await minus.isEnabled(), true)
  await minus.click()
  const dir = '.superpowers/sdd/plan/task-3-screenshots'
  await mkdir(dir, { recursive: true })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const scale of [16, 20]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px` }, scale)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, `overflow ${width}/${scale}`)
      assert.equal(await page.locator('.sale-product-card p').first().evaluate(el => el.scrollWidth <= el.clientWidth && getComputedStyle(el).textOverflow !== 'ellipsis'), true, 'full model name remains readable')
      if ([390, 1440].includes(width)) await page.screenshot({ path: `${dir}/selection-${width}-${scale}.png`, fullPage: true })
    }
  }
  assert.deepEqual(await businessSnapshot(page), before, 'selecting and editing cart never writes business records')
  await page.reload()
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('textbox', { name: /^تعداد بوت/ }).waitFor()
  assert.equal(await page.getByRole('textbox', { name: /^تعداد بوت/ }).inputValue(), '1', 'working cart survives reload')
  assert.deepEqual(errors, [])
  console.log('PASS sales selection: mode state, minimum guard, quantity changes, responsive/font-scaled populated cart, durable draft, no business writes')
} finally { await app.close() }
