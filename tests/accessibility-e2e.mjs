// Every tappable thing is finger-sized (≥ 40px) and has a name; every image has alt text; at the largest
// text size on a 320px phone no main screen scrolls sideways. Actual App, disposable IndexedDB.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale, addOpeningDebt } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(v, 3)
    const c = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('customer', c, 'احمد', 2500, 'قرض قبلی')
    await addSale({ date: Date.now(), customerId: c, customerName: 'احمد', saleType: 'retail', lines: [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 1, unitPrice: 900 }], total: 900, paid: 400 })
  })
  const nav = n => page.locator('nav').getByRole('button', { name: n, exact: true }).click()
  const more = async t => { await nav('بیشتر'); await page.getByRole('button').filter({ hasText: t }).first().click() }
  const screens = [
    ['home', () => nav('خانه')], ['sale', () => nav('فروش')], ['accounts', () => nav('حساب‌ها')], ['more', () => nav('بیشتر')],
    ['inventory', () => more('گدام و خرید')], ['expenses', () => more('مصارف و صندوق')], ['reports', () => more('راپورها')], ['settings', () => more('تنظیمات اپ')],
    ['customers', async () => { await nav('حساب‌ها'); await page.getByText('افزودن و مدیریت حساب‌ها').click(); await page.getByRole('button', { name: 'مشتریان', exact: true }).click() }]
  ]
  const problems = () => page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], summary')) {
      const r = el.getBoundingClientRect(); if (!r.width || !r.height || getComputedStyle(el).visibility === 'hidden') continue
      const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || el.labels?.[0]?.textContent || '').trim()
      if (r.height < 40 || r.width < 40) out.push(`small ${Math.round(r.width)}x${Math.round(r.height)} «${name.slice(0, 30)}»`)
      if (!name) out.push(`no name ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 30)}`)
    }
    for (const img of document.querySelectorAll('img')) if (!img.hasAttribute('alt')) out.push('image without alt')
    return out
  })
  const report = []
  for (const [name, open] of screens) {
    await open(); await page.waitForTimeout(350)
    const found = await problems()
    if (found.length) report.push(`${name}: ${[...new Set(found)].join(' | ')}`)
  }
  // Largest text on the smallest phone: nothing may scroll sideways.
  await page.setViewportSize({ width: 320, height: 720 })
  await page.evaluate(async () => (await import('/src/lib/fontScale.ts')).setFontScale('xl'))
  for (const [name, open] of screens) {
    await open(); await page.waitForTimeout(350)
    const wide = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth)
    if (wide > 1) report.push(`${name} at 320px/xl scrolls sideways by ${wide}px`)
  }
  assert.equal(report.length, 0, report.join('\n'))
  assert.deepEqual(errors, [])
  console.log(`PASS accessibility: ${screens.length} screens — finger-sized named targets, image alt text, no sideways scroll at 320px with the largest text`)
} finally {
  await app.close()
}
