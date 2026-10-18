// 📷 در میز فروش: عکس کفش → سه بوت شبیه → لمس فروشنده → سبد. پیش از لمس هیچ چیزی به سبد نمی‌رود.
// عکس‌ها مصنوعی (کشیده‌شده روی canvas) اند؛ مدل واقعی MediaPipe در خود مرورگر اجرا می‌شود. هیچ درخواست بیرونی.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

// همان کشیدن در صفحه و در آزمایش: jitter عکسِ «گرفته‌شده» را کمی با عکس گدام فرق می‌دهد
const drawSource = `(hue, shape, jitter = 0) => {
  const c = document.createElement('canvas'); c.width = 320; c.height = 240
  const g = c.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, 320, 240)
  g.fillStyle = 'hsl(' + (hue + jitter) + ',70%,45%)'
  g.beginPath()
  if (shape === 'boot') { g.moveTo(60 + jitter, 40); g.lineTo(140, 40); g.lineTo(150, 150); g.lineTo(270, 170); g.lineTo(270, 200); g.lineTo(60, 200) }
  else if (shape === 'sneaker') { g.ellipse(160 + jitter, 150, 120, 45, 0, 0, Math.PI * 2) }
  else { g.moveTo(40, 190); g.lineTo(280, 190); g.lineTo(250, 120 + jitter); g.lineTo(90, 150) }
  g.fill(); g.fillStyle = '#222'; for (let i = 0; i < 6; i++) g.fillRect(70 + i * 30, 185, 12, 15)
  return c.toDataURL('image/jpeg', 0.8)
}`
const shot = async (hue, shape, jitter) => {
  const url = await page.evaluate(([src, h, s, j]) => (0, eval)(src)(h, s, j), [drawSource, hue, shape, jitter])
  return { name: 'shot.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(url.split(',')[1], 'base64') }
}
const cartLines = () => page.locator('.sale-cart-line').count()
const camera = () => page.getByLabel('فایل کامره برای جستجو')

try {
  await page.evaluate(async (src) => {
    const draw = (0, eval)(src)
    const { db } = await import('/src/db.ts')
    const { addVariant } = await import('/src/lib/ops.ts')
    const make = async (name, photo, sizes, price) => {
      const productId = await db.products.add({ name, photo, createdAt: Date.now() })
      for (const [size, qty] of sizes) await addVariant({ productId, size, color: '', purchasePrice: 400, retailPrice: price, wholesalePrice: price - 100, lowStock: 1, stockQty: qty }, name)
    }
    await make('بوت کوه', draw(0, 'boot'), [['۴۰ تا ۴۵ مکس', 10]], 1200)
    await make('کتانی آبی', draw(220, 'sneaker'), [['۴۰ تا ۴۵ مکس', 5]], 900)
    await make('چپلی سبز', draw(120, 'sandal'), [['41', 3], ['42', 3]], 500)
    await make('بی‌عکس', undefined, [['40', 4]], 700)
  }, drawSource)
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('button', { name: '📷 پیدا کردن بوت با عکس' }).waitFor()
  assert.equal(await camera().getAttribute('capture'), 'environment', 'the back camera opens')

  // 1) یک سایز: لمس = یک جوړه در سبد
  await camera().setInputFiles(await shot(220, 'sneaker', 12))
  const results = page.getByRole('region', { name: 'بوت‌های شبیه عکس' })
  await results.waitFor({ timeout: 60000 })
  const matches = results.locator('.sale-photo-match')
  assert.equal(await matches.count(), 3, 'three closest boots')
  assert.match(await matches.first().getAttribute('aria-label'), /^کتانی آبی — ۵ جوړه — ۹۰۰/)
  assert.equal(await cartLines(), 0, 'nothing goes into the cart before the seller taps')
  assert.ok(await results.getByText('۱ بوت در گدام عکس ندارد و با عکس پیدا نمی‌شود.').isVisible())
  await matches.first().click()
  await page.locator('.sale-cart-line').filter({ hasText: 'کتانی آبی' }).waitFor()
  assert.equal(await cartLines(), 1)
  assert.equal(await results.count(), 0, 'the results close after the tap')

  // 2) دو سایز موجود: کارت سایزها باز می‌شود؛ تا سایز لمس نشود چیزی اضافه نمی‌شود
  await camera().setInputFiles(await shot(120, 'sandal', 10))
  await results.waitFor()
  assert.match(await results.locator('.sale-photo-match').first().getAttribute('aria-label'), /^چپلی سبز/)
  await results.locator('.sale-photo-match').first().click()
  const picked = page.getByLabel('بوتی که با عکس پیدا شد')
  await picked.waitFor()
  assert.equal(await cartLines(), 1)
  await picked.getByRole('button', { name: /چپلی سبز 42/ }).click()
  assert.equal(await cartLines(), 2)
  await picked.getByRole('button', { name: 'بستن', exact: true }).click()
  assert.equal(await picked.count(), 0)

  // 3) نشانی عکس‌ها فقط یک بار ساخته می‌شود؛ عکس عوض‌شده دوباره خوانده می‌شود
  const index = () => page.evaluate(async () => (await (await import('/src/db.ts')).db.photoIndex.toArray()).map((r) => [r.productId, r.photoHash]))
  const before = await index()
  assert.equal(before.length, 3, 'only the three boots with a photo are indexed')
  await page.evaluate(async (src) => {
    const { db } = await import('/src/db.ts')
    const boot = await db.products.where('name').equals('بوت کوه').first()
    await db.products.update(boot.id, { photo: (0, eval)(src)(30, 'boot', 4) })
  }, drawSource)
  await camera().setInputFiles(await shot(30, 'boot', 9))
  await results.waitFor()
  assert.match(await results.locator('.sale-photo-match').first().getAttribute('aria-label'), /^بوت کوه/)
  const after = await index()
  assert.equal(after.length, 3)
  assert.equal(after.filter(([id, hash]) => before.some(([id2, hash2]) => id === id2 && hash === hash2)).length, 2, 'only the changed photo was read again')
  await results.getByRole('button', { name: 'بستن', exact: true }).click()

  // 4) هیچ سندی نوشته نشد؛ فقط سبد
  assert.equal(await page.evaluate(async () => (await (await import('/src/db.ts')).db.sales.count())), 0)

  // 5) گوشی کوچک
  await page.setViewportSize({ width: 320, height: 700 })
  await camera().setInputFiles(await shot(220, 'sneaker', 5))
  await results.waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 320), 'fits a 320px phone')

  assert.deepEqual(errors, [])
  console.log('PASS: photo search finds the boot, adds only on the seller’s tap, opens sizes, reindexes only changed photos, fits 320px')
} finally {
  await app.close()
}
