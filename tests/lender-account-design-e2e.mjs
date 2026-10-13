// صفحهٔ قرض‌دهنده: سه دکمهٔ روزمره در یک ردیف، همهٔ سندهای پیش از اپ در «سند قبلی»،
// «بعد از ثبت: …» پیش از هر ثبت (و برابر با عدد واقعی بعد از ثبت)، و هشدار وقتی حساب برعکس می‌شود.
// اشتباه حساب صدیق قصاب از نو: «قرضش را نقد پس دادیم» روی حسابی که هیچ قرضی نداشت.
import assert from 'node:assert/strict'
import { localApp } from './local-app.mjs'
import { contrastFailures } from './contrast.mjs'

const { page, close } = await localApp()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
const balance = () => page.evaluate(async () => {
  const { db } = await import('/src/db.ts')
  return (await db.suppliers.filter((s) => s.name === 'صدیق قصاب').first()).balance
})
try {
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    await db.cashMovements.add({ date: Date.now(), amount: 20000, type: 'opening' })
    await db.suppliers.add({ name: 'صدیق قصاب', kind: 'lender', balance: 0, createdAt: Date.now() })
    await db.suppliers.add({ name: 'شرکت بوت', kind: 'supplier', balance: 0, createdAt: Date.now() })
    const productId = await db.products.add({ name: 'Go pu', createdAt: Date.now() })
    await db.variants.add({ productId, size: '44', color: 'مکس', stockQty: 3, purchasePrice: 900, retailPrice: 1500, wholesalePrice: 1300, sku: 'T-44' })
  })
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  await page.locator('summary', { hasText: 'افزودن و مدیریت حساب‌ها' }).click()
  await page.getByRole('button', { name: 'تأمین‌کنندگان', exact: true }).click()
  await page.getByRole('group', { name: 'نوع حساب خرید' }).getByRole('button', { name: 'قرض‌دهنده‌ها' }).click()
  await page.getByRole('region', { name: 'فهرست قرض‌دهندگان' }).getByRole('button', { name: /صدیق قصاب/ }).click()
  const sheet = page.locator('dialog[open]').last()
  await sheet.waitFor()
  const btn = (name) => sheet.getByRole('button', { name, exact: true })
  const save = (name) => sheet.getByRole('button', { name })

  // ۱) سه دکمهٔ روزمره در یک ردیف؛ فقط دکمهٔ زده‌شده رنگ می‌گیرد
  const ys = await Promise.all(['پول گرفتیم', 'پول دادیم', 'کفش دادیم'].map(async (n) => Math.round((await btn(n).boundingBox()).y)))
  assert.equal(new Set(ys).size, 1, `one row: ${ys}`)
  await btn('پول دادیم').click()
  const bg = (n) => btn(n).evaluate((el) => getComputedStyle(el).backgroundColor)
  assert.equal(await bg('پول گرفتیم'), await bg('کفش دادیم'), 'an unpressed «پول گرفتیم» looks like the other unpressed buttons')
  assert.notEqual(await bg('پول دادیم'), await bg('کفش دادیم'), 'the pressed button stands out')
  await btn('پول دادیم').click()
  assert.equal(await sheet.getByText('پول گرفتیم: او به ما پول داد').count(), 0, 'no legend line needed')

  // ۲) «سند قبلی»: اولین گزینه «او قبلاً به ما پول قرض داد»
  await btn('سند قبلی — قبل از استفاده از اپ').click()
  const opening = sheet.locator('select').filter({ hasText: 'او قبلاً به ما پول قرض داد' })
  assert.equal(await opening.inputValue(), 'loanOpening', 'loan before the app is the first choice')
  const amount = sheet.getByLabel('مبلغ قبلی *')

  // ۳) همان اشتباه: «قرضش را نقد پس دادیم» ۳٬۸۰۰ روی حسابی که قرضی ندارد → هشدار و قفل
  await opening.selectOption('cashRepayment')
  await amount.fill('3800')
  await sheet.getByText('بعد از ثبت: باید ۳٬۸۰۰ ؋ بگیریم', { exact: true }).waitFor()
  await sheet.getByText('⚠️ توجه: با این سند حساب برعکس می‌شود.').waitFor()
  await sheet.getByText('گزینهٔ «او قبلاً به ما پول قرض داد» را ثبت کنید').waitFor()
  const openingSave = save('ثبت سند قبلی بدون تغییر صندوق و گدام')
  assert.equal(await openingSave.isDisabled(), true, 'a flipping document waits for «بلی، درست است»')
  await sheet.getByLabel('بلی، درست است').check()
  assert.equal(await openingSave.isDisabled(), false, 'confirming unlocks it')

  // درستش: «او قبلاً به ما پول قرض داد» ۳٬۸۰۰ — بدون هشدار، صندوق دست نمی‌خورد
  await opening.selectOption('loanOpening')
  await amount.fill('3800')
  await sheet.getByText('بعد از ثبت: باید ۳٬۸۰۰ ؋ بدهیم', { exact: true }).waitFor()
  assert.equal(await sheet.getByText('⚠️ توجه').count(), 0, 'no warning when the side does not flip')
  const cashBefore = await page.evaluate(async () => (await import('/src/lib/ops.ts')).cashBalance())
  await openingSave.click()
  await sheet.getByText('باید بدهیم', { exact: true }).waitFor()
  assert.equal(await balance(), 3800)
  assert.equal(await page.evaluate(async () => (await import('/src/lib/ops.ts')).cashBalance()), cashBefore, 'opening loan leaves the till alone')

  // ۴) «کفش دادیم»: حالا «به جای قرضش» خودش انتخاب است؛ پیش‌نمایش = عدد بعد از ثبت
  await btn('کفش دادیم').click()
  const goodsKind = sheet.locator('select').filter({ hasText: 'به جای قرضش' })
  assert.equal(await goodsKind.inputValue(), 'goodsSettlement', 'we owe him → paying back is the default')
  const picker = sheet.locator('select').filter({ hasText: 'انتخاب کنید...' })
  await picker.selectOption(await picker.locator('option', { hasText: 'Go pu' }).getAttribute('value'))
  await sheet.getByPlaceholder('قیمت توافق‌شده').fill('1500')
  await sheet.getByRole('button', { name: '＋ افزودن به سند' }).click()
  await sheet.getByText('بعد از ثبت: باید ۲٬۳۰۰ ؋ بدهیم', { exact: true }).waitFor()
  await save('ثبت کفش به جای قرضش').click()
  await sheet.getByText('باید بدهیم', { exact: true }).waitFor()
  assert.equal(await balance(), 2300)

  // «پول گرفتیم» ۵۰۰ → ۲٬۸۰۰
  await btn('پول گرفتیم').click()
  await sheet.getByLabel('مبلغ *').fill('500')
  await sheet.getByText('بعد از ثبت: باید ۲٬۸۰۰ ؋ بدهیم', { exact: true }).waitFor()
  await save('ثبت دریافت نقدی قرض').click()
  await page.waitForTimeout(300)
  assert.equal(await balance(), 2800)

  // «پرداخت مستقیم به فروشنده» ۱٬۰۰۰ → ۳٬۸۰۰
  await btn('پرداخت مستقیم به فروشنده').click()
  const supplierPick = sheet.locator('select').filter({ hasText: 'شرکت بوت' })
  await supplierPick.selectOption(await supplierPick.locator('option', { hasText: 'شرکت بوت' }).getAttribute('value'))
  await sheet.getByLabel('مبلغ *').fill('1000')
  await sheet.getByText('بعد از ثبت: باید ۳٬۸۰۰ ؋ بدهیم', { exact: true }).waitFor()
  await save('ثبت پرداخت مستقیم').click()
  await page.waitForTimeout(300)
  assert.equal(await balance(), 3800)

  // «پول دادیم»: «قرضش را پس دادیم» خودش انتخاب است؛ بیشتر از آنچه باید بدهیم قفل است و دلیلش دیده می‌شود
  await btn('پول دادیم').click()
  const cashKind = sheet.locator('select').filter({ hasText: 'قرضش را پس دادیم' })
  assert.equal(await cashKind.inputValue(), 'cashRepayment')
  await sheet.getByLabel('مبلغ *').fill('5000')
  await sheet.getByText('ما فقط ۳٬۸۰۰ ؋ باید به او بدهیم').waitFor()
  assert.equal(await save('ثبت پرداخت قرض').isDisabled(), true, 'repaying more than we owe is locked')
  await sheet.getByLabel('مبلغ *').fill('300')
  await sheet.getByText('بعد از ثبت: باید ۳٬۵۰۰ ؋ بدهیم', { exact: true }).waitFor()
  await save('ثبت پرداخت قرض').click()
  await page.waitForTimeout(300)
  assert.equal(await balance(), 3500)

  // «به او پول قرض دادیم» ۵٬۰۰۰ وقتی ما ۳٬۵۰۰ بدهکاریم → حساب برعکس می‌شود: هشدار، بعد تأیید
  await btn('پول دادیم').click()
  await cashKind.selectOption('cashLoan')
  await sheet.getByLabel('مبلغ *').fill('5000')
  await sheet.getByText('بعد از ثبت: باید ۱٬۵۰۰ ؋ بگیریم', { exact: true }).waitFor()
  await sheet.getByText('⚠️ توجه: با این سند حساب برعکس می‌شود.').waitFor()
  assert.equal(await save('ثبت قرض نقدی به او').isDisabled(), true)
  await sheet.getByLabel('بلی، درست است').check()
  await save('ثبت قرض نقدی به او').click()
  await page.waitForTimeout(300)
  assert.equal(await balance(), -1500)

  // هیچ کلمهٔ کهنه در صفحه نمانده
  for (const b of ['پول گرفتیم', 'پول دادیم', 'کفش دادیم', 'سند قبلی — قبل از استفاده از اپ']) {
    await btn(b).click()
    assert.doesNotMatch(await sheet.innerText(), /قرض ما به او|طلب ما از او|قرض فعلی/, `old wording in «${b}»`)
    await btn(b).click()
  }

  // هشدار و «بعد از ثبت» در هر نمای روز/آفتاب/شب خوانا است
  await btn('سند قبلی — قبل از استفاده از اپ').click()
  await opening.selectOption('cashRepayment')
  await amount.fill('100')
  await sheet.getByText('⚠️ توجه: با این سند حساب برعکس می‌شود.').waitFor()
  // خلاصهٔ بسته را هم باز کن: Chrome رنگ متن داخل <details> بسته را تازه نمی‌کند و آزمایش رنگِ کهنه را می‌خواند
  await sheet.locator('summary', { hasText: 'خلاصهٔ کامل رفت‌وآمدها' }).click()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  for (const mode of ['light', 'sun', 'dark']) {
    await page.evaluate(async (m) => (await import('/src/lib/displayMode.ts')).setDisplayMode(m), mode)
    await page.waitForTimeout(300)
    assert.deepEqual(await contrastFailures(page, 'dialog[open]'), [], `lender sheet contrast in ${mode} mode`)
  }
  await page.evaluate(async () => (await import('/src/lib/displayMode.ts')).setDisplayMode('light'))
  await btn('سند قبلی — قبل از استفاده از اپ').click()

  // در گوشی کوچک هیچ چیز از صفحه بیرون نمی‌زند
  await page.setViewportSize({ width: 320, height: 700 })
  await btn('سند قبلی — قبل از استفاده از اپ').click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'fits 320px')

  assert.deepEqual(errors, [])
  console.log('lender account design e2e: ok')
} finally {
  await close()
}
