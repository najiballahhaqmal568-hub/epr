// اجراکنندهٔ آزمایش تصادفی: node tests/fuzz.mjs [runs] [steps] [from]
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const runs = Number(process.argv[2] ?? 20)
const steps = Number(process.argv[3] ?? 120)
const from = Number(process.argv[4] ?? 1)

const PORT = 5179
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
  await waitForServer(`http://localhost:${PORT}/fuzz.html`)
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
  page.setDefaultTimeout(3_600_000)
  page.on('pageerror', (e) => console.error('خطای صفحه:', e.message))
  await page.goto(`http://localhost:${PORT}/fuzz.html?runs=${runs}&steps=${steps}&from=${from}`)
  await page.waitForFunction('window.FUZZ_FAIL !== undefined', { timeout: 3_600_000, polling: 1000 })
  console.log(await page.evaluate(() => window.FUZZ_REPORT ?? document.getElementById('out').textContent))
  code = await page.evaluate(() => window.FUZZ_FAIL)
  await browser.close()
} catch (e) {
  console.error('آزمایش اجرا نشد:', e.message)
  code = 1
}

stop()
process.exit(code === 0 ? 0 : 1)
