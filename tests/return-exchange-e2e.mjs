import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

// Real modals and accounting operations, fresh browser contexts; no live accounts.
// Catches missing quantity bounds/names, duplicate writes and unsafe pending close,
// lost settlement branches, non-atomic stock failures, and narrow-screen overflow.
const url = 'http://localhost:5191/'
const screenshots = '.superpowers/sdd/plan/task-5b-screenshots'
mkdirSync(screenshots, { recursive: true })
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5191', '--strictPort'], { stdio: 'ignore' })
let browser
const errors = []
async function fixture(kind, customer = false) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async ({ kind, customer }) => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const { db } = await import('/src/db.ts')
    const { addSale } = await import('/src/lib/ops.ts')
    const Component = (await import(`/src/pages/sales/${kind}Modal.tsx`)).default
    const productId = await db.products.add({ name: 'بوت آزمایشی با نام طولانی', brand: 'آزمایشی' })
    const variantId = await db.variants.add({ productId, size: '42', color: 'سیاه', stockQty: 10, purchasePrice: 321, retailPrice: 700, wholesalePrice: 600 })
    const newProductId = await db.products.add({ name: 'کفش جدید آزمایشی' })
    await db.variants.add({ productId: newProductId, size: '43', color: 'آبی', stockQty: 4, purchasePrice: 222, retailPrice: 700, wholesalePrice: 600 })
    await db.variants.add({ productId: newProductId, size: '44', color: 'سرخ', stockQty: 0, purchasePrice: 222, retailPrice: 700, wholesalePrice: 600 })
    const customerId = customer ? await db.customers.add({ name: 'مشتری آزمایشی', type: 'retail', balance: 0 }) : undefined
    await db.cashMovements.add({ date: Date.now(), type: 'capital', amount: 2000 })
    const id = await addSale({ date: Date.now(), customerId, customerName: customer ? 'مشتری آزمایشی' : undefined, saleType: 'retail',
      lines: [{ variantId, productName: 'بوت آزمایشی با نام طولانی', size: '42', color: 'سیاه', qty: 2, unitPrice: 500 }], total: 1000, paid: customer ? 400 : 1000 })
    window.originalSale = await db.sales.get(id)
    window.root = ReactDOM.createRoot(document.getElementById('root'))
    window.root.render(React.createElement(Component, { sale: window.originalSale, onClose: () => window.root.render(null) }))
    window.snapshot = async () => ({
      stock: (await db.variants.toArray()).map(v => v.stockQty),
      cash: (await db.cashMovements.toArray()).reduce((s, m) => s + m.amount, 0),
      balance: customerId ? (await db.customers.get(customerId)).balance : null,
      sales: await db.sales.toArray(), returns: await db.returns.toArray(), adjustments: await db.adjustments.toArray(), movements: await db.cashMovements.toArray()
    })
  }, { kind, customer })
  await page.getByRole('dialog').waitFor()
  return page
}
async function chooseReturn(page) {
  assert.equal(await page.getByRole('dialog').locator('button').filter({ hasText: /^−$/ }).isDisabled(), true, 'zero quantity must expose its disabled lower bound')
  const decrease = page.getByRole('button', { name: /کم کردن برگشتی/ })
  const increase = page.getByRole('button', { name: /زیاد کردن برگشتی/ })
  assert.equal(await decrease.isDisabled(), true, 'zero quantity must expose its disabled lower bound')
  await increase.click()
  await increase.click()
  assert.equal(await increase.isDisabled(), true, 'sold quantity must expose its disabled upper bound')
  await decrease.click()
  assert.equal(await page.getByLabel(/تعداد برگشتی/).inputValue(), '1')
}
async function addNew(page) {
  await page.getByLabel('جستجوی جنس').fill('کفش جدید')
  assert.equal(await page.getByRole('button', { name: /کفش جدید.*44/ }).isDisabled(), true)
  await page.getByRole('button', { name: /کفش جدید.*43/ }).click()
}
async function capture(page, name) {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.evaluate(size => { document.documentElement.style.fontSize = size }, [320, 768].includes(width) ? '20px' : '')
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('dialog')].every(d => d.scrollWidth <= d.clientWidth)), `${name} fits at ${width}`)
    await page.getByRole('dialog').evaluate(d => { d.scrollTop = 0 })
    await page.screenshot({ path: `${screenshots}/${name}-${width}-top.png` })
    await page.getByRole('button', { name: /^ثبت / }).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${screenshots}/${name}-${width}-summary.png` })
  }
  assert.doesNotMatch(await page.getByRole('dialog').innerText(), /قیمت خرید|مفاد|۳۲۱|۲۲۲/)
  const small = await page.getByRole('dialog').locator('button, input:not([type="checkbox"]), select').evaluateAll(nodes => nodes.filter(n => n.getBoundingClientRect().height < 44).map(n => n.outerHTML))
  assert.deepEqual(small, [])
}
async function pendingSave(page, name) {
  // Pause only the transaction boundary; the actual operation and all effects run
  // unchanged after release. No production test hook or mocked financial result.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const transaction = db.transaction.bind(db)
    let first = true
    const gate = new Promise(resolve => { window.releaseSave = resolve })
    db.transaction = function (...args) {
      if (first) { first = false; return gate.then(() => transaction(...args)) }
      return transaction(...args)
    }
  })
  const before = await page.evaluate(() => window.snapshot())
  await page.getByRole('button', { name, exact: true }).evaluate(button => { button.click(); button.click() })
  await page.getByRole('status').filter({ hasText: 'در حال ثبت' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'در حال ثبت…', exact: true }).isDisabled(), true)
  assert.equal(await page.getByLabel(/تعداد برگشتی/).isDisabled(), true)
  await page.goBack()
  assert.equal(await page.getByRole('dialog').isVisible(), true, 'first browser Back cannot close a pending write')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'بستن', exact: true }).click()
  assert.equal(await page.getByRole('dialog').isVisible(), true, 'pending dialog survives Escape and close')
  assert.deepEqual(await page.evaluate(() => window.snapshot()), before, 'pending action has not posted')
  await page.evaluate(() => window.releaseSave())
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
function effects(actual, { stock, cash, balance, sales = 1, restock = true, settlement, reason }) {
  assert.deepEqual(actual.stock, stock)
  assert.equal(actual.cash, cash)
  assert.equal(actual.balance, balance)
  assert.equal(actual.sales.length, sales)
  assert.equal(actual.returns.length, 1, 'exactly one linked return, including after rapid clicks')
  assert.equal(actual.returns[0].refId, actual.sales[0].id)
  assert.equal(actual.returns[0].lines[0].restock, restock)
  assert.equal(actual.returns[0].settlement, settlement)
  assert.equal(actual.returns[0].reason, reason)
  assert.equal(actual.returns[0].amount, 500)
  assert.equal(actual.sales[0].lines[0].unitCost, 321, 'original financial snapshot preserved')
  if (sales === 2) assert.ok(actual.movements.some(m => m.type === 'sale' && m.refId === actual.sales[1].id), 'new sale cash is linked to its document')
}
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const cash = await fixture('Return')
  await chooseReturn(cash)
  assert.equal(await cash.getByLabel('تصفیه پول').locator('option').count(), 1)
  await cash.getByLabel('دلیل مرجوعی').selectOption({ label: 'پشیمانی مشتری' })
  await capture(cash, 'return-cash')
  await pendingSave(cash, 'ثبت مرجوعی')
  effects(await cash.evaluate(() => window.snapshot()), { stock: [9, 4, 0], cash: 2500, balance: null, settlement: 'cashRefund', reason: 'پشیمانی مشتری' })
  await cash.close()

  const debt = await fixture('Return', true)
  await chooseReturn(debt)
  assert.equal(await debt.getByLabel('تصفیه پول').inputValue(), 'reduceDebt')
  assert.match(await debt.getByRole('dialog').innerText(), /قرض فعلی.*۶۰۰/)
  await debt.getByLabel('دلیل مرجوعی').selectOption({ label: 'خرابی جنس' })
  await debt.getByRole('checkbox').uncheck()
  const beforeDebt = await debt.evaluate(() => window.snapshot())
  await debt.evaluate(async () => { const { accessFlags } = await import('/src/db.ts'); accessFlags.readOnly = true })
  await debt.getByRole('button', { name: 'ثبت مرجوعی', exact: true }).click()
  await debt.getByRole('alert').filter({ hasText: 'فقط مشاهده' }).waitFor()
  assert.deepEqual(await debt.evaluate(() => window.snapshot()), beforeDebt, 'return operation failure leaves the data unchanged')
  await debt.evaluate(async () => { const { accessFlags } = await import('/src/db.ts'); accessFlags.readOnly = false })
  await debt.getByRole('button', { name: 'ثبت مرجوعی', exact: true }).click()
  await debt.getByRole('dialog').waitFor({ state: 'hidden' })
  const damaged = await debt.evaluate(() => window.snapshot())
  effects(damaged, { stock: [8, 4, 0], cash: 2400, balance: 100, restock: false, settlement: 'reduceDebt', reason: 'خرابی جنس' })
  assert.equal(damaged.adjustments[0].reason, 'returnDamaged')
  await debt.close()

  for (const scenario of [
    { name: 'positive', price: 700, customer: false, cash: 3200, balance: null },
    { name: 'partial-debt', price: 700, customer: true, paid: '50', cash: 2450, balance: 750 },
    { name: 'negative', price: 300, customer: false, cash: 2800, balance: null },
    { name: 'equal', price: 500, customer: false, cash: 3000, balance: null }
  ]) {
    const page = await fixture('Exchange', scenario.customer)
    await chooseReturn(page)
    await addNew(page)
    const price = page.getByLabel(/قیمت فی جوړه/)
    await price.fill(String(scenario.price))
    if (scenario.paid) await page.getByLabel('دریافتی نقدی').fill(scenario.paid)
    if (scenario.name === 'positive') {
      await page.getByLabel(/تعداد جنس جدید/).fill('99')
      const before = await page.evaluate(() => window.snapshot())
      await page.getByRole('button', { name: 'ثبت تبادله', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'موجودی کافی نیست' }).waitFor()
      assert.deepEqual(await page.evaluate(() => window.snapshot()), before, 'stock rejection is atomic and recoverable')
      await page.getByLabel(/تعداد جنس جدید/).fill('0')
      assert.equal(await page.getByLabel(/تعداد جنس جدید/).inputValue(), '1')
      await page.getByRole('button', { name: /حذف جنس جدید/ }).click()
      assert.equal(await page.getByLabel(/قیمت فی جوړه/).count(), 0)
      await addNew(page)
      await page.getByLabel('دریافتی نقدی').fill('0')
      await page.getByRole('button', { name: 'ثبت تبادله', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: 'تفاوت باید نقد گرفته شود' }).waitFor()
      await page.getByLabel('دریافتی نقدی').fill('200')
      await capture(page, 'exchange-positive')
    }
    if (scenario.name === 'negative') assert.match(await page.getByRole('dialog').innerText(), /بازگشت نقدی به مشتری: ۲۰۰/)
    if (scenario.name === 'equal') assert.match(await page.getByRole('dialog').innerText(), /برابر — بدون پرداخت/)
    if (scenario.name === 'partial-debt') assert.match(await page.getByRole('dialog').innerText(), /قرض مشتری.*۱۵۰/)
    await pendingSave(page, 'ثبت تبادله')
    const result = await page.evaluate(() => window.snapshot())
    effects(result, { stock: [9, 3, 0], cash: scenario.cash, balance: scenario.balance, sales: 2, settlement: 'cashRefund', reason: 'تبادله' })
    assert.equal(result.sales[1].total, scenario.price)
    assert.equal(result.sales[1].lines[0].qty, 1)
    assert.equal(result.sales[1].lines[0].unitPrice, scenario.price)
    await page.close()
  }
  assert.deepEqual(errors, [])
  console.log('PASS: 6 real-UI financial scenarios; bounds, labels, stock/anonymous-debt errors and retry, removal, pending double-click/close protection, linked records, 4 widths/font scaling, no page errors')
} finally { await browser?.close(); server.kill() }
