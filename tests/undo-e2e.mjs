// «برگرداندن» ۱۰ ثانیه‌ای: دریافت از مشتری، پرداخت به فروشنده و مصرف — از خود صفحه‌ها.
// Actual App, disposable IndexedDB, external requests blocked by localApp.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
mkdirSync('.superpowers/sdd/plan/undo-screenshots', { recursive: true })
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { addOpeningDebt } = await import('/src/lib/ops.ts')
    window.customerId = await db.customers.add({ name: 'مشتری آزمایشی', type: 'retail', balance: 0, createdAt: Date.now() })
    window.supplierId = await db.suppliers.add({ name: 'فروشنده آزمایشی', kind: 'supplier', balance: 0, createdAt: Date.now() })
    await addOpeningDebt('customer', window.customerId, 'مشتری آزمایشی', 5000, 'قرض قبلی')
    await addOpeningDebt('supplier', window.supplierId, 'فروشنده آزمایشی', 4000, 'قرض قبلی')
    await db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount: 10000, note: 'سرمایهٔ آزمایشی' })
    window.state = async () => {
      const { cashBalance } = await import('/src/lib/ops.ts')
      const { runIntegrityCheck } = await import('/src/lib/integrity.ts')
      return {
        customer: (await db.customers.get(window.customerId)).balance,
        supplier: (await db.suppliers.get(window.supplierId)).balance,
        cash: await cashBalance('دکان'),
        livePayments: (await db.payments.toArray()).filter(p => !p.deleted && p.amount > 0).length,
        liveExpenses: (await db.expenses.toArray()).filter(e => !e.deleted).length,
        mismatches: (await runIntegrityCheck()).mismatches.length
      }
    }
  })
  const state = () => page.evaluate(() => window.state())
  assert.deepEqual(await state(), { customer: 5000, supplier: 4000, cash: 10000, livePayments: 0, liveExpenses: 0, mismatches: 0 })
  const toast = page.locator('.undo-toast')
  const nav = name => page.locator('nav').getByRole('button', { name, exact: true }).click()

  // 1) Customer receipt → undo within 10 s restores debt and till exactly.
  await nav('حساب‌ها')
  await page.getByRole('button', { name: /مشتری آزمایشی/ }).click()
  const account = page.getByRole('dialog', { name: 'حساب مشتری آزمایشی' })
  await account.getByRole('button', { name: 'دریافت پول', exact: true }).click()
  await account.locator('label', { hasText: 'مبلغ دریافتی' }).locator('input').fill('2000')
  await account.getByRole('button', { name: 'ثبت دریافت', exact: true }).click()
  await toast.getByText('دریافت ۲٬۰۰۰ ؋ از مشتری آزمایشی ثبت شد').waitFor()
  assert.deepEqual(await state(), { customer: 3000, supplier: 4000, cash: 12000, livePayments: 1, liveExpenses: 0, mismatches: 0 })
  await page.screenshot({ path: '.superpowers/sdd/plan/undo-screenshots/receipt-390.png' })
  // Visible means on top: the element under the bar's centre must belong to the bar, even with the account window open.
  const onTop = async () => page.evaluate(() => { const bar = document.querySelector('.undo-toast'); const r = bar.getBoundingClientRect(); return bar.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)) })
  assert.equal(await onTop(), true, 'undo bar is visible above an open window')
  await toast.getByRole('button', { name: /^برگرداندن/ }).evaluate(button => { button.click(); button.click() })
  await toast.getByText(/برگردانده شد/).waitFor()
  assert.deepEqual(await state(), { customer: 5000, supplier: 4000, cash: 10000, livePayments: 0, liveExpenses: 0, mismatches: 0 })
  const tombstone = await page.evaluate(async () => (await (await import('/src/db.ts')).db.payments.toArray()).filter(p => p.amount === 2000).map(p => p.deleted))
  assert.deepEqual(tombstone, [true], 'undone receipt stays as an audit record')

  // 2) After 10 s the offer is gone and the receipt stays.
  await account.getByRole('button', { name: 'دریافت پول', exact: true }).click()
  await account.locator('label', { hasText: 'مبلغ دریافتی' }).locator('input').fill('1000')
  await account.getByRole('button', { name: 'ثبت دریافت', exact: true }).click()
  await toast.getByRole('button', { name: /^برگرداندن/ }).waitFor()
  await page.waitForTimeout(10_600)
  assert.equal(await toast.getByRole('button', { name: /^برگرداندن/ }).count(), 0, 'offer expires after 10 seconds')
  assert.deepEqual(await state(), { customer: 4000, supplier: 4000, cash: 11000, livePayments: 1, liveExpenses: 0, mismatches: 0 })
  await page.keyboard.press('Escape')
  await account.waitFor({ state: 'detached' })

  // 3) Supplier payment → undo.
  await page.locator('summary', { hasText: 'افزودن و مدیریت حساب‌ها' }).click()
  await page.getByRole('button', { name: 'تأمین‌کنندگان', exact: true }).click()
  await page.getByRole('region', { name: 'فهرست تأمین‌کنندگان' }).getByRole('button', { name: 'پرداخت قرض', exact: true }).click()
  const pay = page.locator('dialog[open]').last()
  await pay.locator('label', { hasText: 'مبلغ' }).first().locator('input').fill('1500')
  await pay.getByRole('button', { name: 'ثبت پرداخت', exact: true }).click()
  await toast.getByText('پرداخت ۱٬۵۰۰ ؋ به فروشنده آزمایشی ثبت شد').waitFor()
  assert.deepEqual(await state(), { customer: 4000, supplier: 2500, cash: 9500, livePayments: 2, liveExpenses: 0, mismatches: 0 })
  await toast.getByRole('button', { name: /^برگرداندن/ }).click()
  await toast.getByText(/برگردانده شد/).waitFor()
  assert.deepEqual(await state(), { customer: 4000, supplier: 4000, cash: 11000, livePayments: 1, liveExpenses: 0, mismatches: 0 })

  // 4) Expense → undo.
  await nav('خانه')
  await page.getByRole('button', { name: /مصرف جدید/ }).click()
  await page.locator('label:has-text("کتگوری *") select').selectOption({ index: 1 })
  await page.locator('label:has-text("مبلغ *") input').first().fill('300')
  await page.click('button:text-is("ذخیره")')
  await toast.getByText(/مصرف ۳۰۰ ؋ .* ثبت شد/).waitFor()
  await page.waitForTimeout(400)
  const freeBox = await toast.boundingBox(), navBox = await page.locator('.app-nav').boundingBox()
  assert.ok(freeBox.y + freeBox.height <= navBox.y + 1, 'without a window the bar stays above the bottom menu')
  assert.deepEqual(await state(), { customer: 4000, supplier: 4000, cash: 10700, livePayments: 1, liveExpenses: 1, mismatches: 0 })
  await toast.getByRole('button', { name: /^برگرداندن/ }).click()
  await toast.getByText(/برگردانده شد/).waitFor()
  assert.deepEqual(await state(), { customer: 4000, supplier: 4000, cash: 11000, livePayments: 1, liveExpenses: 0, mismatches: 0 })

  // 5) The bar stays readable and inside the screen on the smallest phone with large text.
  await nav('حساب‌ها')
  await page.getByRole('button', { name: /مشتری آزمایشی/ }).click()
  await account.getByRole('button', { name: 'دریافت پول', exact: true }).click()
  await account.locator('label', { hasText: 'مبلغ دریافتی' }).locator('input').fill('100')
  await account.getByRole('button', { name: 'ثبت دریافت', exact: true }).click()
  await page.setViewportSize({ width: 320, height: 700 })
  await page.evaluate(() => document.documentElement.style.fontSize = '20px')
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const box = await toast.boundingBox()
  assert.ok(box.x >= 0 && box.x + box.width <= 320, 'undo bar fits 320px')
  // A window is open: the bar sits at the bottom of that window (the menu is behind the window).
  const windowBox = await page.locator('dialog[open]').last().boundingBox()
  assert.ok(box.y >= windowBox.y && box.y + box.height <= windowBox.y + windowBox.height + 1, 'undo bar stays inside the open window')
  assert.equal(await onTop(), true, 'undo bar visible at 320px')
  await page.screenshot({ path: '.superpowers/sdd/plan/undo-screenshots/receipt-320.png' })
  assert.deepEqual(errors, [])
  console.log('PASS undo: receipt, supplier payment and expense undo exactly within 10 s, expiry keeps the record, double tap once, 320px above menu')
} finally {
  await app.close()
}
