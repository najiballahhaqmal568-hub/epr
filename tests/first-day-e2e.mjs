// Brand-new shop: the owner sees a three-step start guide that ticks itself from the data, empty
// screens that say what to do next, and the guide stays closed once dismissed. Disposable IndexedDB.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { localApp } from './local-app.mjs'
const app = await localApp()
const { page, origin } = app
const errors = []
page.on('pageerror', error => errors.push(error.message))
const shots = '.superpowers/sdd/plan/first-day-screenshots'
mkdirSync(shots, { recursive: true })
const nav = name => page.locator('nav').getByRole('button', { name, exact: true }).click()
try {
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  const guide = page.getByRole('region', { name: 'شروع کار با اتل' })
  await guide.waitFor()
  assert.match(await guide.innerText(), /۳ قدم مانده[\s\S]*پول صندوق را بشمارید[\s\S]*بوت‌ها را با عکس اضافه کنید[\s\S]*قرض‌های قبلی را بنویسید/)
  await page.screenshot({ path: `${shots}/guide-390.png`, fullPage: true })

  // The step's button reaches the right place; the empty stock screen teaches and offers the action.
  await guide.getByRole('button', { name: 'گدام' }).click()
  await page.getByText('هنوز جنسی ثبت نشده.', { exact: true }).waitFor()
  await page.getByText('بوت‌ها را با عکس اضافه کنید؛ فروشنده از عکس زودتر پیدا می‌کند.').waitFor()
  assert.equal(await page.locator('.empty-state').getByRole('button', { name: '＋ افزودن بوت جدید' }).count(), 1)

  // Adding a product ticks step two by itself.
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.products.add({ name: 'کوهستان', createdAt: Date.now() })
  })
  await nav('خانه')
  await guide.getByText('۲ قدم مانده').waitFor()
  assert.match(await guide.innerText(), /۰ از ۱ بوت عکس دارد/)
  assert.equal(await guide.locator('li[data-done="true"]').count(), 1)

  // Empty customer book: the action opens the new-customer form.
  await nav('حساب‌ها')
  await page.getByText('هنوز هیچ حسابی نیست.', { exact: true }).waitFor()
  await page.locator('.empty-state').getByRole('button', { name: 'باز کردن دفتر مشتریان' }).click()
  await page.locator('.empty-state').getByRole('button', { name: '＋ مشتری جدید' }).click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')

  // Dismissed stays dismissed, also after reopening the app.
  await nav('خانه')
  await guide.getByRole('button', { name: 'بستن راهنما' }).click()
  await guide.waitFor({ state: 'detached' })
  await page.goto(`${origin}/?ui-preview=1`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: 'خانه' }).waitFor()
  await page.waitForTimeout(500)
  assert.equal(await guide.count(), 0)
  assert.deepEqual(errors, [])
  console.log('PASS first day: guide ticks itself from data, steps reach their page, empty screens teach and act, dismiss sticks')
} finally {
  await app.close()
}
