// New home screen (hero by time of day, quick actions, «پول شما کجاست», recent sales, 5-tab nav with the sell
// button in the middle). Synthetic data only; every external request is blocked by localApp.
// Numbers are worked out by hand in the comments so a wrong screen cannot pass by accident.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'

const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const at = (h, m = 0) => new Date(2026, 8, 29, h, m, 0) // 29 Sep 2026 = 7 Mizan 1405 (month started 23 Sep)

// AA contrast of everything on the home, in normal, sunlight and night mode (a flash or a card that dips below 4.5:1 fails here)
async function assertReadableInAllModes(label) {
  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async (m) => (await import('/src/lib/displayMode.ts')).setDisplayMode(m), mode)
    await page.waitForTimeout(450)
    assert.deepEqual(await contrastFailures(page, 'main'), [], `${label} contrast in ${mode} mode`)
  }
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('light'))
}

async function reloadAt(date) {
  await page.clock.setFixedTime(date)
  await page.goto(origin, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
}
const text = async (locator) => (await locator.innerText()).replace(/\s+/g, ' ')

try {
  await page.clock.setFixedTime(at(14, 30))
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const ops = await import('/src/lib/ops.ts')
    await db.settings.bulkPut([
      { key: 'supaUrl', value: 'https://example.invalid' },
      { key: 'supaKey', value: 'synthetic-test-key' },
      { key: 'cachedProfile', value: { user_id: 'synthetic-owner', shop_id: 'synthetic-shop', role: 'owner', name: 'مالک آزمایشی' } },
      { key: 'firstDayDone', value: true }
    ])
    const t = (h, m = 0) => new Date(2026, 8, 29, h, m, 0).getTime()
    const yesterday = new Date(2026, 8, 28, 10, 0, 0).getTime()
    await db.cashMovements.add({ date: yesterday - 86400000, type: 'capitalIn', amount: 2000, note: 'سرمایه' })
    const a = await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, createdAt: 1 })
    const b = await db.customers.add({ name: 'بصیر', type: 'retail', balance: 0, createdAt: 1 })
    await ops.addOpeningDebt('customer', a, 'احمد', 30000, 'قرض قبلی')
    await ops.addOpeningDebt('customer', b, 'بصیر', 3000, 'قرض قبلی')
    const s = await db.suppliers.add({ name: 'شیک', kind: 'supplier', balance: 0, createdAt: 1 })
    await ops.addOpeningDebt('supplier', s, 'شیک', 4000, 'قرض قبلی')
    await db.suppliers.add({ name: 'گل لالا', kind: 'lender', balance: 2000, createdAt: 1 })
    const productId = await db.products.add({ name: 'کوهستان', createdAt: 1 })
    const v = await db.variants.add({ productId, size: '40', color: 'سیاه', stockQty: 0, purchasePrice: 1000, retailPrice: 3000, wholesalePrice: 2500, lowStock: 2 })
    await ops.setOpeningStock(v, 50)
    const c1 = await db.expenseCategories.add({ name: 'کسر صندوق' })
    const c2 = await db.expenseCategories.add({ name: 'ترانسپورت' })
    await ops.addExpense({ date: yesterday, categoryId: c1, categoryName: 'کسر صندوق', amount: 600, type: 'business' })
    await ops.addExpense({ date: yesterday, categoryId: c2, categoryName: 'ترانسپورت', amount: 400, type: 'business' })
    const line = { variantId: v, productName: 'کوهستان', size: '40', color: 'سیاه', unitPrice: 3000 }
    await ops.addSale({ date: t(12), saleType: 'retail', lines: [{ ...line, qty: 1 }], total: 3000, paid: 3000 })
    await ops.addSale({ date: t(13), customerId: a, customerName: 'احمد', saleType: 'retail', lines: [{ ...line, qty: 2 }], total: 6000, paid: 1000 })
    await ops.addSale({ date: t(14), saleType: 'retail', lines: [{ ...line, qty: 1 }], total: 3000, paid: 3000 })
  })
  await reloadAt(at(14, 30))

  // ── 1) Day state: the month is the headline ───────────────────────────────
  // profit 4 pairs × 2,000 = 8,000; expenses 600 + 400 = 1,000; net 7,000
  const hero = page.getByRole('region', { name: 'سرخط امروز' })
  await hero.getByRole('button', { name: 'مفاد خالص این ماه ‎۷٬۰۰۰ ؋ — از کجا آمد' }).or(hero.getByRole('button', { name: /مفاد خالص این ماه .*۷٬۰۰۰ ؋ — از کجا آمد/ })).waitFor()
  const heroText = await text(hero)
  assert.match(heroText, /▲ ۷٬۰۰۰ ؋ مفاد/)
  assert.match(heroText, /مفاد فروش ۸٬۰۰۰ ؋/)
  assert.match(heroText, /مصرف ۱٬۰۰۰ ؋/)
  assert.match(heroText, /بزرگ‌ترین مصرف این ماه «کسر صندوق» است \(۶۰۰ ؋\)/)
  assert.doesNotMatch(heroText, /صبح بخیر|روز را ببندید/)

  // today strip: sales 3,000 + 6,000 + 3,000 = 12,000; 4 pairs; cash 3,000 + 1,000 + 3,000 = 7,000
  const strip = page.getByRole('button', { name: 'فروش امروز ۱۲٬۰۰۰ ؋ — از کجا آمد' })
  const stripText = await text(strip)
  assert.match(stripText, /۱۲٬۰۰۰ ؋/)
  assert.match(stripText, /جوړه ۴/)
  assert.match(stripText, /نقد فروش ۷٬۰۰۰ ؋/)
  assert.match(stripText, /مفاد: ۸٬۰۰۰ ؋/) // today's profit: 4 pairs × 2,000

  await assertReadableInAllModes('month card')

  // ── 2) «پول شما کجاست»: same numbers as the accounts, one scale ────────────
  // cash 2,000 − 1,000 + 7,000 = 8,000; receivables 30,000 + 3,000 + 5,000 = 38,000
  const map = page.getByRole('region', { name: 'پول شما کجاست' })
  const row = (name) => map.getByRole('button', { name: new RegExp(`^${name} .*— از کجا آمد$`) })
  assert.match(await text(row('صندوق')), /۸٬۰۰۰ ؋/)
  assert.match(await text(row('طلب از مشتریان')), /۳۸٬۰۰۰ ؋.*۲ مشتری|۲ مشتری.*۳۸٬۰۰۰ ؋/)
  assert.match(await text(row('قرض ما — تأمین‌کنندگان')), /۴٬۰۰۰ ؋/)
  assert.match(await text(row('قرض ما — اشخاص')), /۲٬۰۰۰ ؋/)
  assert.match(await text(map), /حدود ۵ برابر نقد صندوق/) // 38,000 / 8,000 = 4.75 → 5
  const widths = await map.locator('span[style*="width"]').evaluateAll((els) => els.map((el) => el.style.width))
  // bars share one scale (largest = receivables = 100%): cash 8,000/38,000 = 21.1%, suppliers 10.5%, lenders 5.3%
  // (the browser rounds a style width to six digits, so compare numbers, not strings)
  const expected = [(8000 / 38000) * 100, 100, (4000 / 38000) * 100, (2000 / 38000) * 100]
  assert.equal(widths.length, 4, `bars: ${widths}`)
  widths.forEach((w, i) => assert.ok(Math.abs(parseFloat(w) - expected[i]) < 0.001, `bar ${i}: ${w} vs ${expected[i]}`))

  // ── 3) Recent sales: newest first, one tap opens the sale ─────────────────
  const recent = page.getByRole('region', { name: 'فروش‌های آخر' })
  const rows = await recent.getByRole('button', { name: /^جزئیات فروش/ }).allInnerTexts()
  assert.equal(rows.length, 3)
  assert.match(rows[0].replace(/\s+/g, ' '), /۱۴:۰۰/)
  assert.match(rows[1].replace(/\s+/g, ' '), /۱۳:۰۰.*احمد.*۲ جوړه.*۶٬۰۰۰ ؋.*قرض ۵٬۰۰۰ ؋/)
  assert.match(rows[2].replace(/\s+/g, ' '), /۱۲:۰۰/)
  await recent.getByRole('button', { name: /^جزئیات فروش احمد/ }).click()
  const detail = page.getByRole('dialog', { name: /جزئیات فروش/ })
  await detail.waitFor()
  const detailText = await text(detail)
  assert.match(detailText, /احمد/)
  assert.match(detailText, /قرض ۵٬۰۰۰ ؋/)
  assert.ok(await detail.getByRole('button', { name: 'مرجوعی', exact: true }).isVisible(), 'return button is on the opened sale')
  await page.keyboard.press('Escape')

  // ── 4) Navigation: five tabs, «فروش» in the middle and raised ─────────────
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
  const names = await page.locator('nav.app-nav > button').allInnerTexts()
  assert.deepEqual(names.map((n) => n.trim()), ['خانه', 'حساب‌ها', 'فروش', 'گدام', 'بیشتر'])
  const sell = page.locator('nav.app-nav .app-nav-sell')
  const box = await sell.boundingBox()
  const navBox = await page.locator('nav.app-nav').boundingBox()
  assert.ok(Math.abs(box.x + box.width / 2 - 195) <= 6, `sell button is centred (${box.x + box.width / 2})`)
  assert.ok(box.y < navBox.y, 'sell button rises above the bar')
  assert.ok(box.width >= 64 && box.height >= 64, 'sell button is a big thumb target')
  await page.locator('nav').getByRole('button', { name: 'گدام', exact: true }).click()
  await page.getByRole('heading', { name: /گدام/ }).first().waitFor()
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()

  // ── 5) Receive money from the home screen ─────────────────────────────────
  await page.getByRole('button', { name: 'دریافت پول از مشتری' }).click()
  const picker = page.getByRole('dialog', { name: 'از کدام مشتری پول گرفتید؟' })
  await picker.getByRole('button', { name: /احمد/ }).waitFor() // the list is read from the database first
  const order = (await picker.getByRole('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  assert.match(order.find((t) => t.includes('احمد')) ?? '', /قرض ۳۵٬۰۰۰ ؋/) // 30,000 + 5,000 from today's sale
  assert.ok(order.findIndex((t) => t.includes('احمد')) < order.findIndex((t) => t.includes('بصیر')), 'biggest debt first')
  await picker.getByLabel('جستجوی مشتری').fill('بصیر')
  assert.equal(await picker.getByRole('button', { name: /احمد/ }).count(), 0, 'search filters the list')
  await picker.getByRole('button', { name: /بصیر/ }).click()
  const account = page.getByRole('dialog', { name: 'حساب بصیر' })
  await account.getByLabel('مبلغ دریافتی').fill('1000') // the form is already open
  await account.getByRole('button', { name: 'ثبت دریافت', exact: true }).dblclick() // a double tap must still make ONE payment
  await page.waitForTimeout(500)
  const after = await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const payments = (await db.payments.toArray()).filter((p) => !p.deleted && p.amount === 1000)
    const bassir = (await db.customers.toArray()).find((c) => c.name === 'بصیر')
    const cash = (await db.cashMovements.toArray()).filter((m) => !m.deleted).reduce((sum, m) => sum + m.amount, 0)
    return { payments: payments.length, balance: bassir.balance, cash }
  })
  assert.deepEqual(after, { payments: 1, balance: 2000, cash: 9000 }) // 3,000 − 1,000; cash 8,000 + 1,000
  await page.keyboard.press('Escape')

  // ── 6) Quick action «شمارش نقد» opens the count window itself ─────────────
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.getByRole('button', { name: 'شمارش نقد صندوق' }).click()
  await page.getByRole('dialog', { name: /تصفیه/ }).waitFor()
  await page.keyboard.press('Escape')

  // ── 7) Morning: a separate card asks for the till count; the month card never hides ──
  await reloadAt(at(10, 0))
  const prompt = page.getByRole('region', { name: 'پیام این ساعت' })
  await prompt.getByText('صبح بخیر', { exact: true }).waitFor()
  assert.match(await text(prompt), /در اپ باید ‎?۹٬۰۰۰ ؋ باشد/)
  assert.doesNotMatch(await text(prompt), /پیش از اولین فروش/, 'sales already exist today, so no «before the first sale»')
  await page.getByRole('region', { name: 'سرخط امروز' }).getByRole('button', { name: /مفاد خالص این ماه/ }).waitFor() // month still visible
  await assertReadableInAllModes('morning card')
  await prompt.getByRole('button', { name: 'شمارش صندوق' }).click()
  await page.getByRole('dialog', { name: /تصفیه/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.getByRole('region', { name: 'پیام این ساعت' }).getByRole('button', { name: 'بعداً' }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="پیام این ساعت"]'))
  await reloadAt(at(10, 30)) // «بعداً» is remembered for today
  await page.getByRole('region', { name: 'سرخط امروز' }).waitFor()
  assert.equal(await page.getByRole('region', { name: 'پیام این ساعت' }).count(), 0)

  // ── 8) Evening: close the day (the stamp); the card goes away, the month stays ──
  await reloadAt(at(19, 0))
  const evening = page.getByRole('region', { name: 'پیام این ساعت' })
  await evening.getByText('روز را ببندید', { exact: true }).waitFor()
  await page.getByRole('region', { name: 'سرخط امروز' }).getByRole('button', { name: /مفاد خالص این ماه/ }).waitFor()
  await assertReadableInAllModes('evening card')
  await evening.getByRole('button', { name: 'بستن روز' }).click()
  const closing = page.getByRole('dialog', { name: /بستن روز|خلاصه/ })
  await closing.getByRole('button', { name: /روز بسته شد/ }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="پیام این ساعت"]'), null, { timeout: 6000 })

  // ── 9) Staff: today's sales only, no profit anywhere on the card ──────────
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.settings.put({ key: 'cachedProfile', value: { user_id: 'synthetic-staff', shop_id: 'synthetic-shop', role: 'staff', name: 'کارگر آزمایشی' } })
  })
  await reloadAt(at(14, 30)).catch(() => undefined)
  await page.locator('nav').getByRole('button', { name: 'خانه', exact: true }).click()
  await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
  const staffHero = page.getByRole('region', { name: 'سرخط امروز' })
  await staffHero.getByRole('button', { name: 'فروش امروز ۱۲٬۰۰۰ ؋ — از کجا آمد' }).waitFor()
  assert.doesNotMatch(await text(staffHero), /مفاد|زیان|مصرف/)
  assert.equal(await page.getByRole('region', { name: 'امروز تا حالا' }).count(), 0)

  assert.deepEqual(errors, [])
  console.log('PASS home: hero by time of day, month numbers, money map on one scale, recent sales open the sale, 5-tab nav with raised sell button, receive money, count till, close day, staff view')
} finally {
  await app.close()
}
