// One language for every account: green = «باید بگیریم», red = «باید بدهیم», no +/− signs, the same buttons.
// Before this, the same debt read «قرض مشتری به دکان / قرض ما به او / طلب ما از او / قرض مصرف» with opposite
// signs and colours on each screen. Actual App, disposable IndexedDB, synthetic data; external requests blocked.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'

const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ')
const colorOf = (locator) => locator.evaluate((el) => getComputedStyle(el).color)

try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    await db.cashMovements.add({ date: Date.now() - 86400000, type: 'openingSet', amount: 100000, note: 'اول' })
    const pid = await db.products.add({ name: 'کوهستان', createdAt: 1 })
    const v = await ops.addVariant({ productId: pid, size: '40', color: 'سیاه', purchasePrice: 1000, retailPrice: 1500, wholesalePrice: 1300, stockQty: 50, lowStock: 2 }, 'کوهستان')
    const line = (qty, unitPrice) => ({ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty, unitPrice })
    // customer owes us 5,000 (6,000 − 1,000 cash)
    const ahmad = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: 1 })
    await ops.addSale({ date: Date.now(), customerId: ahmad, customerName: 'احمد', saleType: 'retail', lines: [line(4, 1500)], total: 6000, paid: 1000 })
    // supplier: we owe 20,000 − 5,000 = 15,000
    const shik = await db.suppliers.add({ name: 'شیک', kind: 'supplier', balance: 0 })
    await ops.addPurchase({ date: Date.now(), supplierId: shik, supplierName: 'شیک', lines: [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 20, unitCost: 1000 }], total: 20000, paid: 5000 })
    // sarraf: we owe 10,000 through him
    const sarraf = await db.suppliers.add({ name: 'صراف حاجی', kind: 'sarraf', balance: 0 })
    const tolo = await db.suppliers.add({ name: 'طلوع', kind: 'supplier', balance: 0 })
    await ops.addPurchase({ date: Date.now(), supplierId: tolo, supplierName: 'طلوع', lines: [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 10, unitCost: 1000 }], total: 10000, paid: 0, sarrafId: sarraf, sarrafName: 'صراف حاجی', sarrafAmount: 10000 })
    // lender who lent us 15,000, then took 2 pairs at 1,400 → we owe 12,200
    const gul = await db.suppliers.add({ name: 'گل لالا', kind: 'lender', balance: 0 })
    await ops.addLoan(gul, 'گل لالا', 15000)
    await ops.giveGoodsToLender(gul, 'گل لالا', [line(2, 1400)])
    // lender who owes US 3,000
    const nabi = await db.suppliers.add({ name: 'نبی', kind: 'lender', balance: 0 })
    await ops.giveCashToLender(nabi, 'نبی', 3000, Date.now(), undefined, 'cashLoan')
    // expense creditor: 4,000 on credit, 1,500 paid with a pair → we owe 2,500
    const akbar = await db.suppliers.add({ name: 'ترانسپورت اکبر', kind: 'expenseCreditor', balance: 0 })
    const cat = await db.expenseCategories.add({ name: 'کرایه بار' })
    await ops.addExpense({ date: Date.now(), categoryId: cat, categoryName: 'کرایه بار', amount: 4000, type: 'business', creditorId: akbar, creditorName: 'ترانسپورت اکبر', cashPaid: 0, creditAmount: 4000 })
    await ops.payExpenseCreditorGoods(akbar, [line(1, 1500)])
  })
  await page.reload()
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.getByRole('heading', { name: 'حساب‌ها' }).waitFor()

  // 1) the list: two groups, biggest first, one sentence and one colour per side; totals keep the sides apart
  const list = page.getByRole('region', { name: 'فهرست حساب‌ها' })
  const receive = list.getByRole('group', { name: 'باید بگیریم', exact: true })
  const pay = list.getByRole('group', { name: 'باید بدهیم', exact: true })
  assert.match(await text(receive), /احمد.*۵٬۰۰۰ ؋.*نبی.*۳٬۰۰۰ ؋/, 'receive group, biggest first')
  assert.match(await text(pay), /شیک.*۱۵٬۰۰۰ ؋.*گل لالا.*۱۲٬۲۰۰ ؋.*صراف حاجی.*۱۰٬۰۰۰ ؋.*ترانسپورت اکبر.*۲٬۵۰۰ ؋/, 'pay group, biggest first')
  const [rBox, pBox] = [await receive.boundingBox(), await pay.boundingBox()]
  assert.ok(rBox.y < pBox.y, 'what we should receive comes first')
  const summary = await text(page.locator('.summary-strip'))
  assert.match(summary, /در کل باید بگیریم ۸٬۰۰۰ ؋/)
  assert.match(summary, /در کل باید بدهیم ۳۹٬۷۰۰ ؋/)
  const row = (name) => list.getByRole('button', { name: new RegExp(name) })
  assert.equal(await colorOf(row('احمد').locator('strong').last()), await colorOf(row('نبی').locator('strong').last()), 'a customer and a lender who owe us are the same colour')
  assert.notEqual(await colorOf(row('احمد').locator('strong').last()), await colorOf(row('گل لالا').locator('strong').last()), 'owe us ≠ we owe')
  const old = /قرض ما به او|طلب ما از او|قرض مشتری به دکان|طلب مشتری از دکان|قرض مصرف|طلب دکان از او/
  assert.doesNotMatch(await text(page.locator('main')), old)

  // 2) every detail screen: the same sentence on top, no +/− on the rows, «بعد از این», and the same buttons
  const sheet = page.locator('dialog[open]')
  const open = async (name) => { await row(name).click(); await sheet.waitFor() }
  const close = async () => { await page.keyboard.press('Escape'); await sheet.waitFor({ state: 'detached' }) }
  const signs = /(^|\s)[+−]\s?[۰-۹]/
  const check = async (name, { head, buttons, after }) => {
    await open(name)
    const t = await text(sheet)
    assert.match(t, head, `${name}: headline`)
    assert.doesNotMatch(t, signs, `${name}: no +/− on the rows`)
    assert.doesNotMatch(t, old, `${name}: no old wording`)
    if (after) assert.match(t, after, `${name}: «بعد از این»`)
    for (const b of buttons) assert.ok(await sheet.getByRole('button', { name: b, exact: true }).isVisible(), `${name}: button «${b}»`)
    await close()
  }
  await check('احمد', { head: /باید بگیریم ۵٬۰۰۰ ؋/, buttons: ['پول گرفتیم'], after: /بعد از این: باید ۵٬۰۰۰ ؋ بگیریم/ })
  await check('شیک', { head: /باید بدهیم ۱۵٬۰۰۰ ؋/, buttons: ['پول دادیم'], after: /بعد از این: باید ۱۵٬۰۰۰ ؋ بدهیم/ })
  await check('صراف حاجی', { head: /باید بدهیم ۱۰٬۰۰۰ ؋/, buttons: ['پول دادیم'] })
  await check('گل لالا', { head: /باید بدهیم ۱۲٬۲۰۰ ؋/, buttons: ['پول گرفتیم', 'پول دادیم', 'کفش دادیم'], after: /بعد از این: باید ۱۲٬۲۰۰ ؋ بدهیم/ })
  await check('نبی', { head: /باید بگیریم ۳٬۰۰۰ ؋/, buttons: ['پول گرفتیم', 'پول دادیم', 'کفش دادیم'], after: /بعد از این: باید ۳٬۰۰۰ ؋ بگیریم/ })
  await check('ترانسپورت', { head: /باید بدهیم ۲٬۵۰۰ ؋/, buttons: ['پول دادیم', 'کفش دادیم'], after: /بعد از این: باید ۲٬۵۰۰ ؋ بدهیم/ })

  // 3) the sentence on a lender's screen is the same colour as the same side in the list
  await open('نبی')
  assert.equal(await colorOf(sheet.getByText('۳٬۰۰۰ ؋', { exact: true }).first()), await colorOf(row('احمد').locator('strong').last()), 'نبی owes us → same green as احمد')
  await close()

  // 4) readable in every display mode
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async (m) => (await import('/src/lib/displayMode.ts')).setDisplayMode(m), mode)
    await page.waitForTimeout(300)
    assert.deepEqual(await contrastFailures(page, 'main'), [], `accounts contrast in ${mode} mode`)
  }
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('light'))

  assert.deepEqual(errors, [])
  console.log('PASS accounts language: two groups, one sentence and colour per side, no signs, «بعد از این», the same buttons, all modes readable')
} finally {
  await app.close()
}
