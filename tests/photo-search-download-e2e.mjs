// 📷 با انترنت کند: فایل‌های مدل (۱۴ MB) هنوز نرسیده‌اند. جستجو نباید در «در حال پیدا کردن بوت…» بماند — با رنگ و
// شکل جواب می‌دهد و می‌گوید مدل هنوز دانلود می‌شود. وقتی فایل‌ها رسیدند، جستجوی بعدی مدل را به کار می‌برد.
// نسخهٔ ساخته‌شده زیر /epr/ با service worker، مثل گوشی دکان. اول: VITE_UI_PREVIEW=1 npm run build
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { chromium } from 'playwright-core'

const PORT = 4198
const types = { '.js': 'application/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }
let releaseModel
const modelHeld = new Promise((resolve) => { releaseModel = resolve })
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  let file = path.join('dist', decodeURIComponent(url.pathname.replace(/^\/epr\//, '')) || 'index.html')
  if (!url.pathname.startsWith('/epr/') || !fs.existsSync(file)) { res.writeHead(404); return res.end() }
  if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
  if (file.endsWith('.tflite')) await modelHeld // انترنت کند: مدل تا وقتی آزمایش نگوید نمی‌رسد
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}).listen(PORT)

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://localhost:${PORT}/epr/?ui-preview=1`)
  await page.locator('.app-nav').waitFor({ timeout: 30000 })
  await page.evaluate(() => navigator.serviceWorker.ready)
  const draw = `(hue, dx) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); g.fillStyle = '#eee'; g.fillRect(0, 0, 320, 240); g.fillStyle = 'hsl(' + hue + ',70%,45%)'; g.beginPath(); g.ellipse(160 + dx, 150, 120, 45, 0, 0, Math.PI * 2); g.fill(); return c.toDataURL('image/jpeg', 0.8) }`
  await page.evaluate(async (src) => {
    const photo = (0, eval)(src)
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('shoeErp'); r.onsuccess = () => resolve(r.result); r.onerror = reject })
    const add = (store, row) => new Promise((resolve, reject) => { const r = db.transaction(store, 'readwrite').objectStore(store).add(row); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
    for (const [name, hue] of [['کتانی آبی', 220], ['کتانی سبز', 120]]) {
      const productId = await add('products', { name, photo: photo(hue, 0), createdAt: Date.now(), uuid: crypto.randomUUID() })
      await add('variants', { productId, size: '40', color: '', purchasePrice: 400, retailPrice: 900, wholesalePrice: 800, lowStock: 1, stockQty: 5, uuid: crypto.randomUUID(), sku: name })
    }
  }, draw)
  await page.reload()
  await page.locator('.app-nav').waitFor()
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'the service worker serves the app, as on the phone')
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  const camera = page.getByLabel('فایل کامره برای جستجو')
  const results = page.getByRole('region', { name: 'بوت‌های شبیه عکس' })
  const shoot = async () => {
    const url = await page.evaluate((src) => (0, eval)(src)(225, 10), draw)
    await camera.setInputFiles({ name: 'shot.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(url.split(',')[1], 'base64') })
    await results.waitFor({ timeout: 15000 })
  }

  // 1) مدل هنوز در راه است: جواب بی انتظار، با رنگ و شکل
  await shoot()
  assert.match(await results.locator('.sale-photo-match').first().getAttribute('aria-label'), /^کتانی آبی/)
  assert.ok(await results.getByText('هنوز دانلود می‌شود', { exact: false }).isVisible(), 'says the full tool is still downloading')
  assert.equal(await page.getByRole('alert').count(), 0)
  await results.getByRole('button', { name: 'بستن', exact: true }).click()

  // 2) فایل‌ها رسیدند (در cache «vision»): جستجوی بعدی مدل را به کار می‌برد
  releaseModel()
  await page.waitForFunction(async () => (await (await caches.open('vision')).keys()).length === 3, null, { timeout: 60000 })
  await page.waitForTimeout(500)
  await shoot()
  assert.match(await results.locator('.sale-photo-match').first().getAttribute('aria-label'), /^کتانی آبی/)
  assert.equal(await results.getByText('رنگ و شکل مقایسه شدند', { exact: false }).count(), 0, 'the model is used once its files are here')

  assert.deepEqual(errors, [])
  console.log('PASS: on a slow line photo search answers by colour and shape at once, then uses the model once its files arrive')
} finally {
  await browser.close()
  server.close()
}
