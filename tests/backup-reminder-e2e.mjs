// Backup reminder on the home screen: it appears only when there is something to protect and the last backup
// is old; the button really downloads a valid backup file; «بعداً» hides it until tomorrow; staff never see it.
// Synthetic data only; every external request is blocked by localApp.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'

const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const NOON = new Date(2026, 8, 29, 12, 0, 0)
const DAY = 86400000
const card = () => page.getByRole('region', { name: 'یادآوری بکاپ' })
const setting = (key) => page.evaluate(async (k) => (await (await import('/src/db.ts')).db.settings.get(k))?.value, key)

// «باید بیاید» یعنی صبر تا بیاید؛ «نباید بیاید» یعنی بعد از رسیدن داده‌های صفحه هنوز نیست
const expectCard = async () => { await card().waitFor() }
const expectNoCard = async () => {
  await page.getByRole('region', { name: 'پول شما کجاست' }).getByRole('button').first().waitFor()
  await page.waitForTimeout(700)
  assert.equal(await card().count(), 0, 'the backup card must not show')
}

async function reload(date = NOON) {
  await page.clock.setFixedTime(date)
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
}

try {
  await page.clock.setFixedTime(NOON)
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    await db.settings.bulkPut([
      { key: 'supaUrl', value: 'https://example.invalid' }, { key: 'supaKey', value: 'synthetic-test-key' },
      { key: 'cachedProfile', value: { user_id: 'synthetic-owner', shop_id: 'synthetic-shop', role: 'owner', name: 'مالک آزمایشی' } },
      { key: 'firstDayDone', value: true }, { key: 'homeMorningSkip', value: new Date(2026, 8, 29).getTime() }
    ])
    await db.cashMovements.add({ date: Date.now() - 5 * 86400000, type: 'capitalIn', amount: 5000, note: 'سرمایه' })
    const productId = await db.products.add({ name: 'کوهستان', createdAt: 1 })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 1000, retailPrice: 3000, wholesalePrice: 2500, lowStock: 2 })
    await ops.setOpeningStock(v, 10)
    const cat = await db.expenseCategories.add({ name: 'نان' })
    await ops.addExpense({ date: Date.now(), categoryId: cat, categoryName: 'نان', amount: 200, type: 'business' })
    await ops.addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', qty: 1, unitPrice: 3000 }], total: 3000, paid: 3000 })
  })

  // 1) Never backed up, two documents exist: the card says so, with the count.
  await reload()
  await card().waitFor()
  let text = (await card().innerText()).replace(/\s+/g, ' ')
  assert.match(text, /هنوز از حساب‌ها بکاپ نگرفته‌اید/)
  assert.match(text, /۲ سند ثبت شده است/) // the expense + the sale

  // 2) Readable in normal, sunlight and night mode.
  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async (m) => (await import('/src/lib/displayMode.ts')).setDisplayMode(m), mode)
    await page.waitForTimeout(450)
    assert.deepEqual(await contrastFailures(page, 'main'), [], `backup card contrast in ${mode} mode`)
  }
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('light'))

  // 3) The button really produces a valid backup file, records the time, and the card turns into a confirmation.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    card().getByRole('button', { name: 'بکاپ بگیر' }).click()
  ])
  assert.match(download.suggestedFilename(), /^shoe-erp-backup-\d{4}-\d{2}-\d{2}\.json$/)
  const file = JSON.parse(readFileSync(await download.path(), 'utf8'))
  assert.equal(file.app, 'shoeErp')
  assert.equal(file.data.sales.length, 1)
  assert.equal(file.data.expenses.length, 1)
  assert.equal(file.data.settings.some((r) => r.key === 'lastBackupAt'), false, 'the «last backup» time is not inside the backup')
  const confirm = page.getByRole('status', { name: 'بکاپ' })
  await confirm.waitFor()
  assert.match(await confirm.innerText(), /بکاپ آماده شد[\s\S]*جای امن/)
  const notedAt = await setting('lastBackupAt')
  assert.ok(Math.abs(notedAt - NOON.getTime()) < 5000, `lastBackupAt is now (${notedAt})`)
  await reload()
  await expectNoCard() // nothing new to protect right after a backup

  // 4) Ten days on with a new document: «۱۰ روز از آخرین بکاپ گذشته … ۱ سند تازه»; a fresh shop with no new document stays quiet.
  const later = new Date(NOON.getTime() + 10 * DAY)
  await page.clock.setFixedTime(later) // the new document is written ten days after the backup
  await page.evaluate(async (at) => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    const cat = (await db.expenseCategories.toArray())[0]
    await ops.addExpense({ date: at, categoryId: cat.id, categoryName: cat.name, amount: 100, type: 'business' })
  }, later.getTime())
  await reload(later)
  await expectCard()
  text = (await card().innerText()).replace(/\s+/g, ' ')
  assert.match(text, /۱۰ روز از آخرین بکاپ گذشته/)
  assert.match(text, /از آن وقت ۱ سند تازه ثبت شده/)

  // 5) «بعداً» hides it for the rest of the day, remembered across a reload; it returns the next day.
  await card().getByRole('button', { name: 'بعداً' }).click()
  await card().waitFor({ state: 'detached' })
  await reload(later)
  await expectNoCard()
  await reload(new Date(later.getTime() + DAY))
  await expectCard() // back tomorrow

  // 6) The last-backup time is shown in Settings.
  await page.locator('nav').getByRole('button', { name: 'بیشتر', exact: true }).click()
  await page.getByRole('button', { name: /^بکاپ و بازیابی/ }).click()
  await page.getByText(/آخرین بکاپ: ۷ میزان ۱۴۰۵/).waitFor()

  // 7) Staff never see it.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.settings.put({ key: 'cachedProfile', value: { user_id: 'synthetic-staff', shop_id: 'synthetic-shop', role: 'staff', name: 'کارگر آزمایشی' } })
  })
  await reload(new Date(later.getTime() + DAY)).catch(() => undefined)
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
  await page.waitForTimeout(700)
  assert.equal(await card().count(), 0)

  assert.deepEqual(errors, [])
  console.log('PASS backup reminder: only when something is unprotected and the backup is old, real download, snooze until tomorrow, last backup shown, staff excluded, readable in all modes')
} finally {
  await app.close()
}
