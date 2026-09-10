import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const port = 5199
const url = `http://localhost:${port}/direct-trade-checks`
const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], { stdio: 'ignore' })
let browser

try {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) break } catch {}
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  const candidates = [
    process.env.CHROMIUM_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean)
  const executablePath = candidates.find(candidate => existsSync(candidate))
  assert.ok(executablePath, 'No Chromium browser found')
  browser = await chromium.launch({ executablePath })
  const page = await browser.newPage()
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
    if (u.pathname === '/direct-trade-checks') return route.fulfill({
      contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>'
    })
    return route.continue()
  })
  await page.goto(url)
  const names = await page.evaluate(async () => {
    const base = await import('/tests/direct-trade-checks.ts')
    const reports = await import('/tests/direct-trade-report-checks.ts')
    const cases = [...base.cases, ...reports.cases]
    for (const test of cases) await test.run()
    return cases.map(test => test.name)
  })
  console.log(`PASS: ${names.length} direct-trade cases`)
} finally {
  await browser?.close()
  server.kill()
}
