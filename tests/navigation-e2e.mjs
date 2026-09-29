import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { localApp, businessSnapshot } from './local-app.mjs'

// Catches wrong default/active mapping, lost secondary routes and navigation writes.
const app = await localApp()
const { page } = app
const nav = name => page.getByRole('navigation').getByRole('button', { name, exact: true })
const active = async name => assert.equal(await nav(name).getAttribute('aria-current'), 'page')
const heading = name => page.getByRole('heading', { name, exact: true }).waitFor()
try {
  await heading('خانه')
  assert.deepEqual(await page.locator('.app-nav button').allTextContents(), ['خانه', 'حساب‌ها', 'فروش', 'گدام', 'بیشتر'])
  await active('خانه')
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { addSale } = await import('/src/lib/ops.ts')
    const productId = await db.products.add({ name: 'بوت کوهستان آزمایشی', createdAt: Date.now() })
    const variantId = await db.variants.add({ productId, size: '42', color: 'سیاه', stockQty: 1000, purchasePrice: 1000, retailPrice: 1500, wholesalePrice: 1400, lowStock: 2 })
    await addSale({ date: Date.now(), saleType: 'retail', lines: [{ variantId, productName: 'بوت کوهستان آزمایشی', size: '42', color: 'سیاه', qty: 825, unitPrice: 1500 }], total: 1237500, paid: 1237500 })
  })
  const before = await businessSnapshot(page)
  await nav('فروش').click(); await heading('میز فروش'); await active('فروش')
  await nav('حساب‌ها').click(); await heading('حساب‌ها'); await active('حساب‌ها')
  for (const [label, title, selected] of [['مشتریان', 'مشتریان', 'حساب‌ها'], ['تأمین‌کنندگان', 'حساب‌های خرید', 'حساب‌ها'], ['صراف‌ها', 'حساب‌های خرید', 'حساب‌ها'], ['قرض‌دهندگان', 'حساب‌های خرید', 'حساب‌ها'], ['طلبکاران مصارف', 'پول و مصارف', 'بیشتر']]) {
    await nav('حساب‌ها').click()
    const details = page.locator('details').first()
    if (!await details.getAttribute('open').then(v => v !== null)) await details.locator('summary').click()
    await page.getByRole('button', { name: label, exact: true }).click()
    await heading(title); await active(selected)
    assert.equal(await page.locator('dialog[open]').count(), 0)
  }
  await nav('بیشتر').click(); await heading('بیشتر')
  assert.deepEqual((await page.locator('.management-row').allTextContents()).slice(0, 3).map(t => t.split('\n').join('')), [
    'گدام و خریدموجودی و سفارش مجدد', 'خریدهااسناد و تاریخچهٔ خرید', 'مصارف و صندوقمصارف روزانه، کتگوری‌ها و صندوق'
  ])
  // «گدام» is a tab of its own: the stock pages (and purchases opened from them) light it, not «بیشتر»
  for (const [label, title, selected] of [['گدام و خرید', 'گدام و خرید', 'گدام'], ['خریدها', 'خرید', 'گدام'], ['مصارف و صندوق', 'پول و مصارف', 'بیشتر']]) {
    await nav('بیشتر').click()
    await page.getByRole('button', { name: new RegExp('^' + label) }).click()
    await heading(title); await active(selected)
    assert.equal(await page.locator('dialog[open]').count(), 0, `${label} must be history, not a form`)
    assert.equal(await page.locator('.sync-status').count(), 1)
  }
  await nav('خانه').click(); await heading('خانه')
  for (const label of ['همگام‌سازی و حساب کاربری', 'بکاپ و بازیابی', 'یادآوری‌ها', 'تنظیمات اپ', 'شروع سال مالی', 'کنترل حساب‌ها', 'منطقهٔ خطر']) {
    await nav('بیشتر').click()
    if (['شروع سال مالی', 'کنترل حساب‌ها', 'منطقهٔ خطر'].includes(label)) await page.getByText('تنظیمات پیشرفته', { exact: true }).click()
    await page.getByRole('button', { name: new RegExp('^' + label) }).click()
    await heading(label); await active('بیشتر')
    assert.equal(await page.locator('.sync-status').count(), 1)
  }
  await nav('خانه').click()
  await page.locator('.sync-status').click()
  await heading('همگام‌سازی و حساب کاربری'); await active('بیشتر')
  await page.goBack(); await heading('خانه'); await active('خانه')
  assert.equal(await page.getByRole('button', { name: /موجودی گدام/ }).count(), 1)
  assert.deepEqual(await businessSnapshot(page), before, 'navigation never changes business records')
  const artifacts = fileURLToPath(new URL('../.superpowers/sdd/plan/task-2-screenshots/', import.meta.url))
  await mkdir(artifacts, { recursive: true })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `overflow ${width}`)
    await page.screenshot({ path: `${artifacts}/home-${width}.png`, fullPage: true })
  }
  console.log('PASS actual App: five tabs, active routes, account paths, no accidental forms, persistent sync, unchanged records, responsive screenshots')
} finally { await app.close() }
