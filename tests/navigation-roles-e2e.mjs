import assert from 'node:assert/strict'
import { localApp, businessSnapshot } from './local-app.mjs'

for (const role of ['staff', 'viewer']) {
  const app = await localApp()
  const { page, origin } = app
  try {
    // Synthetic expired-session profile; every external transport remains aborted.
    await page.evaluate(async role => {
      const { db } = await import('/src/db.ts')
      await db.settings.bulkPut([
        { key: 'supaUrl', value: 'https://example.invalid' },
        { key: 'supaKey', value: 'synthetic-test-key' },
        { key: 'cachedProfile', value: { user_id: 'synthetic-user', shop_id: 'synthetic-shop', role, name: 'آزمایشی' } }
      ])
    }, role)
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    // Each role opens on its own screen: staff at the sale counter, a partner on the reports.
    await page.getByRole('heading', { name: role === 'staff' ? 'میز فروش' : 'راپورها', exact: true }).waitFor()
    if (role === 'viewer') assert.equal(await page.getByRole('button', { name: 'ثبت فروش', exact: true }).count(), 0)
    await page.getByRole('navigation').getByRole('button', { name: 'خانه', exact: true }).click()
    await page.getByRole('heading', { name: 'خانه', exact: true }).waitFor()
    if (role === 'staff') {
      assert.doesNotMatch(await page.locator('main').innerText(), /مفاد:|راپور کامل|مفاد خالص این ماه|مصرف این ماه|مصرف از مفاد/)
      await page.getByRole('navigation').getByRole('button', { name: 'بیشتر', exact: true }).click()
      assert.doesNotMatch(await page.locator('main').innerText(), /بکاپ و بازیابی|شروع سال مالی|منطقهٔ خطر|تنظیمات پیشرفته/)
      assert.equal(await page.getByRole('button', { name: /^راپورها/ }).count(), 0)
    } else {
      const before = await businessSnapshot(page)
      await page.getByRole('button', { name: 'فروش جدید', exact: true }).click()
      await page.getByRole('heading', { name: 'میز فروش', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: 'ثبت فروش', exact: true }).count(), 0)
      const denied = await page.evaluate(async () => {
        const { db } = await import('/src/db.ts')
        try { await db.products.add({ name: 'must not save', createdAt: Date.now() }); return false } catch (e) { return String(e).includes('فقط مشاهده') }
      })
      assert.equal(denied, true)
      assert.deepEqual(await businessSnapshot(page), before)
    }
    await page.getByRole('navigation').getByRole('button', { name: 'فروش', exact: true }).click()
    assert.equal(await page.getByRole('button', { name: 'فروش مستقیم', exact: true }).count(), 0)
    console.log(`PASS ${role}: real App role privacy and read-only protection`)
  } finally { await app.close() }
}
