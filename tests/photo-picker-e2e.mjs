import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5191/?ui-preview'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5191', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort())
  await page.goto(url)
  await page.getByRole('heading', { name: 'میز فروش' }).waitFor()
  await page.locator('nav').getByRole('button', { name: 'حساب‌ها', exact: true }).click()
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('details').compareDocumentPosition(document.querySelector('[aria-label="فهرست حساب‌ها"]')) & Node.DOCUMENT_POSITION_FOLLOWING)))
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: ReactDOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: Picker } = await import('/src/pages/inventory/ProductPhotoPicker.tsx')
    const canvas = document.createElement('canvas'); canvas.width = 2; canvas.height = 2
    window.oldPhoto = canvas.toDataURL()
    const host = document.createElement('div'); document.body.append(host)
    function Harness() { const [photo, setPhoto] = React.useState(window.oldPhoto); return React.createElement(Picker, { photo, onChange: setPhoto }) }
    ReactDOM.createRoot(host).render(React.createElement(Harness))
  })
  const picker = page.getByRole('region', { name: 'عکس بوت' })
  await picker.waitFor()
  assert.equal(await picker.getByLabel('فایل کامره').getAttribute('capture'), 'environment')
  assert.equal(await picker.getByLabel('فایل گالری').getAttribute('capture'), null)
  const file = { name: 'shoe.png', mimeType: 'image/png', buffer: Buffer.from(await page.evaluate(() => window.oldPhoto.split(',')[1]), 'base64') }
  await picker.getByLabel('فایل گالری').setInputFiles(file)
  await page.getByRole('heading', { name: 'پیش‌نمایش عکس بوت' }).waitFor()
  await page.getByRole('button', { name: 'لغو', exact: true }).click()
  assert.equal(await picker.getByAltText('عکس فعلی بوت').getAttribute('src'), await page.evaluate(() => window.oldPhoto))
  await picker.getByLabel('فایل کامره').setInputFiles(file)
  await page.getByRole('button', { name: 'استفاده از این عکس' }).click()
  assert.match(await picker.getByAltText('عکس فعلی بوت').getAttribute('src'), /^data:image\/jpeg/)
  const accepted = await picker.getByAltText('عکس فعلی بوت').getAttribute('src')
  await picker.getByLabel('فایل گالری').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('invalid') })
  await picker.getByRole('alert').waitFor()
  assert.equal(await picker.getByAltText('عکس فعلی بوت').getAttribute('src'), accepted)
  console.log('PASS: management above list; separate camera/gallery; preview cancel/accept; same-file retry; invalid image preserves previous photo')
} finally { await browser?.close(); server.kill() }
