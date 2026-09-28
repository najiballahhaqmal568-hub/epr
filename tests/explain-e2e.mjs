// «این عدد از کجا آمد» on Home: every tile and the sales card open a breakdown whose total equals the tile.
// Actual App, disposable IndexedDB, external requests blocked by localApp.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/explain-screenshots'
mkdirSync(shots, { recursive: true })
const digits = text => Number(text.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^\d-]/g, ''))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale, addOpeningDebt } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const v1 = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(v1, 20)
    const other = await db.products.add({ name: 'بامیان', createdAt: Date.now() })
    const v2 = await db.variants.add({ productId: other, size: '42', color: 'قهوه‌ای', stockQty: 0, purchasePrice: 1000, retailPrice: 1500, wholesalePrice: 1400 })
    await setOpeningStock(v2, 4)
    const c = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('customer', c, 'احمد', 2500, 'قرض قبلی')
    const s = await db.suppliers.add({ name: 'تأمین‌کننده', kind: 'supplier', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('supplier', s, 'تأمین‌کننده', 7000, 'قرض قبلی')
    const lender = await db.suppliers.add({ name: 'حاجی', kind: 'lender', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('supplier', lender, 'حاجی', 30000, 'قرض')
    await db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount: 5000, box: 'خانه', note: 'آزمایش' })
    // Two sales today: one cash, one partly on credit with a discount.
    await addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: v1, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 2, unitPrice: 900 }], total: 1800, paid: 1800 })
    await addSale({ date: Date.now(), customerId: c, customerName: 'احمد', saleType: 'retail', lines: [{ variantId: v2, productName: 'بامیان', size: '42', color: 'قهوه‌ای', qty: 1, unitPrice: 1500 }], total: 1400, paid: 400, discount: 100 })
  })
  await page.getByRole('heading', { name: 'خانه' }).waitFor()

  // 1) Today's sales: total and profit steps. Profit = (1,800 + 1,500) − (1,000 + 1,000) − 100 = 1,200.
  const card = page.getByRole('button', { name: /فروش امروز .* از کجا آمد/ })
  assert.match(await card.innerText(), /۳٬۲۰۰ ؋[\s\S]*مفاد: ۱٬۲۰۰ ؋/)
  await card.click()
  const sales = page.getByRole('dialog', { name: 'فروش امروز از کجا آمد' })
  assert.match(await sales.innerText(), /مجموع: ۳٬۲۰۰ ؋ — ۲ فروش/)
  assert.match(await sales.innerText(), /قرض ۱٬۰۰۰ ؋/)
  const profit = await sales.getByRole('region', { name: 'مفاد امروز' }).innerText()
  assert.match(profit, /قیمت فروش اجناس\s*۳٬۳۰۰ ؋[\s\S]*−۲٬۰۰۰ ؋[\s\S]*تخفیف\s*−۱۰۰ ؋[\s\S]*مفاد\s*۱٬۲۰۰ ؋/)
  await page.screenshot({ path: `${shots}/sales-390.png`, fullPage: true })
  await page.keyboard.press('Escape')

  // 2) Every account tile: breakdown total equals the tile.
  for (const [tileLabel, title, extra] of [
    ['طلب از مشتریان', 'طلب از مشتریان از کجا آمد', /احمد[\s\S]*۳٬۵۰۰ ؋/],
    ['صندوق', 'صندوق از کجا آمد', /خانه[\s\S]*۵٬۰۰۰ ؋/],
    ['موجودی گدام', 'موجودی گدام از کجا آمد', /کوهستان[\s\S]*۱۸ جوړه[\s\S]*بامیان[\s\S]*۳ جوړه/],
    ['قرض ما', 'قرض ما از کجا آمد', /قرض از اشخاص: ۳۰٬۰۰۰ ؋[\s\S]*حاجی/]
  ]) {
    const tile = page.getByRole('button').filter({ hasText: tileLabel }).last()
    const tileNumber = digits((await tile.innerText()).replace(tileLabel, ''))
    await tile.click()
    const sheet = page.getByRole('dialog', { name: title })
    await sheet.waitFor()
    const text = await sheet.innerText()
    const total = digits(text.match(/مجموع[^:]*: ([^\n—·]+)/)[1])
    assert.equal(total, tileNumber, `${tileLabel}: breakdown total equals the tile`)
    assert.match(text, extra)
    await page.screenshot({ path: `${shots}/${['receivables', 'cash', 'stock', 'payables'][['طلب از مشتریان', 'صندوق', 'موجودی گدام', 'قرض ما'].indexOf(tileLabel)]}-390.png`, fullPage: true })
    await page.keyboard.press('Escape')
    await sheet.waitFor({ state: 'detached' })
  }

  // 3) The action button still reaches the full page.
  await page.getByRole('button').filter({ hasText: 'موجودی گدام' }).last().click()
  await page.getByRole('button', { name: 'دیدن گدام' }).click()
  await page.getByRole('heading', { name: 'گدام و خرید' }).waitFor()

  // 4) Readable at 320px with large text.
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => document.documentElement.style.fontSize = '20px')
  await page.getByRole('button', { name: /فروش امروز .* از کجا آمد/ }).click()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('dialog[open] *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) }).length), 0, 'fits 320px')
  assert.deepEqual(errors, [])
  console.log('PASS explain: sales card with profit steps, four tiles total = tile, lenders shown apart, action reaches page, 320px')
} finally {
  await app.close()
}
