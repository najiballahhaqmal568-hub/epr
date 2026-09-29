// Motion that must never lie or block: rolling numbers show only the old or the new value, the undo
// line shrinks with the seconds, list rows slide/fade, sheets close by pulling down, reduced motion
// turns it all off. Actual App, disposable IndexedDB.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const toLatin = s => s.replace(/[۰-۹]/g, d => '۰۱۲۳۴۵۶۷۸۹'.indexOf(d))
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    window.v40 = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    window.v41 = await db.variants.add({ productId, size: '41', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(window.v40, 10); await setOpeningStock(window.v41, 10)
    window.sell = (qty) => addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: window.v40, productName: 'کوهستان', size: '40', color: 'سیاه', qty, unitPrice: 900 }], total: qty * 900, paid: qty * 900 })
    await window.sell(1)
  })
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  const card = page.getByRole('button', { name: /فروش امروز .* از کجا آمد/ })
  await card.getByText('۹۰۰ ؋', { exact: true }).first().waitFor()

  // 1) Rolling number: record the text on every frame while it changes 900 → 2,700.
  const seen = await page.evaluate(async () => {
    const el = document.querySelector('.explain-card .rolling-number')
    const texts = new Set()
    let run = true
    const watch = () => { texts.add(el.textContent); if (run) requestAnimationFrame(watch) }
    watch()
    await window.sell(2)
    await new Promise(r => setTimeout(r, 900))
    run = false
    return { texts: [...texts], rolled: document.querySelectorAll('.explain-card .roll-up').length }
  })
  assert.deepEqual(seen.texts.map(toLatin).sort(), ['2٬700 ؋', '900 ؋'].sort(), 'only the old and the new value were ever shown')
  assert.ok(seen.rolled > 0, 'changed digits rolled up')

  // 2) Undo line shrinks with the seconds.
  await page.evaluate(async () => { const { offerUndo } = await import('/src/lib/undo.ts'); offerUndo('آزمایش', async () => {}) })
  await page.locator('.undo-progress').waitFor()
  await page.waitForTimeout(2600)
  const scale = await page.locator('.undo-progress').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).a)
  assert.ok(scale > 0.55 && scale < 0.85, `about 7 of 10 seconds left, got ${scale}`)
  await page.locator('.undo-toast').getByRole('button', { name: 'بستن', exact: true }).click()

  // 3) Sheet: a short slow pull springs back, a long pull closes it.
  await card.click()
  const sheet = page.getByRole('dialog', { name: 'فروش امروز از کجا آمد' })
  await sheet.waitFor()
  await page.waitForTimeout(400)
  const grab = await sheet.locator('.modal-grab').boundingBox()
  const pull = async (dy, steps) => {
    await page.mouse.move(grab.x + grab.width / 2, grab.y + 30)
    await page.mouse.down()
    await page.mouse.move(grab.x + grab.width / 2, grab.y + 30 + dy, { steps })
    await page.mouse.up()
  }
  await pull(30, 12)
  await page.waitForTimeout(400)
  assert.equal(await sheet.isVisible(), true, 'small pull springs back')
  await pull(220, 10)
  await sheet.waitFor({ state: 'detached' })

  // 4) Cart rows: removing a line leaves a fading copy for a moment; the others slide.
  await page.locator('nav').getByRole('button', { name: 'فروش', exact: true }).click()
  for (const size of ['40', '41']) {
    await page.locator('.sale-product-card').filter({ hasText: 'کوهستان' }).click()
    await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${size} سیاه`) }).click()
    await page.getByRole('textbox', { name: `تعداد کوهستان ${size}`, exact: true }).waitFor()
  }
  const ghost = await page.evaluate(async () => {
    let seenGhost = false
    const obs = new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => { if (n.getAttribute?.('aria-hidden') === 'true' && n.classList?.contains('sale-cart-line')) seenGhost = true })))
    obs.observe(document.querySelector('.sale-checkout'), { childList: true, subtree: true })
    document.querySelector('[aria-label="حذف کوهستان از سبد"]').click()
    await new Promise(r => setTimeout(r, 500))
    obs.disconnect()
    return { seenGhost, left: document.querySelectorAll('.sale-cart-line[aria-hidden="true"]').length, lines: document.querySelectorAll('.sale-cart-line[data-flip-key]').length }
  })
  assert.deepEqual(ghost, { seenGhost: true, left: 0, lines: 1 }, 'ghost faded out and was removed; one real line left')

  // 5) Reduced motion: numbers still correct, no rolled digits.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await card.getByText('۲٬۷۰۰ ؋', { exact: true }).first().waitFor()
  await page.evaluate(() => window.sell(1))
  await card.getByText('۳٬۶۰۰ ؋', { exact: true }).first().waitFor()
  const anims = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && a.effect?.target?.closest?.('.explain-card')).length)
  assert.equal(anims, 0, 'no running animation under reduced motion')
  assert.deepEqual(errors, [])
  console.log('PASS motion: numbers show only old/new values, undo line shrinks, sheet pull-to-close, cart ghost fades, reduced motion is still')
} finally {
  await app.close()
}
