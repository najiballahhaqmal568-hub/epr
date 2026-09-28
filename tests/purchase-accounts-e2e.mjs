// Supplier and sarraf directories: create above the list, every row action reachable, readable at 320px.
// Actual App, disposable IndexedDB, external requests blocked by localApp.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('dialog', d => d.accept())
const shots = '.superpowers/sdd/plan/task-8-screenshots'
mkdirSync(shots, { recursive: true })
const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const closeAll = async () => { while (await page.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await page.waitForTimeout(250) } }
const snapshot = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts')
  return JSON.stringify(await Promise.all(['suppliers', 'purchases', 'payments', 'cashMovements', 'returns'].map(t => db.table(t).toArray())))
})
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.suppliers.bulkAdd([
      { name: 'تأمین‌کنندهٔ قرضدار', phone: '0700111222', balance: 4200, createdAt: Date.now() },
      { name: 'تأمین‌کنندهٔ پیشکی', balance: -800, createdAt: Date.now() },
      { name: 'صراف آزمایشی', kind: 'sarraf', balance: 1500, createdAt: Date.now() }
    ])
  })
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.locator('summary', { hasText: 'افزودن و مدیریت حساب‌ها' }).click()
  await page.getByRole('button', { name: 'تأمین‌کنندگان', exact: true }).click()
  await page.getByRole('heading', { name: 'حساب‌های خرید' }).waitFor()
  assert.equal(await page.getByRole('group', { name: 'نوع حساب خرید' }).getByRole('button', { name: 'تأمین‌کنندگان' }).getAttribute('aria-pressed'), 'true')

  const list = page.getByRole('region', { name: 'فهرست تأمین‌کنندگان' })
  const add = page.getByRole('button', { name: '＋ تأمین‌کنندهٔ جدید' })
  assert.ok((await add.boundingBox()).y < (await list.boundingBox()).y, 'create button sits above the list')
  const debtor = list.locator('.customer-row').filter({ hasText: 'قرضدار' })
  assert.match(await debtor.innerText(), /قرض ما/)
  assert.match(await list.locator('.customer-row').filter({ hasText: 'پیشکی' }).first().innerText(), /طلب ما/)

  const before = await snapshot()
  for (const [label, open] of [
    ['new-supplier', () => add.click()],
    ['pay', () => debtor.getByRole('button', { name: 'پرداخت قرض', exact: true }).click()],
    ['return', () => debtor.getByRole('button', { name: 'مرجوعی جنس', exact: true }).click()],
    ['detail', () => debtor.getByRole('button', { name: /تأمین‌کنندهٔ قرضدار/ }).click()]
  ]) {
    await open()
    await page.locator('dialog[open]').last().waitFor()
    await closeAll()
    assert.ok(label)
  }
  assert.equal(await snapshot(), before, 'opening and closing supplier forms writes nothing')

  await page.getByRole('group', { name: 'نوع حساب خرید' }).getByRole('button', { name: 'صراف‌ها' }).click()
  const sarrafs = page.getByRole('region', { name: 'فهرست صراف‌ها' })
  await sarrafs.waitFor()
  assert.match(await sarrafs.innerText(), /صراف آزمایشی[\s\S]*قرض ما به صراف/)
  await sarrafs.getByRole('button', { name: 'پرداخت به صراف', exact: true }).click()
  await page.locator('dialog[open]').last().waitFor()
  await closeAll()
  assert.equal(await page.getByRole('button', { name: '＋ صراف جدید' }).count(), 1)

  await page.getByRole('group', { name: 'نوع حساب خرید' }).getByRole('button', { name: 'قرض‌دهنده‌ها' }).click()
  await page.getByRole('group', { name: 'نوع حساب خرید' }).getByRole('button', { name: 'تأمین‌کنندگان' }).click()
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(size => { document.documentElement.style.fontSize = size }, width === 320 ? '20px' : '')
    await settle()
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.left < -1 || r.right > innerWidth + 1) }).map(el => [el.tagName, el.className]))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `fits ${width}: ${JSON.stringify(overflow)}`)
    await page.screenshot({ path: `${shots}/suppliers-${width}.png`, fullPage: true })
  }
  assert.deepEqual(errors, [])
  console.log('PASS purchase accounts: create above list, pay/return/detail/new open without writes, sarraf tab, lenders reachable, 320–1440 fit')
} finally {
  await app.close()
}
