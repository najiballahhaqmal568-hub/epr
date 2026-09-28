import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const port = 5196
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

try {
  await waitForServer()
  const candidates = [
    process.env.CHROMIUM_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean)
  const executablePath = candidates.find((candidate) => existsSync(candidate))
  if (!executablePath) throw new Error('Chrome or Edge was not found')

  browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/*', (route) => {
    const hostname = new URL(route.request().url()).hostname
    return ['localhost', '127.0.0.1'].includes(hostname) ? route.continue() : route.abort()
  })
  page.on('pageerror', (error) => console.error('page error:', error.message))
  await page.goto(url)
  await page.getByRole('heading', { name: 'خانه' }).waitFor()

  const modelName = 'بوت چرمی مجلسی بسیار بلند برای تست نمایش نام کامل'
  await page.evaluate(async ({ modelName }) => {
    const canvas = document.createElement('canvas')
    canvas.width = 12
    canvas.height = 12
    const context = canvas.getContext('2d')
    context.fillStyle = '#2563eb'
    context.fillRect(0, 0, 12, 12)
    const photo = canvas.toDataURL('image/png')
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
    const day = 86_400_000
    const productId = await add('products', {
      name: modelName,
      brand: 'آریانا',
      category: 'مردانه',
      photo,
      pairsPerCarton: 12,
      reorderAtCartons: 1,
      createdAt: Date.now() - 180 * day
    })
    await add('variants', {
      productId,
      size: '42',
      color: 'سیاه',
      sku: 'SKU-42-BLACK',
      stockQty: 7,
      purchasePrice: 987_654_321_098,
      retailPrice: 1_500_000,
      wholesalePrice: 1_400_000,
      lowStock: 2,
      lastPurchaseAt: Date.now() - 150 * day
    })
    await add('variants', {
      productId,
      size: '43',
      color: 'نصواری',
      sku: 'SKU-43-BROWN',
      stockQty: 0,
      purchasePrice: 1_200_000,
      retailPrice: 1_480_000,
      wholesalePrice: 1_390_000,
      lowStock: 2,
      lastPurchaseAt: Date.now() - 20 * day
    })
  }, { modelName })

  await page.reload()
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button', { name: /گدام و خرید/ }).click()

  const main = page.getByRole('main')
  await main.getByRole('heading', { name: 'گدام و خرید' }).waitFor()
  const summary = main.getByRole('region', { name: 'خلاصهٔ موجودی' })
  await summary.waitFor()
  assert.match(await summary.innerText(), /۷ جوړه/)
  assert.match(await summary.innerText(), /۶٬۹۱۳٬۵۸۰٬۲۴۷٬۶۸۶/)

  const search = main.getByRole('searchbox', { name: 'جستجوی موجودی' })
  await search.waitFor()
  const management = main.getByRole('region', { name: 'مدیریت گدام' })
  const list = main.getByRole('region', { name: 'فهرست موجودی' })
  await management.waitFor()
  await list.waitFor()
  assert.ok(await page.evaluate(([managementElement, listElement]) => (
    Boolean(managementElement.compareDocumentPosition(listElement) & Node.DOCUMENT_POSITION_FOLLOWING)
  ), [await management.elementHandle(), await list.elementHandle()]), 'management actions should appear before the inventory list')
  await main.getByRole('group', { name: 'چیدمان فهرست' }).waitFor()
  await main.getByRole('button', { name: 'افزودن بوت جدید' }).waitFor()
  assert.equal(await main.getByRole('button', { name: /بوت جدید/ }).count(), 1, 'writable inventory has one inline add action')

  await list.getByAltText(`عکس بوت ${modelName}`).waitFor()
  assert.match(await list.innerText(), new RegExp(modelName))
  assert.match(await list.innerText(), /معادل کارتنی/)
  assert.match(await list.innerText(), /خرید مجدد/)
  assert.match(await list.innerText(), /در گدام/)

  const beforeCancel = await page.evaluate(async () => {
    const request = indexedDB.open('shoeErp')
    await new Promise((resolve) => { request.onsuccess = resolve })
    const database = request.result
    const getAll = (store) => new Promise((resolve) => {
      const query = database.transaction(store, 'readonly').objectStore(store).getAll()
      query.onsuccess = () => resolve(query.result)
    })
    return JSON.stringify({ products: await getAll('products'), variants: await getAll('variants'), adjustments: await getAll('adjustments') })
  })
  await list.getByRole('button', { name: new RegExp(modelName) }).click()
  await list.getByRole('button', { name: 'ویرایش مشخصات جنس' }).click()
  await page.getByRole('heading', { name: 'ویرایش بوت' }).waitFor()
  await page.getByRole('region', { name: 'مشخصات اصلی' }).waitFor()
  await page.getByRole('region', { name: 'سایزها، رنگ‌ها و قیمت‌ها' }).waitFor()
  await page.getByRole('region', { name: 'تنظیم خرید مجدد و کارتن' }).waitFor()
  assert.match(await page.getByText(/SKU-42-BLACK/).first().innerText(), /SKU-42-BLACK/)
  await page.getByRole('button', { name: 'بستن' }).click()
  const afterCancel = await page.evaluate(async () => {
    const request = indexedDB.open('shoeErp')
    await new Promise((resolve) => { request.onsuccess = resolve })
    const database = request.result
    const getAll = (store) => new Promise((resolve) => {
      const query = database.transaction(store, 'readonly').objectStore(store).getAll()
      query.onsuccess = () => resolve(query.result)
    })
    return JSON.stringify({ products: await getAll('products'), variants: await getAll('variants'), adjustments: await getAll('adjustments') })
  })
  assert.equal(afterCancel, beforeCancel, 'opening and cancelling product edit must not change business data')

  await search.fill('SKU-42-BLACK')
  assert.equal(await list.getByText(modelName, { exact: true }).count(), 1)
  await search.fill('نام ناموجود')
  await main.getByText('هیچ جنسی با این جستجو پیدا نشد.').waitFor()
  await search.fill('')
  await mkdir('artifacts', { recursive: true })

  for (const viewport of [
    { width: 320, height: 760, fontScale: '125%' },
    { width: 390, height: 844, fontScale: '100%' },
    { width: 768, height: 900, fontScale: '100%' },
    { width: 1440, height: 960, fontScale: '125%' }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.evaluate((fontScale) => { document.documentElement.style.fontSize = fontScale }, viewport.fontScale)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), true, `horizontal overflow at ${viewport.width}px`)
    if (viewport.width === 320) {
      const add = main.getByRole('button', { name: 'افزودن بوت جدید' })
      const listBox = await list.boundingBox()
      const addBox = await add.boundingBox()
      assert.ok(addBox && listBox && addBox.y + addBox.height <= listBox.y + 1, 'the only add action must not overlay the product list on mobile')
      const amount = summary.locator('.inventory-money').last()
      assert.equal(await amount.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element)
        return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.y))).size
      }), 1, 'a large AFN token stays on one line at 320px with enlarged text')
    }
    await page.screenshot({ path: `artifacts/task-6a-inventory-${viewport.width}.png`, fullPage: true })
  }

  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Inventory } = await import('/src/pages/Inventory.tsx')
    const { accessFlags } = await import('/src/db.ts')
    accessFlags.readOnly = true
    window.readOnlyInventoryHost = document.createElement('section')
    window.readOnlyInventoryHost.setAttribute('aria-label', 'آزمایش موجودی فقط مشاهده')
    document.body.append(window.readOnlyInventoryHost)
    window.readOnlyInventoryRoot = ReactDOM.createRoot(window.readOnlyInventoryHost)
    window.readOnlyInventoryRoot.render(React.createElement(Inventory))
  })
  const readOnlyInventory = page.getByRole('region', { name: 'آزمایش موجودی فقط مشاهده' })
  await readOnlyInventory.getByRole('heading', { name: 'گدام و خرید' }).waitFor()
  assert.equal(await readOnlyInventory.getByRole('button', { name: /بوت جدید/ }).count(), 0, 'read-only inventory must not expose an add action')
  await page.evaluate(async () => {
    window.readOnlyInventoryRoot.unmount()
    window.readOnlyInventoryHost.remove()
    const { accessFlags } = await import('/src/db.ts')
    accessFlags.readOnly = false
  })

  console.log('PASS: inventory hierarchy, product/photo identity, value/age/reorder/carton signals, cancel safety, search, and responsive widths')
} finally {
  await browser?.close()
  server.kill()
}
