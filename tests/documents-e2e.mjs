// Documents as receipts: who saved it (from the signed-in profile), the history of a sale (return with
// reason), an expense correction with its reason, and the branded receipt image. Synthetic profile;
// every external request is blocked by localApp. Actual App, disposable IndexedDB.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/documents-screenshots'
mkdirSync(shots, { recursive: true })
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.settings.bulkPut([
      { key: 'supaUrl', value: 'https://example.invalid' },
      { key: 'supaKey', value: 'synthetic-test-key' },
      { key: 'cachedProfile', value: { user_id: 'synthetic-owner', shop_id: 'synthetic-shop', role: 'owner', name: 'مالک آزمایشی' } }
    ])
  })
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { setOpeningStock, addSale, addCustomerReturn, addExpense, correctExpense } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 500, retailPrice: 900, wholesalePrice: 800 })
    await setOpeningStock(v, 5)
    const c = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: Date.now() })
    const line = { variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', unitPrice: 900 }
    const saleId = await addSale({ date: Date.now() - 60000, customerId: c, customerName: 'احمد', saleType: 'retail', lines: [{ ...line, qty: 2 }], total: 1800, paid: 800 })
    await addCustomerReturn({ date: Date.now(), kind: 'customer', partyId: c, partyName: 'احمد', refId: saleId, saleType: 'retail', lines: [{ ...line, qty: 1, restock: true }], reason: 'اندازه خورد نبود', settlement: 'reduceDebt', amount: 900 })
    await db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount: 5000, note: 'آزمایش' })
    const catId = await db.expenseCategories.add({ name: 'ترانسپورت' })
    const expId = await addExpense({ date: Date.now(), categoryId: catId, categoryName: 'ترانسپورت', amount: 300, type: 'business' })
    await correctExpense(expId, { date: Date.now(), amount: 350, cashPaid: 350, reason: 'رقم رسید اشتباه خوانده شد' })
    const { addPayment, correctCustomerPayment, addOpeningDebt } = await import('/src/lib/ops.ts')
    const sup = await db.suppliers.add({ name: 'تأمین‌کنندهٔ آزمایشی', kind: 'supplier', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('supplier', sup, 'تأمین‌کنندهٔ آزمایشی', 3000, 'قرض قبلی')
    await addPayment({ date: Date.now(), partyType: 'supplier', partyId: sup, partyName: 'تأمین‌کنندهٔ آزمایشی', amount: 1000, via: 'cash' })
    const payId = await addPayment({ date: Date.now() - 30000, partyType: 'customer', partyId: c, partyName: 'احمد', amount: 2000 })
    await correctCustomerPayment(payId, { date: Date.now() - 30000, amount: 1500, reason: 'مشتری ۱٬۵۰۰ داده بود' })
    window.saved = { sale: await db.sales.get(saleId), ret: (await db.returns.toArray())[0] }
  })
  const saved = await page.evaluate(() => window.saved)
  assert.equal(saved.sale.by, 'مالک آزمایشی', 'sale carries who saved it')
  assert.equal(saved.ret.by, 'مالک آزمایشی')

  // 1) Sale detail: a paper receipt with its history underneath.
  await page.locator('nav').getByRole('button', { name: 'فروش', exact: true }).click()
  await page.getByRole('button', { name: 'تاریخچه', exact: true }).click()
  await page.getByRole('button', { name: /جزئیات فروش احمد/ }).first().click()
  const detail = page.getByRole('dialog', { name: /جزئیات فروش/ })
  assert.match(await detail.locator('.doc-paper-brand').innerText(), /اتل[\s\S]*سند فروش/)
  const history = detail.getByRole('region', { name: 'تاریخچهٔ این سند' })
  await history.getByText('مرجوعی', { exact: true }).waitFor()
  assert.match((await history.innerText()).replace(/\s+/g, ' '), /فروش ثبت شد ۲ جوړه · نقد ۸۰۰ ؋ و قرض ۱٬۰۰۰ ؋ .* · مالک آزمایشی مرجوعی ۱ جوړه — ۹۰۰ ؋ — دلیل: اندازه خورد نبود .* · مالک آزمایشی/)
  await page.screenshot({ path: `${shots}/sale-detail-390.png`, fullPage: true })

  // 2) Branded receipt image: light margin, «اتل» mark, receipt code.
  await detail.getByRole('button', { name: 'رسید', exact: true }).click()
  const img = page.getByRole('dialog', { name: 'رسید فروش' }).getByRole('img', { name: 'رسید' })
  await img.waitFor()
  const pixels = await img.evaluate(async el => {
    await el.decode()
    const c = document.createElement('canvas'); c.width = el.naturalWidth; c.height = el.naturalHeight
    const x = c.getContext('2d'); x.drawImage(el, 0, 0)
    const at = (px, py) => [...x.getImageData(px, py, 1, 1).data].slice(0, 3).join(',')
    return { width: el.naturalWidth, margin: at(4, 4), header: at(40, 40), paper: at(40, 300) }
  })
  assert.deepEqual(pixels, { width: 676, margin: '237,237,240', header: '0,102,214', paper: '255,255,255' })
  await page.screenshot({ path: `${shots}/receipt-390.png`, fullPage: true })
  await page.keyboard.press('Escape')

  // 3) Customer ledger: a corrected receipt shows first amount, who, and the correction with its reason.
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'احمد' }).first().click()
  await page.getByRole('button', { name: /^تاریخچهٔ دریافت/ }).first().click()
  const payHistory = page.getByRole('region', { name: 'تاریخچهٔ این سند' }).first()
  assert.match((await payHistory.innerText()).replace(/\s+/g, ' '), /پول دریافت شد ۲٬۰۰۰ ؋ .* · مالک آزمایشی اصلاح شد ۲٬۰۰۰ ؋ ← ۱٬۵۰۰ ؋ — دلیل: مشتری ۱٬۵۰۰ داده بود .* · مالک آزمایشی/)
  await page.screenshot({ path: `${shots}/payment-history-390.png`, fullPage: true })
  await page.keyboard.press('Escape')

  // Supplier account: the payment's history names who paid it.
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'تأمین‌کنندهٔ آزمایشی' }).first().click()
  await page.getByRole('button', { name: /^تاریخچهٔ پرداخت نقدی/ }).first().click()
  assert.match((await page.getByRole('region', { name: 'تاریخچهٔ این سند' }).first().innerText()).replace(/\s+/g, ' '), /پول پرداخت شد ۱٬۰۰۰ ؋ .* · مالک آزمایشی/)
  await page.keyboard.press('Escape')

  // 4) Expense correction: the replacement says what it replaced and why.
  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button').filter({ hasText: 'مصارف و صندوق' }).first().click()
  await page.getByRole('button', { name: 'جزئیات ترانسپورت' }).first().click()
  const exp = page.getByRole('dialog', { name: 'جزئیات مصرف' }).getByRole('region', { name: 'تاریخچهٔ این سند' })
  assert.match((await exp.innerText()).replace(/\s+/g, ' '), /مصرف ثبت شد \(به جای سند اشتباه\) ۳۵۰ ؋ · ترانسپورت — دلیل: رقم رسید اشتباه خوانده شد .* · مالک آزمایشی/)
  assert.deepEqual(errors, [])
  console.log('PASS documents: who saved it, sale history with return reason, expense correction reason, branded receipt image')
} finally {
  await app.close()
}
