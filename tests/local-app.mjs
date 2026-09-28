import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

// Actual App, disposable browser storage and loopback-only transport.
export async function localApp() {
  const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), cacheDir: '.superpowers/sdd/plan/task-2-vite-cache', server: { host: '127.0.0.1', port: 5187, strictPort: true } })
  let browser
  try {
  await server.listen()
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const origin = 'http://127.0.0.1:5187'
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
  const page = await context.newPage()
  page.setDefaultTimeout(10000)
  await page.goto(`${origin}/?ui-preview=1`, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.locator('.app-nav').waitFor()
  return { page, context, origin, close: async () => { await browser.close(); await server.close() } }
  } catch (error) {
    await browser?.close()
    await server.close()
    throw error
  }
}

export const businessSnapshot = page => page.evaluate(async () => {
  const { db } = await import('/src/db.ts')
  return Object.fromEntries(await Promise.all(db.tables.filter(t => t.name !== 'settings').map(async t => [t.name, await t.toArray()])))
})
