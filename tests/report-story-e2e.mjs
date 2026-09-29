// Reports top: «مفاد کردم؟ از کجا آمد؟», retail and wholesale apart, and motion that never shows a false number.
// Actual App, disposable IndexedDB, synthetic data; external requests blocked by localApp.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const nav = (name) => page.locator('nav').getByRole('button', { name, exact: true }).click()
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ')

try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(v, 100)
    const line = (qty, unitPrice) => [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty, unitPrice }]
    // retail 2 × 900 (profit 800), wholesale 3 × 800 (profit 900), rent 300 → net 1,400
    await addSale({ date: Date.now(), saleType: 'retail', lines: line(2, 900), total: 1800, paid: 1800 })
    await addSale({ date: Date.now(), saleType: 'wholesale', lines: line(3, 800), total: 2400, paid: 2400 })
    const cat = await db.expenseCategories.add({ name: 'کرایهٔ دکان' })
    await db.expenses.add({ date: Date.now(), categoryId: cat, categoryName: 'کرایهٔ دکان', amount: 300, type: 'business' })
  })
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  await nav('بیشتر')
  await page.getByRole('button').filter({ hasText: 'راپورها' }).first().click()
  await page.getByRole('heading', { name: 'راپورها' }).waitFor()

  // 1) «مفاد کردم؟» — net profit, and the plain sentence (1,400 of 4,200 → 33).
  const hero = page.getByRole('region', { name: 'مفاد', exact: true })
  assert.match(await text(hero), /مفاد خالص ۱٬۴۰۰ ؋/)
  assert.match(await text(hero), /از هر ۱۰۰ افغانی فروش، ۳۳ افغانی مفاد خالص شما شد/)
  // the number the home card links to is found the same way as before
  assert.match(await page.getByText('مفاد خالص', { exact: true }).first().locator('..').innerText(), /۱٬۴۰۰ ؋/)

  // 2) Retail and wholesale side by side: shares, profit, per pair, and the sentence built from them.
  const compare = page.getByRole('region', { name: 'پرچون و عمده کنار هم' })
  const cmp = await text(compare)
  assert.match(cmp, /پرچون ۴۳٪ فروش.*۱٬۸۰۰ ؋.*۸۰۰ ؋.*از هر ۱۰۰: ۴۴ افغانی.*۲ جوړه · هر جوړه ~۴۰۰ ؋/)
  assert.match(cmp, /عمده ۵۷٪ فروش.*۲٬۴۰۰ ؋.*۹۰۰ ؋.*از هر ۱۰۰: ۳۸ افغانی.*۳ جوړه · هر جوړه ~۳۰۰ ؋/)
  assert.match(cmp, /عمده جوړهٔ بیشتر فروخت؛ ولی هر جوړهٔ پرچون حدود ۱٫۳ برابر مفاد داشت/)

  // 3) «از کجا آمد؟» — the steps add up; a step explains itself, expenses list their categories.
  const steps = page.getByRole('region', { name: 'مفاد از کجا آمد' })
  assert.match(await text(steps), /قیمت فروش اجناس ۴٬۲۰۰ ؋.*قیمت خرید همین اجناس −۲٬۵۰۰ ؋.*مفاد فروش ۱٬۷۰۰ ؋.*مصارف دکان −۳۰۰ ؋.*مفاد خالص ۱٬۴۰۰ ؋/)
  await steps.getByRole('button', { name: /^مصارف دکان/ }).click()
  const sheet = page.locator('dialog[open]')
  assert.match(await text(sheet), /−۳۰۰ ؋.*کرایهٔ دکان ۳۰۰ ؋/)
  await sheet.getByRole('button', { name: 'فهمیدم' }).click()
  await sheet.waitFor({ state: 'detached' })

  // 4) The number never counts: sample the hero figure on every frame while switching to wholesale.
  const samples = await page.evaluate(() => new Promise((resolve) => {
    const seen = new Set()
    const start = performance.now()
    document.querySelector('.report-kinds [data-kind="wholesale"]').click()
    const tick = () => {
      const el = document.querySelector('.report-hero-figure strong')
      if (el) seen.add(el.textContent)
      if (performance.now() - start < 700) requestAnimationFrame(tick); else resolve([...seen])
    }
    requestAnimationFrame(tick)
  }))
  assert.deepEqual(samples.filter((s) => s !== '۱٬۴۰۰ ؋'), ['۹۰۰ ؋'], `only the old and the new value were ever on screen: ${samples}`)

  // 5) Wholesale alone: profit from goods, no expenses step, and the reason said on screen.
  assert.match(await text(hero), /مفاد از جنس · عمده ۹۰۰ ؋/)
  assert.match(await text(hero), /از هر ۱۰۰ افغانی فروش عمده، ۳۸ افغانی مفاد از جنس ماند — پیش از مصارف دکان/)
  assert.doesNotMatch(await text(steps), /مصارف دکان −/)
  assert.match(await text(steps), /مصارف دکان .*مال هر دو است و اینجا کم نمی‌شود/)
  assert.equal(await compare.count(), 0, 'the side-by-side card is only for «همه»')
  assert.match(await text(page.getByRole('region', { name: 'مفاد هر جنس' })), /مفاد هر جنس · عمده.*کوهستان ۹۰۰ ؋ ۳ جوړه/)
  const chart = page.getByRole('region', { name: 'فروش در ستون‌ها' })
  assert.match(await text(chart), /فروش · عمده.*۲٬۴۰۰ ؋/)
  // the chart is one big button: a tap at its right edge (RTL start) picks the first column; ‹ › stay in step
  const plot = chart.getByRole('button', { name: /^نمودار فروش/ })
  const box = await plot.boundingBox()
  await plot.click({ position: { x: box.width - 2, y: box.height / 2 } })
  assert.equal(await chart.getByRole('button', { name: 'قبلی' }).isDisabled(), true, 'first column picked')
  assert.ok(box.height >= 44, 'the chart is a large touch target')
  await page.getByRole('button', { name: 'پرچون', exact: true }).click()
  assert.match(await text(hero), /مفاد از جنس · پرچون ۸۰۰ ؋/)

  // 6) Readable in every display mode; with reduced motion nothing animates and everything is already there.
  await page.getByRole('button', { name: 'همه', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async (m) => (await import('/src/lib/displayMode.ts')).setDisplayMode(m), mode)
    await page.waitForTimeout(300)
    assert.deepEqual(await contrastFailures(page, '.report-story'), [], `report contrast in ${mode} mode`)
  }
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('light'))
  await page.getByRole('button', { name: 'عمده', exact: true }).click()
  const moving = await page.evaluate(() => document.querySelector('.report-story').getAnimations({ subtree: true }).map((a) => `${a.constructor.name}:${a.animationName ?? a.transitionProperty}:${a.effect?.getTiming().duration}`))
  // a pressed button's colour change may still run as a 0.01 ms transition (global reduced-motion rule); no keyframe motion may run
  assert.deepEqual(moving.filter((m) => m.startsWith('CSSAnimation')), [], `no keyframe animation with reduced motion: ${moving}`)
  assert.ok(moving.every((m) => Number(m.split(':')[2]) < 1), `anything left is instant: ${moving}`)

  assert.deepEqual(errors, [])
  console.log('PASS report story: net and sentence, retail vs wholesale side by side, steps add up and explain, numbers never count, kinds apart without guessing expenses, all modes readable, reduced motion still')
} finally {
  await app.close()
}
