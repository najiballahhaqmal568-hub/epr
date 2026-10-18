// موبایل اول سندی دارد که پرچم سراسری قدیمی «از سرور» شمرده بود و هرگز فرستاده نشد (موجودی اولیهٔ
// Go pu بهاری: یک موبایل ۸۳، موبایل دیگر ۳-). همگام‌سازی بعدی باید آن را بفرستد و موبایل دوم همان ۸۳ را بسازد.
// سرور ساختگی در خود صفحه است؛ هیچ درخواست بیرونی و هیچ حساب واقعی.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const PORT = 5194
const url = `http://localhost:${PORT}/sync-unsent`
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' })
let browser
let code = 1
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })
  const page = await browser.newPage()
  await page.route('**/*', route => {
    const request = new URL(route.request().url())
    if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
    if (request.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    if (request.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa() { return window.testServer }; export async function getProfile() { return { shop_id: "test-shop", role: "owner" } }' })
    return route.continue()
  })
  page.on('pageerror', e => console.error('pageerror', e.message))
  await page.goto(url)
  const r = await page.evaluate(async () => {
    const { db, writeAsRemote } = await import('/src/db.ts')
    const sync = await import('/src/lib/sync.ts')
    const ops = await import('/src/lib/ops.ts')
    const { runIntegrityCheck } = await import('/src/lib/integrity.ts')
    await db.open()
    const allTables = db.tables.map(t => t.name)
    const wipe = async () => { for (const t of allTables) await db.table(t).clear() }
    await wipe()

    // سرور ساختگی: جدول‌ها در حافظه، updated_at هر نوشتن بالا می‌رود
    const store = {}
    let tick = 0
    let repairLookups = 0
    const tableOf = name => (store[name] ??= new Map())
    window.testServer = {
      auth: { getSession: async () => ({ data: { session: {} } }) },
      from(name) {
        const filters = []
        let limit = Infinity
        const run = () => {
          const rows = [...tableOf(name).values()].filter(row => filters.every(f => f(row)))
            .sort((a, b) => a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.uuid < b.uuid ? -1 : a.uuid > b.uuid ? 1 : 0)
          return { data: rows.slice(0, limit).map(row => structuredClone(row)), error: null }
        }
        const query = {
          select: cols => { if (cols === 'uuid,deleted') repairLookups++; return query },
          eq: (col, val) => { filters.push(row => row[col] === val); return query },
          in: (col, vals) => { filters.push(row => vals.includes(row[col])); return query },
          gte: (col, val) => { filters.push(row => row[col] >= val); return query },
          or: expr => {
            const m = /^updated_at\.gt\.(.+),and\(updated_at\.eq\.(.+),uuid\.gt\.(.+)\)$/.exec(expr)
            filters.push(row => row.updated_at > m[1] || (row.updated_at === m[2] && row.uuid > m[3]))
            return query
          },
          order: () => query,
          limit: n => { limit = n; return query },
          single: async () => ({ data: { restore_generation: 0 }, error: null }),
          upsert: async (payload, opts) => {
            for (const p of payload) {
              if (opts?.ignoreDuplicates && tableOf(name).has(p.uuid)) continue
              tableOf(name).set(p.uuid, { ...structuredClone(p), updated_at: new Date(1800000000000 + ++tick).toISOString() })
            }
            return { error: null }
          },
          then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject)
        }
        return query
      }
    }

    // موبایل اول
    await sync.syncNow(true)
    const pid = await db.products.add({ name: 'Go pu بهاری', createdAt: 1 })
    const vid = await ops.addVariant({ productId: pid, size: '۴۰ تا ۴۵ مکس', color: '', purchasePrice: 900, retailPrice: 1200, wholesalePrice: 1100, lowStock: 2 }, 'Go pu بهاری')
    await sync.syncNow(true)
    // باگ قدیمی: موجودی اولیه وقتی ثبت شد که دریافت از موبایل دیگر روان بود — مُهر «از سرور» خورد
    await writeAsRemote(allTables, () => ops.setOpeningStock(vid, 86, 'Go pu بهاری'))
    const sale = (qty) => ({ date: Date.now(), lines: [{ variantId: vid, productName: 'Go pu بهاری', size: '۴۰ تا ۴۵ مکس', color: '', qty, unitPrice: 1200 }], total: qty * 1200, paid: qty * 1200 })
    await ops.addSale(sale(3))
    const wrongSale = await ops.addSale(sale(1))
    await sync.syncNow(true)
    // حذف یک فروش هم در همان لحظه افتاد — سرور هنوز آن را زنده می‌داند
    await writeAsRemote(allTables, () => ops.deleteSale(wrongSale))
    // یک ردیف واقعاً رسیده از موبایل دوم — نباید دوباره فرستاده شود
    tableOf('customers').set('00000000-0000-4000-8000-0000000000b1', { uuid: '00000000-0000-4000-8000-0000000000b1', shop_id: 'test-shop', generation: 0, device_id: 'phone-2', deleted: false, data: { name: 'مشتری موبایل دوم', type: 'retail', balance: 0, createdAt: 1 }, updated_at: new Date(1800000000000 + ++tick).toISOString() })
    // اپ تازه نصب شد: بازرسی یک‌باره هنوز در این موبایل اجرا نشده
    await db.syncState.delete('unsentRepair:0')
    await sync.syncNow(true)
    const phone1Stock = (await db.variants.get(vid)).stockQty
    const adjOnServer = [...tableOf('adjustments').values()].filter(row => !row.deleted).length
    const saleDeletedOnServer = tableOf('sales').get((await db.sales.get(wrongSale)).uuid).deleted
    const remoteCustomerDevice = tableOf('customers').get('00000000-0000-4000-8000-0000000000b1').device_id
    const before = repairLookups
    await sync.syncNow(true)
    const repeatUpserts = repairLookups - before

    // موبایل دوم: دیتابیس تازه، همان سرور
    await wipe()
    await sync.syncNow(true)
    const v2 = await db.variants.where('uuid').equals(tableOf('variants').values().next().value.uuid).first()
    const integrity = await runIntegrityCheck()
    return { phone1Stock, adjOnServer, saleDeletedOnServer, remoteCustomerDevice, repeatUpserts, phone2Stock: v2?.stockQty, mismatches: integrity.mismatches.length }
  })
  const failures = []
  const check = (name, got, want) => { if (got !== want) failures.push(`${name}: ${got} (باید ${want})`); else console.log(`✅ ${name}: ${got}`) }
  check('موبایل اول: موجودی', r.phone1Stock, 83)
  check('سند موجودی اولیه به سرور رسید', r.adjOnServer, 1)
  check('حذف فروش به سرور رسید', r.saleDeletedOnServer, true)
  check('ردیف موبایل دوم دست نخورد', r.remoteCustomerDevice, 'phone-2')
  check('بازرسی یک‌باره دوباره اجرا نشد', r.repeatUpserts, 0)
  check('موبایل دوم: همان موجودی', r.phone2Stock, 83)
  check('موبایل دوم: کنترل حساب‌ها سالم', r.mismatches, 0)
  for (const f of failures) console.log('❌', f)
  code = failures.length ? 1 : 0
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
process.exit(code)
