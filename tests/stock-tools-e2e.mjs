import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const port = 5197
const url = `http://localhost:${port}/?ui-preview`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], { stdio: 'ignore' })
let browser

async function waitForServer() {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(url)).ok) return
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('local Vite server did not start')
}

async function inventoryFixture(page) {
  await page.evaluate(async () => {
    const request = indexedDB.open('shoeErp')
    await new Promise((resolve, reject) => {
      request.onsuccess = resolve
      request.onerror = () => reject(request.error)
    })
    const database = request.result
    const add = (store, value) => new Promise((resolve, reject) => {
      const transaction = database.transaction(store, 'readwrite')
      const insert = transaction.objectStore(store).add(value)
      insert.onsuccess = () => resolve(insert.result)
      insert.onerror = () => reject(insert.error)
    })
    const now = Date.now()
    const canonical = await add('products', {
      name: 'آزمایش مدل', brand: 'آزمایشی', pairsPerCarton: 8, reorderAtCartons: 1, createdAt: now
    })
    const duplicate = await add('products', { name: 'آزمایش مدل جوړه‌ای', createdAt: now })
    await add('variants', {
      productId: canonical, size: '40', color: 'سیاه', stockQty: 2, purchasePrice: 500,
      retailPrice: 900, wholesalePrice: 800, lowStock: 2
    })
    await add('variants', {
      productId: canonical, size: '41', color: 'خاکی', stockQty: 3, purchasePrice: 500,
      retailPrice: 900, wholesalePrice: 800, lowStock: 2
    })
    await add('variants', {
      productId: duplicate, size: '42', color: 'سیاه', stockQty: 1, purchasePrice: 500,
      retailPrice: 900, wholesalePrice: 800, lowStock: 2
    })
  })
}

async function closeDialog(page) {
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'بستن' }).click()
  await dialog.waitFor({ state: 'detached' })
}

try {
  await waitForServer()
  const executablePath = [
    process.env.CHROMIUM_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean).find((candidate) => existsSync(candidate))
  if (!executablePath) throw new Error('Chrome or Edge was not found')

  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/*', (route) => {
    const hostname = new URL(route.request().url()).hostname
    return ['localhost', '127.0.0.1'].includes(hostname) ? route.continue() : route.abort()
  })
  await page.goto(url)
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  await inventoryFixture(page)
  await page.reload()
  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button', { name: /گدام و خرید/ }).click()
  await page.getByRole('heading', { name: 'گدام و خرید' }).waitFor()

  await page.getByRole('button', { name: 'ابزارها' }).click()
  await page.getByRole('button', { name: 'شمارش موجودی' }).click()
  await page.getByRole('heading', { name: 'شمارش فزیکی گدام' }).waitFor()
  await page.getByRole('group', { name: 'دامنهٔ شمارش' }).waitFor()
  await page.getByRole('region', { name: 'خلاصهٔ شمارش' }).waitFor()
  await closeDialog(page)

  await page.getByRole('region', { name: 'مدیریت گدام' }).getByRole('button', { name: /^خرید مجدد/ }).click()
  await page.getByRole('heading', { name: 'لیست خرید مجدد' }).waitFor()
  assert.match(await page.getByRole('dialog').innerText(), /همهٔ رنگ‌ها و سایزها/)
  assert.match(await page.getByRole('dialog').innerText(), /معادل/)
  await closeDialog(page)

  await page.getByRole('button', { name: 'یکجا کردن جنس تکراری' }).click()
  await page.getByRole('heading', { name: 'یکجا کردن اجناس تکراری' }).waitFor()
  await page.getByRole('region', { name: 'راهنمای ادغام' }).waitFor()
  await closeDialog(page)

  await page.locator('section[aria-label="فهرست موجودی"] .inventory-product-row').first().click()
  await page.getByText(/40 سیاه:/).click()
  await page.getByRole('heading', { name: /تعدیل گدام/ }).waitFor()
  await page.getByRole('region', { name: 'اثر تعدیل' }).waitFor()
  await closeDialog(page)

  await page.getByRole('button', { name: 'افزودن بوت جدید' }).click()
  await page.getByRole('heading', { name: 'جنس کارتنی جدید' }).waitFor()
  await page.getByRole('region', { name: 'مراحل ثبت کارتن' }).waitFor()
  await closeDialog(page)

  await mkdir('artifacts', { recursive: true })
  for (const viewport of [
    { width: 320, height: 760, fontScale: '125%' },
    { width: 390, height: 844, fontScale: '100%' },
    { width: 768, height: 900, fontScale: '125%' },
    { width: 1440, height: 960, fontScale: '100%' }
  ]) {
    await page.setViewportSize(viewport)
    await page.evaluate((fontScale) => { document.documentElement.style.fontSize = fontScale }, viewport.fontScale)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `horizontal overflow at ${viewport.width}px`)
    if (viewport.width === 390 || viewport.width === 1440) {
      await page.screenshot({ path: `artifacts/task-6b-stock-tools-${viewport.width}.png`, fullPage: true })
    }
  }

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'شمارش موجودی' }).click()
  await page.screenshot({ path: 'artifacts/task-6b-stocktake-390.png', fullPage: true })
  await closeDialog(page)

  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('region', { name: 'مدیریت گدام' }).getByRole('button', { name: /^خرید مجدد/ }).click()
  await page.screenshot({ path: 'artifacts/task-6b-reorder-1440.png', fullPage: true })
  await closeDialog(page)

  console.log('PASS: stock tools retain their routes while exposing grouped, model-level, accessible controls')
} finally {
  await browser?.close()
  server.kill()
}
