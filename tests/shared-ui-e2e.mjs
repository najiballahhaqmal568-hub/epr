import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Standalone, fresh profile; never imports the real app or contacts business services.
const root = fileURLToPath(new URL('..', import.meta.url))
const artifacts = fileURLToPath(new URL('../.superpowers/sdd/plan/task-1-screenshots/', import.meta.url))
const server = await createServer({ root, cacheDir: '.superpowers/sdd/plan/task-1-vite-cache', server: { host: '127.0.0.1', port: 5186, strictPort: true } })
let browser
const failures = []
const check = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (error) { failures.push(`${name}: ${error.message}`); console.error(`FAIL ${name}: ${error.message}`) }
}
try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await context.route('**/*', route => new URL(route.request().url()).origin === 'http://127.0.0.1:5186' ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('http://127.0.0.1:5186/tests/fixtures/shared-ui.html')
  await page.getByRole('heading', { name: 'حساب فروشگاه' }).waitFor()
  const counts = () => page.getByTestId('counts').textContent()
  await check('nested child click does not open its parent card', async () => {
    await page.getByText('پرداخت مستقل', { exact: true }).click()
    assert.equal(await counts(), '0,1,0')
  })
  await check('card body, Enter and Space still activate once each', async () => {
    const card = page.getByTestId('interactive-card').locator('[role="button"]')
    const before = Number((await counts()).split(',')[0])
    await card.locator('p').click()
    await card.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space')
    assert.equal(Number((await counts()).split(',')[0]), before + 3)
  })
  await check('nested child keyboard action stays independent', async () => {
    const before = (await counts()).split(',').map(Number)
    await page.getByRole('button', { name: 'پرداخت مستقل', exact: true }).focus()
    await page.keyboard.press('Enter'); await page.keyboard.press('Space')
    assert.equal(await counts(), `${before[0]},${before[1] + 2},0`)
  })
  await check('static card has no interactive semantics', async () => {
    const card = page.getByTestId('static-card').locator('div').first()
    assert.equal(await card.getAttribute('role'), null)
    assert.equal(await card.getAttribute('tabindex'), null)
  })
  await check('icon-only Fab has an accessible add name', async () => {
    assert.equal(await page.getByRole('button', { name: 'افزودن', exact: true }).count(), 1)
  })
  await check('read-only users have no Fab', async () => {
    await page.getByLabel('فقط مشاهده').check()
    assert.equal(await page.locator('.premium-fab').count(), 0)
    await page.getByLabel('فقط مشاهده').uncheck()
    assert.equal(await page.locator('.premium-fab').count(), 1)
  })
  await check('disabled primary cannot commit or receive focus', async () => {
    const disabled = page.getByRole('button', { name: 'ثبت غیرفعال' })
    assert.equal(await disabled.isDisabled(), true)
    await disabled.evaluate(button => button.click())
    await disabled.focus()
    assert.equal(await disabled.evaluate(button => button === document.activeElement), false)
    assert.equal((await counts()).split(',')[2], '0')
  })
  await check('input retains visible keyboard focus', async () => {
    await page.getByLabel('اندازهٔ نوشته').focus(); await page.keyboard.press('Tab')
    assert.equal(await page.getByLabel('نام مشتری').evaluate(input => {
      const css = getComputedStyle(input)
      return input === document.activeElement && css.outlineStyle !== 'none' && parseFloat(css.outlineWidth) >= 2
    }), true)
  })
  await check('shared controls meet 44px touch targets', async () => {
    const sizes = await page.locator('button,input:not([type="checkbox"]),select,textarea').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })))
    assert.ok(sizes.every(size => size.width >= 44 && size.height >= 44), JSON.stringify(sizes))
  })
  await mkdir(artifacts, { recursive: true })
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 })
    for (const scale of ['md', 'xl']) {
      await page.getByLabel('اندازهٔ نوشته').selectOption(scale)
      await check(`no clipped fields or page overflow at ${width}/${scale}`, async () => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.equal(await page.getByLabel('نام مشتری').evaluate(el => el.getBoundingClientRect().right <= innerWidth && el.getBoundingClientRect().left >= 0), true)
      })
      await check(`financial amounts remain unbroken at ${width}/${scale}`, async () => {
        assert.equal(await page.locator('.summary-strip dd').evaluateAll(elements => elements.every(el => {
          const range = document.createRange(); range.selectNodeContents(el)
          return range.getClientRects().length === 1 && el.scrollWidth <= el.clientWidth
        })), true)
      })
      await page.screenshot({ path: `${artifacts}/${width}-${scale}.png`, fullPage: true })
    }
  }
  await check('font setting enlarges shared input text', async () => {
    const input = page.getByLabel('نام مشتری')
    const large = await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize))
    await page.getByLabel('اندازهٔ نوشته').selectOption('md')
    assert.ok(large > await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))
  })
  for (const close of ['button', 'Escape', 'Back']) {
    await check(`modal focus trap, ${close} close and focus return`, async () => {
      const opener = page.getByRole('button', { name: 'باز کردن جزئیات' })
      await opener.click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true)
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('Tab')
        // Chromium may focus the document between dialog cycles, but never
        // allows a background control to receive keyboard input.
        assert.equal(await dialog.evaluate(el => el.contains(document.activeElement) || document.activeElement === document.body), true)
      }
      if (close === 'button') await dialog.getByRole('button', { name: 'بستن' }).click()
      else if (close === 'Escape') await page.keyboard.press('Escape')
      else await page.evaluate(() => history.back())
      await dialog.waitFor({ state: 'hidden' })
      await page.waitForFunction(() => !history.state?.modal)
      assert.equal(await opener.evaluate(el => el === document.activeElement), true)
    })
  }
  await check('nested dialog returns focus inside its parent under StrictMode', async () => {
    await page.getByRole('button', { name: 'باز کردن جزئیات' }).click()
    const opener = page.getByRole('button', { name: 'جزئیات بیشتر', exact: true })
    await opener.click()
    await page.getByRole('dialog', { name: 'جزئیات بیشتر', exact: true }).waitFor()
    await page.evaluate(() => { window.fixturePopped = false; window.addEventListener('popstate', () => { window.fixturePopped = true }, { once: true }) })
    await page.keyboard.press('Escape')
    await page.getByRole('dialog', { name: 'جزئیات بیشتر', exact: true }).waitFor({ state: 'hidden' })
    assert.equal(await opener.evaluate(el => el === document.activeElement), true)
    assert.equal(await page.getByRole('dialog').count(), 1)
    // Native Escape cleanup removes its history step asynchronously (80ms).
    await page.waitForFunction(() => window.fixturePopped)
    await page.getByRole('dialog').getByRole('button', { name: 'بستن' }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page.waitForFunction(() => !history.state?.modal)
  })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.getByLabel('اندازهٔ نوشته').selectOption('xl')
  await page.getByRole('button', { name: 'باز کردن جزئیات' }).click()
  await check('modal title and close target fit at 320px large font', async () => {
    const dialog = page.getByRole('dialog')
    assert.equal(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth), true)
    const close = await dialog.getByRole('button', { name: 'بستن' }).boundingBox()
    assert.ok(close.width >= 43.99 && close.height >= 43.99, JSON.stringify(close))
  })
  await page.screenshot({ path: `${artifacts}/320-xl-modal.png`, fullPage: true })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await check('reduced motion removes panel movement', async () => {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('dialog')).transform === 'none')
    assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).transform), 'none')
    assert.ok(await page.getByRole('dialog').evaluate(el => parseFloat(getComputedStyle(el).transitionDuration) < 0.001))
  })
  await check('no runtime errors', async () => assert.deepEqual(errors, []))
  assert.deepEqual(failures, [])
} finally {
  await browser?.close()
  await server.close()
}
