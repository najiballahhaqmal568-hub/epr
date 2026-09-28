// Disposable IndexedDB and localhost-only browser. No production account or network.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5205/customer-goods-receipt-ui'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5205', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'] })
let output = '', browser
server.stdout.on('data', chunk => { output += chunk })
server.stderr.on('data', chunk => { output += chunk })
try {
  let ready = false
  for (let i = 0; i < 100; i++) { try { if ((await fetch(url)).ok) { ready = true; break } } catch {} await new Promise(resolve => setTimeout(resolve, 300)) }
  if (!ready) throw new Error(`Vite did not start:\n${output}`)
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route('**/*', route => {
    const target = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(target.hostname)) return route.abort()
    if (target.pathname === '/customer-goods-receipt-ui') return route.fulfill({ contentType: 'text/html', body: '<html dir="rtl"><script type="module">import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script><div id="root"></div></html>' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async () => {
    await import('/src/index.css')
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { CustomerDetail } = await import('/src/pages/customers/CustomerDetail.tsx')
    const { default: CustomerGoodsReceiptDetail } = await import('/src/pages/customers/CustomerGoodsReceiptDetail.tsx')
    const { default: Sales } = await import('/src/pages/Sales.tsx')
    await db.open()
    await db.settings.clear()
    await db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } })
    const sourceId = await db.customers.add({ uuid: crypto.randomUUID(), name: 'مشتری منبع', type: 'wholesale', balance: 0 })
    const buyerId = await db.customers.add({ uuid: crypto.randomUUID(), name: 'مشتری خریدار', type: 'wholesale', balance: 0 })
    await ops.addOpeningDebt('customer', sourceId, 'مشتری منبع', 10000, 'قرض قبلی آزمایشی')
    window.testApp = { db, ops, React, ReactDOM, CustomerDetail, CustomerGoodsReceiptDetail, Sales, sourceId, buyerId }
    window.root = ReactDOM.createRoot(document.getElementById('root'))
    window.renderCustomer = async id => window.root.render(React.createElement(CustomerDetail, { customer: await db.customers.get(id), onClose() {} }))
    await window.renderCustomer(sourceId)
  })

  await page.evaluate(async () => {
    const { db, React, CustomerDetail } = window.testApp
    const zeroId = await db.customers.add({ uuid: crypto.randomUUID(), name: 'مشتری بدون طلب', type: 'wholesale', balance: 0 })
    window.root.render(React.createElement(CustomerDetail, { customer: await db.customers.get(zeroId), onClose() {} }))
  })
  assert.equal(await page.getByRole('button', { name: 'دریافت جنس بابت طلب' }).isDisabled(), true, 'zero-debt receipt action is disabled')
  await page.getByText('برای دریافت جنس، طلب فعلی مشتری باید مثبت باشد.').waitFor()
  await page.evaluate(() => window.renderCustomer(window.testApp.sourceId))

  await page.getByRole('button', { name: 'دریافت جنس بابت طلب' }).click()
  assert.match(await page.getByRole('dialog').last().innerText(), /همهٔ دستگاه‌ها/)
  await page.getByLabel('همهٔ دستگاه‌های فعال را به‌روز کردم').check()
  await page.getByRole('button', { name: 'فعال‌سازی در این دستگاه' }).click()
  assert.equal(await page.getByText('این موارد را اصلاح کنید:').count(), 0, 'blank initial form does not show noisy validation')
  await page.getByLabel('نام جنس 1').fill('بوت آزمایشی')
  await page.getByLabel('سایز 1').fill('41')
  await page.getByLabel('رنگ 1').fill('سیاه')
  await page.getByLabel('تعداد 1').fill('2.5')
  await page.getByLabel('قیمت توافقی 1').fill('1000')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  assert.equal(await page.getByLabel('تعداد 1').getAttribute('aria-invalid'), 'true', 'fractional quantity is linked to its field')
  await page.getByLabel('جنس 1', { exact: true }).getByText('تعداد باید عدد صحیح مثبت باشد؛ مانند ۲.').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /این موارد را اصلاح کنید:[\s\S]*تعداد باید عدد صحیح مثبت باشد/, 'invalid form shows an actionable validation summary')
  await page.getByLabel('تعداد 1').fill('2')
  await page.getByLabel('قیمت توافقی 1').fill('1000abc')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  assert.equal(await page.getByLabel('قیمت توافقی 1').getAttribute('aria-invalid'), 'true', 'numeric prefix cost is rejected and linked to its field')
  await page.getByLabel('قیمت توافقی 1').fill('0')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByLabel('جنس 1', { exact: true }).getByText('قیمت توافقی باید عدد صحیح مثبت باشد؛ مانند ۱۰۰۰.').waitFor()
  await page.getByLabel('قیمت توافقی 1').fill('6000')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByLabel('جنس 1', { exact: true }).getByText('ارزش مجموع جنس از طلب قابل تصفیه بیشتر است؛ تعداد یا قیمت توافقی را کم کنید.').waitFor()
  await page.getByLabel('قیمت توافقی 1').fill('1000')
  await page.getByLabel('فایل گالری').setInputFiles({ name: 'shoe.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: 'استفاده از این عکس' }).click()
  const narrow = await page.getByRole('dialog').last().boundingBox()
  assert.ok(narrow && narrow.width <= 390, 'receipt modal fits narrow viewport')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  assert.match(await page.getByRole('dialog').last().innerText(), /طلب پس از دریافت:[\s\S]*۸٬۰۰۰/)
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  const saveWarehouse = page.getByRole('button', { name: 'ثبت دریافت' })
  await saveWarehouse.evaluate(button => { button.click(); button.click() })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'رسید خریدار' }).count(), 0, 'warehouse receipt has no buyer print action')
  const warehouse = await page.evaluate(async () => {
    const { db, sourceId } = window.testApp
    const receipts = (await db.payments.toArray()).filter(row => row.goodsReceipt)
    window.testApp.warehouseUuid = receipts[0].goodsReceipt.receiptUuid
    return { source: (await db.customers.get(sourceId)).balance, stock: (await db.variants.toArray()).reduce((sum, row) => sum + row.stockQty, 0), payments: receipts.length, photo: Boolean((await db.products.toArray())[0]?.photo) }
  })
  assert.deepEqual(warehouse, { source: 8000, stock: 2, payments: 1, photo: true }, 'warehouse UI posts once with synthetic photo and updates debt/stock')

  await page.evaluate(() => window.renderCustomer(window.testApp.sourceId))
  await page.getByText(/دریافت جنس بابت طلب · مقصد: ورود به گدام/).waitFor()
  assert.match(await page.getByRole('dialog', { name: 'حساب مشتری منبع' }).innerText(), /بوت آزمایشی[\s\S]*مقصد: ورود به گدام/, 'source ledger names the warehouse destination')

  await page.evaluate(() => {
    const { React, CustomerGoodsReceiptDetail, warehouseUuid } = window.testApp
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid: warehouseUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()

  await page.evaluate(async () => {
    const { db, React, CustomerGoodsReceiptDetail, warehouseUuid } = window.testApp
    await db.settings.put({ key: 'cachedProfile', value: { role: 'staff' } })
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid: warehouseUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  assert.equal(await page.getByText(/قیمت توافقی/).count(), 0, 'staff receipt detail hides acquisition cost')
  assert.equal(await page.getByRole('button', { name: 'اصلاح سند' }).count(), 0, 'staff receipt detail has no mutation controls')
  await page.evaluate(async () => {
    const { db, React, CustomerGoodsReceiptDetail, warehouseUuid } = window.testApp
    await db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } })
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid: warehouseUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()

  await page.getByRole('button', { name: 'اصلاح سند' }).click()
  await page.getByLabel('تعداد 1').fill('3')
  await page.getByLabel('دلیل اصلاح').fill('اصلاح تعداد آزمایشی')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByText('پیش‌نمایش بررسی شد؛ معلومات را یک‌بار دیگر تأیید کنید.').waitFor()
  const warehouseCorrectionPreview = await page.getByRole('dialog').last().innerText()
  assert.match(warehouseCorrectionPreview, /مجموع‌های سند جایگزین:[\s\S]*3 جوره/, 'warehouse correction labels replacement totals')
  assert.match(warehouseCorrectionPreview, /تغییر خالص نسبت به سند اصلی:[\s\S]*تغییر طلب مشتری منبع:[\s\S]*−۱٬۰۰۰[\s\S]*تغییر موجودی گدام:[\s\S]*\+۱ جوره/, 'warehouse correction renders authoritative signed debt and stock deltas')
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  await page.evaluate(() => window.testApp.db.customers.update(window.testApp.buyerId, { name: 'مشتری خریدار تازه' }))
  await page.getByRole('button', { name: 'ثبت اصلاح' }).click()
  await page.getByText(/اطلاعات تغییر کرده است؛ پیش‌نمایش تازه بگیرید/).waitFor()
  assert.equal(await page.evaluate(async () => (await window.testApp.db.customers.get(window.testApp.sourceId)).balance), 8000, 'stale correction preview makes no writes')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  await page.getByRole('button', { name: 'ثبت اصلاح' }).click()
  await page.waitForFunction(async () => (await window.testApp.db.customers.get(window.testApp.sourceId)).balance === 7000)
  const corrected = await page.evaluate(async () => ({ source: (await window.testApp.db.customers.get(window.testApp.sourceId)).balance, stock: (await window.testApp.db.variants.toArray()).reduce((sum, row) => sum + row.stockQty, 0) }))
  assert.deepEqual(corrected, { source: 7000, stock: 3 }, 'correction UI keeps audit and applies net effect')

  await page.evaluate(async () => {
    const active = (await window.testApp.db.payments.toArray()).find(row => row.goodsReceipt?.status === 'active' && row.partyId === window.testApp.sourceId)
    window.testApp.correctedUuid = active.goodsReceipt.receiptUuid
    const { React, CustomerGoodsReceiptDetail } = window.testApp
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid: window.testApp.correctedUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  const replacementDetail = page.getByRole('dialog').last()
  await replacementDetail.getByRole('button', { name: 'دیدن سند اصلی' }).click()
  const originalDetail = page.getByRole('dialog').last()
  await originalDetail.getByText('باطل‌شده', { exact: true }).waitFor()
  assert.equal(await originalDetail.getByRole('button', { name: 'دیدن سند جایگزین' }).count(), 1, 'replacement links back to its original and original links onward')
  await originalDetail.getByRole('button', { name: 'دیدن سند جایگزین' }).click()
  const linkedReplacementDetail = page.getByRole('dialog').last()
  await linkedReplacementDetail.getByText('فعال', { exact: true }).waitFor()
  assert.equal(await linkedReplacementDetail.getByRole('button', { name: 'دیدن سند اصلی' }).count(), 1, 'original audit document navigates forward to the active replacement')
  await page.evaluate(() => {
    const { React, CustomerGoodsReceiptDetail, correctedUuid } = window.testApp
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { key: 'cancel-corrected', receiptUuid: correctedUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  await page.getByLabel('دلیل ابطال دریافت').fill('ابطال آزمایشی سند اصلاح‌شده')
  await page.getByRole('button', { name: 'پیش‌نمایش ابطال' }).click()
  await page.getByText(/ابطال اثر طلب/).waitFor()
  await page.getByRole('button', { name: 'تأیید نهایی ابطال' }).click()
  await page.getByRole('dialog').last().getByText('باطل‌شده', { exact: true }).waitFor()
  const cancelled = await page.evaluate(async () => ({
    source: (await window.testApp.db.customers.get(window.testApp.sourceId)).balance,
    stock: (await window.testApp.db.variants.toArray()).reduce((sum, row) => sum + row.stockQty, 0),
    audit: (await window.testApp.db.payments.toArray()).filter(row => row.goodsReceipt && row.deleted).length
  }))
  assert.deepEqual(cancelled, { source: 10000, stock: 0, audit: 2 }, 'cancellation UI restores effects and retains both audit documents')

  await page.evaluate(async () => {
    const { db, ops, React, CustomerDetail } = window.testApp
    const onwardSource = await db.customers.add({ uuid: crypto.randomUUID(), name: 'مشتری دوم', type: 'wholesale', balance: 0 })
    await ops.addOpeningDebt('customer', onwardSource, 'مشتری دوم', 10000, 'قرض قبلی آزمایشی')
    window.testApp.onwardSource = onwardSource
    window.root.render(React.createElement(CustomerDetail, { customer: await db.customers.get(onwardSource), onClose() {} }))
  })
  await page.getByRole('button', { name: 'دریافت جنس بابت طلب' }).click()
  await page.getByLabel('مقصد جنس').selectOption('onward')
  await page.getByLabel('نام جنس 1').fill('اسکچرز مستقیم')
  await page.getByLabel('سایز 1').fill('42')
  await page.getByLabel('رنگ 1').fill('خاکی')
  await page.getByLabel('تعداد 1').fill('2')
  await page.getByLabel('قیمت توافقی 1').fill('1000')
  await page.getByLabel('قیمت فروش 1').fill('1300')
  await page.getByLabel('خریدار فروش بعدی').selectOption({ label: 'مشتری خریدار تازه' })
  await page.getByLabel('مبلغ نقد فروش بعدی').fill('500')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  assert.match(await page.getByRole('dialog').last().innerText(), /قرض خریدار:[\s\S]*۲٬۱۰۰/)
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  await page.getByRole('button', { name: 'ثبت دریافت' }).click()
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  const onward = await page.evaluate(async () => {
    const active = (await window.testApp.db.payments.toArray()).find(row => row.goodsReceipt?.status === 'active' && row.partyId === window.testApp.onwardSource)
    window.testApp.onwardUuid = active.goodsReceipt.receiptUuid
    return {
      source: (await window.testApp.db.customers.get(window.testApp.onwardSource)).balance,
      buyer: (await window.testApp.db.customers.get(window.testApp.buyerId)).balance,
      variants: await window.testApp.db.variants.count(),
      sales: (await window.testApp.db.sales.toArray()).filter(row => row.goodsReceiptChild).length,
      cash: await window.testApp.ops.cashBalance()
    }
  })
  assert.deepEqual(onward, { source: 8000, buyer: 2100, variants: 2, sales: 1, cash: 500 }, 'onward UI posts sale/debt/cash without adding stock variants')

  await page.evaluate(() => window.renderCustomer(window.testApp.onwardSource))
  await page.getByText(/دریافت جنس بابت طلب · مقصد: فروش مستقیم به مشتری دیگر — بدون گدام/).waitFor()
  assert.match(await page.getByRole('dialog', { name: 'حساب مشتری دوم' }).innerText(), /اسکچرز مستقیم[\s\S]*مقصد: فروش مستقیم به مشتری دیگر — بدون گدام/, 'source ledger names the onward destination')
  await page.evaluate(() => {
    const { React, CustomerGoodsReceiptDetail, onwardUuid } = window.testApp
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid: onwardUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'اصلاح سند' }).click()
  await page.getByLabel('تعداد 1').fill('3')
  await page.getByLabel('دلیل اصلاح').fill('اصلاح تعداد فروش مستقیم')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByText('پیش‌نمایش بررسی شد؛ معلومات را یک‌بار دیگر تأیید کنید.').waitFor()
  const onwardCorrectionPreview = await page.getByRole('dialog').last().innerText()
  assert.match(onwardCorrectionPreview, /مجموع‌های سند جایگزین:[\s\S]*3 جوره[\s\S]*فروش:[\s\S]*۳٬۹۰۰/, 'onward correction distinguishes replacement totals')
  assert.match(onwardCorrectionPreview, /تغییر خالص نسبت به سند اصلی:[\s\S]*تغییر طلب مشتری منبع:[\s\S]*−۱٬۰۰۰[\s\S]*تغییر موجودی گدام:[\s\S]*۰ جوره[\s\S]*تغییر نقد:[\s\S]*۰ ؋[\s\S]*تغییر طلب خریدار:[\s\S]*\+۱٬۳۰۰[\s\S]*تغییر مفاد:[\s\S]*\+۳۰۰/, 'onward correction renders authoritative signed net effects including unchanged cash')
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  await page.getByRole('button', { name: 'ثبت اصلاح' }).click()
  await page.waitForFunction(async () => (await window.testApp.db.customers.get(window.testApp.onwardSource)).balance === 7000)
  const correctedOnward = await page.evaluate(async () => {
    const activePayment = (await window.testApp.db.payments.toArray()).find(row => row.goodsReceipt?.status === 'active' && row.partyId === window.testApp.onwardSource)
    const activeSale = (await window.testApp.db.sales.toArray()).find(row => row.goodsReceiptChild?.receiptUuid === activePayment.goodsReceipt.receiptUuid && !row.deleted)
    window.testApp.onwardUuid = activePayment.goodsReceipt.receiptUuid
    return {
      source: (await window.testApp.db.customers.get(window.testApp.onwardSource)).balance,
      buyer: (await window.testApp.db.customers.get(window.testApp.buyerId)).balance,
      cash: await window.testApp.ops.cashBalance(),
      sale: activeSale?.total,
      pairs: activeSale?.goodsReceiptLines?.reduce((sum, line) => sum + line.qty, 0)
    }
  })
  assert.deepEqual(correctedOnward, { source: 7000, buyer: 3400, cash: 500, sale: 3900, pairs: 3 }, 'onward correction posting matches the rendered net preview and preserves unchanged cash')

  await page.evaluate(() => {
    const { React, Sales } = window.testApp
    window.root.render(React.createElement(Sales, { isStaff: false }))
  })
  await page.getByRole('button', { name: 'تاریخچه' }).click()
  await page.getByRole('button', { name: /جزئیات فروش مشتری خریدار تازه/ }).click()
  await page.getByRole('button', { name: 'رسید خریدار' }).click()
  const receiptDialog = page.getByRole('dialog').last()
  await receiptDialog.getByRole('button', { name: /اشتراک/ }).waitFor()
  await receiptDialog.getByRole('img', { name: 'رسید' }).waitFor()
  assert.equal((await receiptDialog.getByRole('img', { name: 'رسید' }).getAttribute('src'))?.startsWith('data:image/png'), true, 'history route renders buyer-safe receipt image')
  await receiptDialog.getByText('بستن', { exact: true }).click()
  await page.getByRole('button', { name: 'فاکتور خریدار' }).click()
  const invoiceDialog = page.getByRole('dialog').last()
  assert.match(await invoiceDialog.innerText(), /اسکچرز مستقیم[\s\S]*۱٬۳۰۰/)
  assert.doesNotMatch(await invoiceDialog.innerText(), /قیمت توافقی|مفاد/)
  await invoiceDialog.getByRole('button', { name: /چاپ/ }).click()
  assert.equal(await page.locator('iframe').count(), 1, 'history route reaches printable buyer invoice')
  await invoiceDialog.getByText('بستن', { exact: true }).click()

  await page.evaluate(async () => {
    const { db, ops, React, CustomerDetail } = window.testApp
    const authSource = await db.customers.add({ uuid: crypto.randomUUID(), name: 'مشتری بررسی صلاحیت', type: 'wholesale', balance: 0 })
    await ops.addOpeningDebt('customer', authSource, 'مشتری بررسی صلاحیت', 5000, 'قرض آزمایشی صلاحیت')
    window.testApp.authSource = authSource
    window.root.render(React.createElement(CustomerDetail, { customer: await db.customers.get(authSource), onClose() {} }))
  })
  await page.getByRole('button', { name: 'دریافت جنس بابت طلب' }).click()
  await page.getByLabel('نام جنس 1').fill('جنس صلاحیت')
  await page.getByLabel('سایز 1').fill('40')
  await page.getByLabel('رنگ 1').fill('سفید')
  await page.getByLabel('تعداد 1').fill('1')
  await page.getByLabel('قیمت توافقی 1').fill('500')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  const beforeStaffLoss = await page.evaluate(async () => ({
    balance: (await window.testApp.db.customers.get(window.testApp.authSource)).balance,
    receipts: (await window.testApp.db.payments.toArray()).filter(row => row.goodsReceipt).length
  }))
  await page.evaluate(() => window.testApp.db.settings.put({ key: 'cachedProfile', value: { role: 'staff' } }))
  await page.getByText('دسترسی مالک برای ثبت این دریافت لازم است.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'ثبت دریافت' }).isDisabled(), true, 'open form disables after owner becomes staff')
  assert.deepEqual(await page.evaluate(async () => ({
    balance: (await window.testApp.db.customers.get(window.testApp.authSource)).balance,
    receipts: (await window.testApp.db.payments.toArray()).filter(row => row.goodsReceipt).length
  })), beforeStaffLoss, 'owner-to-staff open form makes no writes')
  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('dialog').last().getByRole('button', { name: 'بستن' }).click()

  await page.evaluate(async () => {
    const { db, React, CustomerDetail, authSource } = window.testApp
    await db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } })
    window.root.render(React.createElement(CustomerDetail, { customer: await db.customers.get(authSource), onClose() {} }))
  })
  await page.getByRole('button', { name: 'دریافت جنس بابت طلب' }).click()
  await page.getByLabel('نام جنس 1').fill('جنس صلاحیت دوم')
  await page.getByLabel('سایز 1').fill('41')
  await page.getByLabel('رنگ 1').fill('آبی')
  await page.getByLabel('تعداد 1').fill('1')
  await page.getByLabel('قیمت توافقی 1').fill('600')
  await page.getByRole('button', { name: 'پیش‌نمایش و بررسی' }).click()
  await page.getByLabel('معلومات و اثر حسابی این سند را بررسی کردم').check()
  const beforeUnknownLoss = await page.evaluate(async () => ({
    balance: (await window.testApp.db.customers.get(window.testApp.authSource)).balance,
    receipts: (await window.testApp.db.payments.toArray()).filter(row => row.goodsReceipt).length
  }))
  await page.evaluate(() => window.testApp.db.settings.delete('cachedProfile'))
  await page.getByText('دسترسی مالک برای ثبت این دریافت لازم است.').waitFor()
  assert.equal(await page.getByRole('button', { name: 'ثبت دریافت' }).isDisabled(), true, 'open form disables after owner becomes unknown')
  assert.deepEqual(await page.evaluate(async () => ({
    balance: (await window.testApp.db.customers.get(window.testApp.authSource)).balance,
    receipts: (await window.testApp.db.payments.toArray()).filter(row => row.goodsReceipt).length
  })), beforeUnknownLoss, 'owner-to-unknown open form makes no writes')
  page.once('dialog', dialog => void dialog.accept())
  await page.getByRole('dialog').last().getByRole('button', { name: 'بستن' }).click()
  await page.evaluate(() => window.testApp.db.settings.put({ key: 'cachedProfile', value: { role: 'owner' } }))

  const portable = await page.evaluate(async () => {
    const { db, ops } = window.testApp
    const active = (await db.payments.toArray()).find(row => row.goodsReceipt?.status === 'active')
    const json = await ops.exportBackup()
    await ops.importBackup(json, 'merge')
    await db.settings.put({ key: 'goodsReceiptCompatibilityAcknowledged', value: true })
    const state = await (await import('/src/lib/customerGoodsReceiptOps.ts')).loadCustomerGoodsReceipt(active.goodsReceipt.receiptUuid)
    window.testApp.portableUuid = active.goodsReceipt.receiptUuid
    return { status: state.status, sale: state.totals.sale, buyerDebt: state.totals.buyerDebt }
  })
  assert.deepEqual(portable, { status: 'ready', sale: 3900, buyerDebt: 3400 }, 'backup replay keeps receipt ready and financial totals portable')
  await page.evaluate(() => {
    const { React, CustomerGoodsReceiptDetail, portableUuid } = window.testApp
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid: portableUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByRole('dialog').last().getByText('فعال', { exact: true }).waitFor()
  assert.match(await page.getByRole('dialog').last().innerText(), /فروش:[\s\S]*۳٬۹۰۰/)

  await page.evaluate(async () => {
    const { db, React, CustomerGoodsReceiptDetail } = window.testApp
    const receiptUuid = crypto.randomUUID(), saleUuid = crypto.randomUUID(), revision = crypto.randomUUID()
    await db.sales.add({ uuid: saleUuid, date: Date.now(), customerId: window.testApp.buyerId, customerName: 'مشتری خریدار', saleType: 'wholesale', lines: [], goodsReceiptLines: [{ lineUuid: crypto.randomUUID(), productName: 'سند ناتمام', size: '40', color: 'سیاه', qty: 1, unitCost: 100, unitPrice: 150 }], goodsReceiptChild: { receiptUuid, revision, status: 'active' }, total: 150, paid: 0, discount: 0 })
    await db.syncState.put({ key: `goodsReceiptConflict:${receiptUuid}:sales:${saleUuid}`, value: { reason: 'synthetic conflict' } })
    window.root.render(React.createElement(CustomerGoodsReceiptDetail, { receiptUuid, onClose() {}, syncBeforeMutation: async () => {} }))
  })
  await page.getByText('تعارض همگام‌سازی', { exact: true }).waitFor()
  assert.match(await page.getByRole('dialog').last().innerText(), /قابل اصلاح یا ابطال نیست/)
  assert.equal(await page.getByRole('button', { name: 'رسید خریدار' }).count(), 0, 'conflicted receipt has no buyer print action')

  await page.setViewportSize({ width: 1100, height: 900 })
  const wide = await page.getByRole('dialog').last().boundingBox()
  assert.ok(wide && wide.width < 1100, 'receipt detail stays readable on wide viewport')
  await page.evaluate(async () => {
    const { accessFlags } = await import('/src/db.ts')
    accessFlags.readOnly = true
    await window.renderCustomer(window.testApp.sourceId)
  })
  assert.equal(await page.getByRole('button', { name: 'دریافت جنس بابت طلب' }).count(), 0, 'read-only account has no receipt write action')
  assert.deepEqual(errors, [], `browser errors: ${errors.join('; ')}`)
  console.log('PASS 41 checks: compatibility, strict field validation, destination ledger, photo, warehouse/onward correction net effects, audit navigation, staff privacy, stale-preview rejection, authorization loss, cancellation audit, history printing, double-submit, backup replay, conflict, responsive and read-only UI')
} finally {
  await browser?.close()
  server.kill()
}
