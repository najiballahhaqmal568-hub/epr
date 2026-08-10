// اجراکنندهٔ آزمایش‌ها: سرور توسعه را بالا می‌کند، صفحهٔ آزمایش را باز می‌کند و نتیجه را چاپ می‌کند.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const PORT = 5178
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const vite = spawn(process.execPath, [viteBin, '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
const stop = () => vite.kill('SIGTERM')
process.on('exit', stop)

async function waitForServer(url, timeoutMs = 60000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const r = await fetch(url)
      if (r.ok) return
    } catch {
      /* هنوز بالا نشده */
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error('سرور توسعه بالا نشد')
}

let code = 1
try {
  await waitForServer(`http://localhost:${PORT}/tests.html`)
  const browserCandidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  ].filter(Boolean)
  const executablePath = browserCandidates.find((candidate) => existsSync(candidate))
  if (!executablePath) throw new Error('مرورگر Chromium/Chrome/Edge پیدا نشد؛ CHROMIUM_PATH را تنظیم کنید')
  const browser = await chromium.launch({
    executablePath,
    args: ['--no-sandbox']
  })
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.error('خطای صفحه:', e.message))
  await page.goto(`http://localhost:${PORT}/tests.html`)
  await page.waitForFunction('window.TESTS_FAIL !== undefined', { timeout: 120000 })
  console.log(await page.evaluate(() => window.TESTS_REPORT ?? document.getElementById('out').textContent))
  code = await page.evaluate(() => window.TESTS_FAIL)
  await browser.close()
} catch (e) {
  console.error('آزمایش اجرا نشد:', e.message)
  code = 1
}

stop()
process.exit(code === 0 ? 0 : 1)
