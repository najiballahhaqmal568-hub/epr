// سندی که زودتر از جنس خود به موبایل دوم می‌رسد («اسکچرز گوتکه»: موبایل اول ۴۶، موبایل دوم ۲-).
// موبایل اول جنس نو با موجودی اولیهٔ ۴۸ ثبت می‌کند؛ موبایل دوم سند موجودی را پیش از خود سایز دریافت می‌کند.
// قبلاً سند با شمارهٔ ردیفِ موبایل اول ذخیره می‌شد و ۴۸ جوړه به سایز دیگری می‌رفت یا گم می‌شد — برای همیشه.
// حالا سند رد می‌شود تا سایزش برسد؛ و سندهایی که قبلاً جای غلط نشسته‌اند یک بار درست می‌شوند.
// سرور ساختگی در خود صفحه است؛ هیچ درخواست بیرونی و هیچ حساب واقعی.
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const PORT = 5195
const url = `http://localhost:${PORT}/sync-early-document`
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
    const hidden = new Set() // ردیف‌هایی که هنوز به سرور نرسیده‌اند (بالا کردن موبایل اول در راه است)
    // ردیف وقتی واقعاً به سرور می‌رسد، updated_at تازه می‌گیرد
    const arrive = () => { for (const name in store) for (const row of store[name].values()) if (hidden.has(row.uuid)) row.updated_at = new Date(1800000000000 + ++tick).toISOString(); hidden.clear() }
    let tick = 0
    let repairLookups = 0
    const tableOf = name => (store[name] ??= new Map())
    window.testServer = {
      auth: { getSession: async () => ({ data: { session: {} } }) },
      from(name) {
        const filters = []
        let limit = Infinity
        const run = () => {
          const rows = [...tableOf(name).values()].filter(row => !hidden.has(row.uuid) && filters.every(f => f(row)))
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

    const { applyDocEffects, decodeRefs } = sync
    const freshPhone = async () => { db.close(); await db.delete(); await db.open() } // شماره‌های ردیف از ۱ شروع شوند
    const stockOf = async (name) => {
      const p = await db.products.where('name').equals(name).first()
      return p ? (await db.variants.where('productId').equals(p.id).first())?.stockQty : undefined
    }
    const ownBoot = async () => {
      const pid = await db.products.add({ name: 'بوت دیگر', createdAt: 2 })
      await ops.addVariant({ productId: pid, size: '41', color: '', purchasePrice: 500, retailPrice: 800, wholesalePrice: 700, lowStock: 1, stockQty: 5 }, 'بوت دیگر')
    }

    // موبایل اول: جنس نو با موجودی اولیه
    await freshPhone()
    await sync.syncNow(true)
    const pid = await db.products.add({ name: 'اسکچرز گوتکه', createdAt: 1 })
    await ops.addVariant({ productId: pid, size: '۴۰ تا ۴۴ مکس', color: '', purchasePrice: 700, retailPrice: 950, wholesalePrice: 900, lowStock: 2, stockQty: 48 }, 'اسکچرز گوتکه')
    await sync.syncNow(true)
    const late = [...tableOf('products').values(), ...tableOf('variants').values()].map(row => row.uuid)

    // 1) موبایل دوم: سند موجودی رسید، سایزش هنوز نه
    await freshPhone()
    await ownBoot()
    late.forEach(u => hidden.add(u))
    let refused = ''
    try { await sync.syncNow(true) } catch (error) { refused = error.message }
    const whileWaiting = { other: await stockOf('بوت دیگر'), adjustments: await db.adjustments.count() }
    arrive()
    await sync.syncNow(true)
    const afterArrival = { gotke: await stockOf('اسکچرز گوتکه'), other: await stockOf('بوت دیگر'), mismatches: (await runIntegrityCheck()).mismatches.length }

    // 2) موبایلی که با نسخهٔ قبلی همان سند را جای غلط نشانده بود: یک بار درست می‌شود
    await freshPhone()
    await ownBoot()
    await sync.syncNow(true) // سند و سایز هر دو در سرور اند؛ این موبایل آن‌ها را درست می‌گیرد
    const adjRow = [...tableOf('adjustments').values()].find(row => row.data.variantUuid === tableOf('variants').values().next().value.uuid)
    await freshPhone()
    await ownBoot()
    late.forEach(u => hidden.add(u))
    // همان کاری که applyRemoteRow پیش از این می‌کرد: شمارهٔ بیگانه می‌ماند و اثر روی همان شماره می‌نشست
    const allTables2 = db.tables.map(t => t.name)
    await writeAsRemote(allTables2, async () => {
      const rec = await decodeRefs('adjustments', adjRow.data, false)
      rec.uuid = adjRow.uuid
      rec.deleted = false
      delete rec.id
      await db.adjustments.add(rec)
      await applyDocEffects('adjustments', rec, false)
    })
    const misplaced = await stockOf('بوت دیگر')
    arrive()
    await db.syncState.put({ key: 'pull:adjustments', value: '2100-01-01T00:00:00Z' }) // سند همان قبلاً «رسیده» است
    await sync.syncNow(true)
    const repaired = { gotke: await stockOf('اسکچرز گوتکه'), other: await stockOf('بوت دیگر'), mismatches: (await runIntegrityCheck()).mismatches.length }
    // 3) اثر سند رسیده فقط موجودی را می‌نویسد: قیمتی که همان لحظه این‌جا نوشته شد هنوز «فرستاده نشده» می‌ماند
    const boot = await db.variants.where('size').equals('41').first()
    await db.variants.update(boot.id, { retailPrice: 850 })
    const stampBefore = (await db.variants.get(boot.id)).localUpdatedAt
    await writeAsRemote(allTables2, () => db.variants.update(boot.id, { stockQty: boot.stockQty - 1 }))
    const keptStamp = (await db.variants.get(boot.id)).localUpdatedAt === stampBefore && stampBefore > 0
    return { refused, whileWaiting, afterArrival, misplaced, repaired, keptStamp }
  })
  const failures = []
  const check = (name, got, want) => { if (got !== want) failures.push(`${name}: ${got} (باید ${want})`); else console.log(`✅ ${name}: ${got}`) }
  check('سند پیش از سایزش رد شد', /هنوز از موبایل دیگر نرسیده/.test(r.refused), true)
  check('در انتظار: سایز دیگر دست نخورد', r.whileWaiting.other, 5)
  check('در انتظار: سند ذخیره نشد', r.whileWaiting.adjustments, 1)
  check('بعد از رسیدن: گوتکه', r.afterArrival.gotke, 48)
  check('بعد از رسیدن: سایز دیگر', r.afterArrival.other, 5)
  check('بعد از رسیدن: کنترل حساب‌ها سالم', r.afterArrival.mismatches, 0)
  check('نسخهٔ قبلی سند را روی سایز دیگر نشانده بود', r.misplaced, 53)
  check('بعد از اصلاح یک‌باره: گوتکه', r.repaired.gotke, 48)
  check('بعد از اصلاح یک‌باره: سایز دیگر', r.repaired.other, 5)
  check('بعد از اصلاح یک‌باره: کنترل حساب‌ها سالم', r.repaired.mismatches, 0)
  check('قیمت نو بعد از اثر سند رسیده هنوز فرستاده می‌شود', r.keptStamp, true)
  for (const f of failures) console.log('❌', f)
  code = failures.length ? 1 : 0
} finally {
  await browser?.close()
  server.kill('SIGTERM')
}
process.exit(code)
