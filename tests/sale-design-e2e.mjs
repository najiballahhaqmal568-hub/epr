// Sale screen design: size grid grouped by colour, fly-to-cart, quick cash + money keypad, change is
// never kept in the till, success check, below-cost nudge. Actual App, disposable IndexedDB.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/sale-design-screenshots'
mkdirSync(shots, { recursive: true })
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const add = (size, color, qty) => db.variants.add({ productId, size, color, stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 }).then(async id => { if (qty) await setOpeningStock(id, qty); return id })
    await add('40', 'سیاه', 2); await add('41', 'سیاه', 3); await add('43', 'سیاه', 0); await add('42', 'قهوه‌ای', 1)
    // Record every animated mark the page adds (they remove themselves quickly).
    window.marks = []
    new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => n.className && window.marks.push(String(n.className))))).observe(document.body, { childList: true, subtree: true })
    window.result = async () => ({ cash: (await db.cashMovements.toArray()).filter(x => !x.deleted).reduce((s, x) => s + x.amount, 0), sales: (await db.sales.toArray()).filter(x => !x.deleted).map(s => ({ total: s.total, paid: s.paid })) })
  })
  await page.locator('nav').getByRole('button', { name: 'فروش', exact: true }).click()
  // 1) Sizes sit open on the model card: one row per colour, tiles with what is left; sold-out tile disabled.
  const card = page.locator('.sale-product-card').filter({ hasText: 'کوهستان' })
  const black = card.getByRole('group', { name: 'رنگ سیاه' })
  await black.getByRole('button', { name: /43 سیاه/ }).waitFor() // the card fills in once the stock query answers
  assert.equal(await black.getByRole('button').count(), 3)
  assert.equal(await card.getByRole('group', { name: 'رنگ قهوه‌ای' }).getByRole('button').count(), 1)
  assert.equal(await black.getByRole('button', { name: /43 سیاه — ختم شده/ }).isDisabled(), true)
  assert.match(await card.innerText(), /۹۰۰ ؋/)
  await page.screenshot({ path: `${shots}/size-grid-390.png` })
  await black.getByRole('button', { name: /41 سیاه — ۳ جوړه باقی/ }).click()
  assert.ok(await page.evaluate(() => window.marks.includes('fly-dot')), 'a pill flew to the cart')
  await page.getByRole('textbox', { name: 'تعداد کوهستان 41', exact: true }).waitFor()

  // The tile shows what is already in the cart and what is left.
  await card.getByRole('button', { name: /41 سیاه — ۲ جوړه باقی — ۹۰۰ ؋ — ۱ در سبد/ }).waitFor()

  // 2) Below-cost price: red border and nudge once the field is left.
  const price = page.getByLabel('قیمت کوهستان 41', { exact: true })
  await price.fill('450')
  assert.equal(await price.getAttribute('aria-invalid'), 'true')
  await price.fill('900')
  assert.equal(await price.getAttribute('aria-invalid'), 'false')

  // 3) Payment: quick cash for 900 → پوره 900, 1,000, 2,000. The customer hands over 1,000.
  await page.getByRole('button', { name: 'ادامه به پرداخت', exact: true }).click()
  const quick = page.getByRole('group', { name: 'پول دریافتی آماده' })
  assert.match((await quick.innerText()).replace(/\s+/g, ' '), /پوره ۹۰۰ ؋ ۱٬۰۰۰ ؋ ۲٬۰۰۰ ؋/)
  await quick.getByRole('button', { name: '۱٬۰۰۰ ؋' }).click()
  await page.getByRole('status').filter({ hasText: 'بازگشت به مشتری' }).getByText('۱۰۰ ؋').waitFor()
  await page.screenshot({ path: `${shots}/quick-cash-390.png`, fullPage: true })

  // 4) Keypad instead of the phone keyboard: first key replaces the suggestion.
  const field = page.getByLabel('مبلغ دریافتی (نقد)', { exact: true })
  assert.equal(await field.getAttribute('inputmode'), 'none')
  await field.click()
  const keypad = page.getByRole('group', { name: 'صفحه‌کلید پول' })
  for (const key of ['۱', '۵', '۰', '۰']) await keypad.getByRole('button', { name: key, exact: true }).click()
  assert.equal(await field.inputValue(), '1500')
  await keypad.getByRole('button', { name: 'پاک کردن یک رقم' }).click()
  assert.equal(await field.inputValue(), '150')
  await keypad.getByRole('button', { name: '۰', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'بازگشت به مشتری' }).getByText('۶۰۰ ؋').waitFor()
  await page.screenshot({ path: `${shots}/keypad-390.png`, fullPage: true })
  await keypad.getByRole('button', { name: 'تمام' }).click()
  await keypad.waitFor({ state: 'detached' })

  // 5) Save: 1,500 handed over, 600 given back → the till gets exactly 900.
  await page.getByRole('button', { name: 'ثبت فروش', exact: true }).click()
  await page.getByText(/فروش ثبت شد/).first().waitFor()
  assert.deepEqual(await page.evaluate(() => window.result()), { cash: 900, sales: [{ total: 900, paid: 900 }] })
  assert.ok(await page.evaluate(() => window.marks.includes('sale-check')), 'check mark shown')

  // Speed of that sale is kept on this phone and shown under «آمار».
  await page.getByRole('button', { name: 'آمار', exact: true }).click()
  const speed = page.getByRole('region', { name: 'سرعت فروش' })
  assert.match((await speed.innerText()).replace(/\s+/g, ' '), /این هفته: هر فروش حدود [۰-۹]+ ثانیه و [۰-۹]+ لمس · ۱ فروش/)
  const timing = await page.evaluate(async () => (await (await import('/src/db.ts')).db.settings.get('saleTimings')).value)
  assert.equal(timing.length, 1)
  assert.ok(timing[0].taps >= 8 && timing[0].pairs === 1, `taps counted from the cart to the save: ${JSON.stringify(timing[0])}`)
  await page.getByRole('button', { name: 'فروش جدید', exact: true }).click()

  // 6) Reduced motion: no flying pill, the sale still adds.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.evaluate(() => { window.marks = [] })
  await card.getByRole('button', { name: /42 قهوه‌ای/ }).click()
  await page.getByRole('textbox', { name: 'تعداد کوهستان 42', exact: true }).waitFor()
  assert.equal(await page.evaluate(() => window.marks.includes('fly-dot')), false)
  // 7) Sales saved before this fix are listed (read-only) in «کنترل حساب‌ها».
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.sales.add({ date: Date.now() - 86400000, saleType: 'retail', customerName: 'قدیمی', lines: [], total: 900, paid: 1000 })
  })
  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByText('تنظیمات پیشرفته', { exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'کنترل حساب‌ها' }).first().click()
  await page.getByRole('button', { name: 'اجرای کنترل' }).click()
  const old = page.getByRole('region', { name: 'فروش با پول اضافه' })
  assert.match(await old.innerText(), /۱ فروش قدیمی[\s\S]*۱۰۰ ؋ بیشتر[\s\S]*قدیمی[\s\S]*اضافه ۱۰۰ ؋/)
  assert.deepEqual(errors, [])
  console.log('PASS sale design: old overpaid sales listed read-only; colour-grouped size grid, fly-to-cart, below-cost flag, quick cash, keypad, change never kept in till, check mark, reduced motion')
} finally {
  await app.close()
}
