// Real operations + IndexedDB in an isolated browser. Never contacts production.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5194/expense-details'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5194', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/*', route => {
    const request = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
    if (request.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: List } = await import('/src/pages/expenses/ExpenseList.tsx')
    const creditorId = await db.suppliers.add({ name: 'طلبکار آزمایشی', kind: 'expenseCreditor', balance: 0, createdAt: Date.now() })
    await db.cashMovements.add({ date: Date.now(), amount: 1000, type: 'opening' })
    window.expenseId = await ops.addExpense({ date: Date.now(), categoryName: 'مصرف آزمایشی', type: 'business', amount: 500, cashPaid: 200, creditAmount: 300, creditorId })
    window.snapshot = async () => ({ expense: await db.expenses.get(window.expenseId), cash: await ops.cashBalance(), creditor: (await db.suppliers.get(creditorId)).balance, stock: await db.products.count() })
    window.renderList = () => ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(List))
    window.renderList()
  })
  const before = await page.evaluate(() => window.snapshot())
  await page.getByRole('button', { name: 'جزئیات مصرف آزمایشی', exact: true }).click({ timeout: 6000 })
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'حذف سند اشتباهی', exact: true }).click()
  assert.match(await dialog.innerText(), /بخش نقدی به صندوق برمی‌گردد/)
  assert.match(await dialog.innerText(), /تسویه‌های قبلی/)
  await dialog.getByRole('button', { name: 'انصراف', exact: true }).click()
  assert.deepEqual(await page.evaluate(() => window.snapshot()), before, 'cancel changes no accounts or stock')
  await dialog.getByRole('button', { name: 'اصلاح سند', exact: true }).click()
  await page.getByRole('heading', { name: 'اصلاح مصرف — مصرف آزمایشی', exact: true }).waitFor()
  await page.getByRole('button', { name: 'بستن', exact: true }).click()
  // The calendar opens the same detail flow, without a second overlapping dialog.
  await page.getByRole('button', { name: 'تقویم', exact: true }).click()
  await page.locator('button.ring-2').click()
  await page.getByRole('button', { name: 'جزئیات مصرف آزمایشی', exact: true }).click()
  assert.equal(await dialog.count(), 1)
  await dialog.getByRole('button', { name: 'حذف سند اشتباهی', exact: true }).click()
  // Transaction failure must be visible, retain the record, and permit retry.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    window.failExpenseDelete = changes => { if (changes.deleted) throw new Error('خطای آزمایشی ثبت') }
    db.expenses.hook('updating', window.failExpenseDelete)
  })
  await dialog.getByRole('button', { name: 'تأیید حذف همین سند', exact: true }).click()
  await dialog.getByRole('alert').waitFor()
  assert.deepEqual(await page.evaluate(() => window.snapshot()), before, 'failed delete rolls back all effects')
  await page.evaluate(async () => { (await import('/src/db.ts')).db.expenses.hook('updating').unsubscribe(window.failExpenseDelete) })
  await page.screenshot({ path: 'qa-expense-delete-confirmation.png' })
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `no dialog overflow at ${width}`)
  }
  await dialog.getByRole('button', { name: 'تأیید حذف همین سند', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  const after = await page.evaluate(() => window.snapshot())
  assert.equal(after.expense.deleted, true, 'original retained as tombstone')
  assert.equal(after.cash, before.cash + 200)
  assert.equal(after.creditor, before.creditor - 300)
  assert.equal(after.stock, before.stock)
  await page.getByRole('button', { name: 'فهرست', exact: true }).click()
  for (const [type, cashPaid, creditAmount] of [['home', 100, 0], ['personal', 0, 100]]) {
    await page.evaluate(async ({ type, cashPaid, creditAmount }) => {
      const { db } = await import('/src/db.ts')
      window.expenseId = await (await import('/src/lib/ops.ts')).addExpense({ date: Date.now(), categoryName: type, type, amount: 100, cashPaid, creditAmount, creditorId: (await db.suppliers.toArray())[0].id })
    }, { type, cashPaid, creditAmount })
    const variantBefore = await page.evaluate(() => window.snapshot())
    await page.getByRole('button', { name: `جزئیات ${type}`, exact: true }).click()
    await dialog.getByRole('button', { name: 'اصلاح سند', exact: true }).click()
    await dialog.getByLabel('مبلغ درست *', { exact: true }).fill('150')
    await dialog.getByLabel('بخش نقدی (باقی قرض می‌شود) *', { exact: true }).fill('50')
    await dialog.getByLabel('دلیل اصلاح *', { exact: true }).fill('تصحیح مبلغ خانه و شخصی')
    await dialog.getByText('برداشت همین سند از سهم مالک (بی‌نام)', { exact: true }).waitFor()
    assert.match(await dialog.innerText(), /صاحب سهم: مالک \(بی‌نام\) \(ثابت\)/)
    assert.match(await dialog.innerText(), /نوع مصرف: .*\(ثابت\)/)
    await page.setViewportSize({ width: 390, height: 844 })
    await dialog.getByText('برداشت همین سند از سهم مالک (بی‌نام)', { exact: true }).scrollIntoViewIfNeeded()
    if (type === 'home') await page.screenshot({ path: 'qa-private-expense-correction.png', fullPage: true })
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth + 1), true, `no correction overflow at ${width}`)
    }
    await dialog.getByRole('button', { name: 'ثبت اصلاح سند', exact: true }).focus()
    assert.equal(await dialog.getByRole('button', { name: 'ثبت اصلاح سند', exact: true }).evaluate(el => el === document.activeElement), true)
    await dialog.getByRole('button', { name: 'ثبت اصلاح سند', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.evaluate(async () => {
      const { db } = await import('/src/db.ts')
      const old = await db.expenses.get(window.expenseId)
      window.expenseId = (await db.expenses.where('uuid').equals(old.correctedByUuid).first()).id
    })
    const corrected = await page.evaluate(() => window.snapshot())
    assert.equal(corrected.expense.type, type)
    assert.equal(corrected.expense.drawAmount, 150)
    assert.equal(corrected.cash, variantBefore.cash + cashPaid - 50)
    assert.equal(corrected.creditor, variantBefore.creditor - creditAmount + 100)
    await page.getByRole('button', { name: `جزئیات ${type}`, exact: true }).click()
    await dialog.getByRole('button', { name: 'حذف سند اشتباهی', exact: true }).click()
    await dialog.getByRole('button', { name: 'تأیید حذف همین سند', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    const variantAfter = await page.evaluate(() => window.snapshot())
    assert.equal(variantAfter.cash, variantBefore.cash + cashPaid)
    assert.equal(variantAfter.creditor, variantBefore.creditor - creditAmount)
  }
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.expenses.add({ date: Date.now(), categoryName: 'سند قدیمی', type: 'home', amount: 10 })
  })
  await page.getByRole('button', { name: 'جزئیات سند قدیمی', exact: true }).click()
  await dialog.getByText('اطلاعات برداشت این سند قدیمی یا ناقص است؛ پیش از اصلاح باید حساب صاحب سهم بررسی شود.', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'اصلاح سند', exact: true }).count(), 0)
  await dialog.getByRole('button', { name: 'بستن', exact: true }).click()
  await page.evaluate(async () => {
    const { db, accessFlags } = await import('/src/db.ts')
    await db.expenses.add({ date: Date.now(), categoryName: 'فقط خواندن', type: 'business', amount: 10 })
    accessFlags.readOnly = true
  })
  await page.getByRole('button', { name: 'جزئیات فقط خواندن', exact: true }).click()
  await dialog.getByText('فقط خواندن', { exact: true }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: 'حذف سند اشتباهی', exact: true }).count(), 0)
  assert.equal(await dialog.getByRole('button', { name: 'اصلاح سند', exact: true }).count(), 0)
  console.log('PASS: list/calendar details, cancel, home/personal correction forms, legacy guard, rollback/retry, cash/credit/mixed deletion, audit retention, read-only, keyboard and responsive layout')
} finally {
  await browser?.close()
  server.kill()
}
