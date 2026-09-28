import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5189/?ui-preview'
const screenshots = '.superpowers/sdd/plan/task-5a-screenshots'
mkdirSync(screenshots, { recursive: true })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5189', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(url)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Kabul' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(url)
  await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('heading', { name: 'میز فروش' }).waitFor()
  const fixture = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { startOfDay, addCalendarDays, toDateInput } = await import('/src/lib/format.ts')
    const today = startOfDay()
    const yesterday = addCalendarDays(today, -1)
    const line = { variantId: 1, productName: 'بوت آزمایشی', size: '42', color: 'سیاه', qty: 1, unitPrice: 10 }
    await db.sales.bulkAdd([
      { date: today + 3600000, total: 50, paid: 50, lines: [{ ...line, unitPrice: 50 }], saleType: 'retail', customerName: 'احمد آزمایشی' },
      ...Array.from({ length: 150 }, (_, i) => ({ date: yesterday + i * 1000, total: 10, paid: 10, lines: [line], saleType: 'retail' }))
    ])
    return { yesterday: toDateInput(yesterday), snapshot: JSON.stringify(await db.sales.toArray()) }
  })
  await page.getByRole('button', { name: 'تاریخچه', exact: true }).click()
  const history = page.getByRole('region', { name: 'تاریخچه فروش' })
  await history.locator('details').first().waitFor()
  assert.equal(await history.locator('details').count(), 2)
  assert.equal(await history.locator('details').first().getAttribute('open'), '')
  assert.equal(await history.locator('details').nth(1).getAttribute('open'), null)
  assert.match(await history.locator('summary').nth(1).innerText(), /۱۵۰ فروش/)
  assert.match(await history.locator('summary').nth(1).innerText(), /۱٬۵۰۰/)
  await history.locator('summary').nth(1).click()
  await page.waitForFunction(() => document.querySelectorAll('.sale-history-row').length === 151)
  await history.locator('summary').nth(1).click()
  await history.getByLabel('جستجوی مشتری یا جنس').fill('احمد')
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="تاریخچه فروش"] details').length === 1)
  await history.getByLabel('جستجوی مشتری یا جنس').fill('')
  await history.getByLabel('از تاریخ (میلادی)').fill(fixture.yesterday)
  await history.getByLabel('تا تاریخ (میلادی)').fill(fixture.yesterday)
  await page.waitForFunction(() => document.querySelectorAll('section[aria-label="تاریخچه فروش"] details').length === 1)
  assert.match(await history.locator('summary').innerText(), /۱۵۰ فروش/)
  await history.locator('summary').click()
  await history.locator('.sale-history-row').first().click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await history.getByRole('button', { name: 'پاک‌کردن فیلترها' }).click()
  await page.screenshot({ path: `${screenshots}/history-390.png`, fullPage: false })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.screenshot({ path: `${screenshots}/history-1440.png`, fullPage: false })
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(() => document.documentElement.style.fontSize = '20px')
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: `${screenshots}/history-${width}-large-font.png`, fullPage: false })
  }
  await page.evaluate(() => document.documentElement.style.fontSize = '')
  await history.getByLabel('جستجوی مشتری یا جنس').fill('ناموجود')
  await history.getByRole('status').filter({ hasText: 'پیدا نشد' }).waitFor()
  await history.getByLabel('از تاریخ (میلادی)').fill('2026-09-10')
  await history.getByLabel('تا تاریخ (میلادی)').fill('2026-09-01')
  await history.getByRole('alert').waitFor()
  await history.getByRole('button', { name: 'پاک‌کردن فیلترها' }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return JSON.stringify(await db.sales.toArray()) }), fixture.snapshot)
  await page.setViewportSize({ width: 390, height: 1000 })
  const ordinary = history.locator('.sale-history-row').first()
  await ordinary.click()
  for (const width of [390, 1440, 320, 768]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(size => document.documentElement.style.fontSize = size, [320, 768].includes(width) ? '20px' : '')
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('dialog')].every(d => d.scrollWidth <= d.clientWidth)))
    await page.screenshot({ path: `${screenshots}/detail-${width}.png`, fullPage: false })
  }
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /قیمت خرید|مفاد/)
  await page.keyboard.press('Escape')
  for (const [action, title] of [['رسید', 'رسید فروش'], ['فاکتور', 'فاکتور فروش'], ['مرجوعی', 'مرجوعی فروش'], ['تبادله', 'تبادلهٔ جنس']]) {
    await ordinary.click()
    await page.getByRole('dialog').getByRole('button', { name: action, exact: true }).click()
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    await page.keyboard.press('Escape')
  }
  await ordinary.click()
  const cancelledDelete = new Promise(resolve => page.once('dialog', async dialog => { await dialog.dismiss(); resolve() }))
  await page.getByRole('button', { name: 'حذف فروش', exact: true }).click()
  await cancelledDelete
  await page.getByRole('dialog').getByRole('button', { name: 'بستن', exact: true }).click()
  assert.equal(await page.evaluate(async () => { const { db } = await import('/src/db.ts'); return JSON.stringify(await db.sales.toArray()) }), fixture.snapshot)
  // A real synthetic direct trade must open its protected detail, never the
  // ordinary return/delete dialog or a false debt derived from base paid=0.
  await page.evaluate(async () => {
    const { db, newUuid, SYNC_TABLES } = await import('/src/db.ts')
    const { createDirectTrade } = await import('/src/lib/directTradeOps.ts')
    await db.settings.put({ key: 'directTrades.enabled', value: true })
    const customerId = await db.customers.add({ uuid: newUuid(), name: 'مشتری مستقیم آزمایشی', type: 'wholesale', balance: 0 })
    const supplierId = await db.suppliers.add({ uuid: newUuid(), name: 'فروشنده آزمایشی', kind: 'supplier', balance: 0 })
    await createDirectTrade({ tradeUuid: newUuid(), date: Date.now(), customerId, supplierId,
      lines: [{ lineUuid: newUuid(), productName: 'جنس مستقیم', size: '40', color: 'سیاه', qty: 1, unitCost: 321, unitPrice: 900 }], payments: [] })
    window.historySnapshot = async () => JSON.stringify(await Promise.all(SYNC_TABLES.map(table => db.table(table).toArray())))
    window.beforeDirectView = await window.historySnapshot()
  })
  const direct = history.getByRole('button', { name: /جزئیات فروش مشتری مستقیم آزمایشی/ })
  await direct.waitFor()
  assert.doesNotMatch(await direct.innerText(), /باقی:|قرض:/)
  assert.match(await direct.innerText(), /جنس مستقیم/)
  await direct.click()
  await page.getByRole('heading', { name: 'جزئیات فروش مستقیم', exact: true }).waitFor()
  assert.equal(await page.getByRole('dialog').getByRole('button', { name: /حذف فروش|مرجوعی|تبادله|اصلاح فروش/ }).count(), 0)
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => window.historySnapshot()), await page.evaluate(() => window.beforeDirectView))
  // Customer documents must use the stored net total, never deduct discount twice,
  // and treat user-entered names as text in the printable document.
  const documents = await browser.newPage({ viewport: { width: 390, height: 844 } })
  documents.on('pageerror', e => errors.push(e.message))
  await documents.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    return route.continue()
  })
  await documents.goto(url)
  await documents.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const Invoice = (await import('/src/pages/sales/InvoiceModal.tsx')).default
    window.documentSale = { id: 8, date: Date.now(), saleType: 'wholesale', customerName: 'احمد <b>آزمایشی</b>', total: 900, discount: 100, paid: 400,
      lines: [{ productName: 'بوت <i>آزمایشی</i>', size: '42', color: 'سیاه', qty: 2, unitPrice: 500, unitCost: 321 }] }
    window.documentRoot = ReactDOM.createRoot(document.getElementById('root'))
    window.documentRoot.render(React.createElement(Invoice, { sale: window.documentSale, onClose: () => window.documentRoot.render(null) }))
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.shared = data } })
    const create = document.createElement.bind(document)
    document.createElement = (...args) => {
      const element = create(...args)
      if (args[0] === 'iframe') {
        const append = document.body.appendChild.bind(document.body)
        document.body.appendChild = node => {
          const result = append(node)
          if (node === element) node.contentWindow.print = () => { window.printed = node.contentDocument.documentElement.outerHTML }
          return result
        }
      }
      return element
    }
  })
  await documents.getByRole('button', { name: /اشتراک/ }).click()
  const shared = await documents.evaluate(() => window.shared.text)
  assert.match(shared, /قابل پرداخت: ۹۰۰/, 'stored total is already after the 100 discount')
  assert.match(shared, /مجموع اجناس: ۱٬۰۰۰/)
  assert.match(shared, /باقی \(قرض\): ۵۰۰/)
  assert.doesNotMatch(shared, /قیمت خرید|مفاد|۳۲۱/)
  await documents.getByRole('button', { name: /چاپ/ }).click()
  const printed = await documents.evaluate(() => {
    const doc = new DOMParser().parseFromString(window.printed, 'text/html')
    return { name: doc.querySelector('.sub').textContent, item: doc.querySelector('tbody tr td:nth-child(2)').textContent, markup: doc.querySelector('tbody i') !== null, text: doc.body.textContent }
  })
  assert.match(printed.name, /احمد <b>آزمایشی<\/b>/)
  assert.match(printed.item, /بوت <i>آزمایشی<\/i>/)
  assert.equal(printed.markup, false)
  assert.match(printed.text, /قابل پرداخت۹۰۰/)
  for (const width of [390, 1440, 320, 768]) {
    await documents.setViewportSize({ width, height: 1000 })
    await documents.evaluate(size => document.documentElement.style.fontSize = size, [320, 768].includes(width) ? '20px' : '')
    assert.ok(await documents.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('dialog')].every(d => d.scrollWidth <= d.clientWidth)))
    await documents.screenshot({ path: `${screenshots}/invoice-${width}.png`, fullPage: false })
  }
  // Capture the real canvas calls: no business-cost values, correct net/paid/debt,
  // and a PNG file handed to share (or downloaded without external transport).
  await documents.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const Receipt = (await import('/src/pages/sales/Receipt.tsx')).default
    const draw = CanvasRenderingContext2D.prototype.fillText
    window.receiptText = []
    CanvasRenderingContext2D.prototype.fillText = function (...args) { window.receiptText.push({ text: args[0], y: args[2], height: this.canvas.height }); return draw.apply(this, args) }
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, value: async data => { window.sharedImage = { name: data.files[0].name, type: data.files[0].type, size: data.files[0].size } } })
    window.documentRoot.render(React.createElement(Receipt, { sale: window.documentSale, onClose: () => window.documentRoot.render(null), onNext: () => { window.nextSale = true } }))
  })
  await documents.getByRole('img', { name: 'رسید', exact: true }).waitFor()
  const canvas = await documents.evaluate(() => window.receiptText)
  const texts = canvas.map(row => row.text)
  assert.ok(texts.includes('۹۰۰ ؋') && texts.includes('۴۰۰ ؋') && texts.includes('۵۰۰ ؋'))
  assert.doesNotMatch(texts.join('\n'), /قیمت خرید|مفاد|۳۲۱/)
  assert.ok(canvas.every(row => row.y < row.height))
  await documents.getByRole('button', { name: /اشتراک/ }).click()
  await documents.waitForFunction(() => window.sharedImage !== undefined)
  assert.deepEqual(await documents.evaluate(() => [window.sharedImage.name, window.sharedImage.type, window.sharedImage.size > 1000]), ['atal-receipt.png', 'image/png', true])
  await documents.evaluate(() => Object.defineProperty(navigator, 'canShare', { value: () => false }))
  const download = documents.waitForEvent('download')
  await documents.getByRole('button', { name: /اشتراک/ }).click()
  assert.equal((await download).suggestedFilename(), 'atal-receipt.png')
  for (const width of [390, 1440]) {
    await documents.setViewportSize({ width, height: 1000 })
    await documents.evaluate(() => document.documentElement.style.fontSize = '')
    await documents.screenshot({ path: `${screenshots}/receipt-${width}.png`, fullPage: false })
  }
  await documents.getByRole('button', { name: 'فروش بعدی', exact: true }).click()
  assert.equal(await documents.evaluate(() => window.nextSale), true)
  await documents.getByRole('button', { name: 'بستن', exact: true }).last().click()
  await documents.getByRole('dialog').waitFor({ state: 'hidden' })
  await documents.evaluate(async () => {
    const { db, accessFlags } = await import('/src/db.ts')
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const Sales = (await import('/src/pages/Sales.tsx')).default
    await db.sales.add(window.documentSale)
    accessFlags.readOnly = true
    window.documentRoot.render(React.createElement(Sales, { isStaff: true }))
  })
  await documents.locator('.sale-history-row').click()
  const viewerDetail = documents.getByRole('dialog')
  assert.equal(await viewerDetail.getByRole('button', { name: /حذف فروش|مرجوعی|تبادله/ }).count(), 0)
  assert.equal(await viewerDetail.getByRole('button', { name: 'رسید', exact: true }).count(), 1)
  assert.equal(await viewerDetail.getByRole('button', { name: 'فاکتور', exact: true }).count(), 1)
  const viewerTotals = await viewerDetail.locator('.sale-document-totals').innerText()
  assert.match(viewerTotals, /مجموع اجناس\s+۱٬۰۰۰/)
  assert.match(viewerTotals, /تخفیف\s+۱۰۰/)
  assert.match(viewerTotals, /قابل پرداخت\s+۹۰۰/)
  assert.doesNotMatch(await viewerDetail.innerText(), /قیمت خرید|مفاد|۳۲۱/)
  assert.deepEqual(errors, [])
  console.log('PASS: complete groups/search/range/reset; ordinary and direct detail routes; cancelled delete unchanged; read-only actions/privacy; responsive history/detail/invoice; discounted text/print and escaped names; receipt PNG share/download/next; no business writes while browsing')
} finally { await browser?.close(); server.kill() }
