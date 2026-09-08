// Synthetic IndexedDB only; no production login, account or network writes.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5197/ledger-sale-test'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5197', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' })
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  await page.route('**/*', route => {
    const u = new URL(route.request().url())
    if (u.hostname !== 'localhost') return route.abort()
    if (u.pathname === '/src/main.tsx') return route.fulfill({ contentType: 'application/javascript', body: 'import "/src/index.css";' })
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async () => {
    const { db } = await import('/src/db.ts')
    const { addSale, setOpeningStock, addOpeningDebt, addPayment } = await import('/src/lib/ops.ts')
    const React = (await import('/node_modules/.vite/deps/react.js')).default
    const ReactDOM = (await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const Detail = (await import('/src/pages/customers/CustomerDetail.tsx')).default
    const c = await db.customers.add({ name: 'مشتری آزمایشی', type: 'wholesale', balance: 0 })
    const p = await db.products.add({ name: 'بوت آزمایشی', createdAt: Date.now() })
    const v = await db.variants.add({ productId:p, size:'40', color:'سیاه', stockQty:0, purchasePrice:500, retailPrice:800, wholesalePrice:800 })
    await setOpeningStock(v, 30)
    await addOpeningDebt('customer', c, 'مشتری آزمایشی', 10000, 'قرض قبلی آزمایشی')
    const sale = await addSale({ date:Date.now(), saleType:'wholesale', customerId:c, customerName:'مشتری آزمایشی', total:16000, paid:0, lines:[{variantId:v,productName:'بوت آزمایشی',size:'40',color:'سیاه',qty:20,unitPrice:800}] })
    await addPayment({date:Date.now(),partyType:'customer',partyId:c,partyName:'مشتری آزمایشی',amount:1000,via:'cash'})
    window.fixture = { c, v, sale }
    window.account = async () => ({ debt:(await db.customers.get(c)).balance, stock:(await db.variants.get(v)).stockQty, cash:(await db.cashMovements.toArray()).reduce((s,m)=>s+(m.deleted?0:m.amount),0), payments:(await db.payments.toArray()).filter(p=>!p.deleted).length, deleted:!!(await db.sales.get(sale)).deleted })
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Detail,{customer:await db.customers.get(c),onClose:()=>{}}))
  })
  await page.getByRole('button', {name:'ابطال همین فروش',exact:true}).click({timeout:5000})
  assert.deepEqual(await page.evaluate(()=>window.account()), {debt:25000,stock:10,cash:1000,payments:2,deleted:false})
  const confirm = page.getByRole('button',{name:'تأیید ابطال همین فروش',exact:true})
  assert.equal(await confirm.isEnabled(), false)
  await page.getByLabel('دلیل ابطال').fill('فقط این فروش اشتباه بود')
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth),true)
  }
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'qa-ledger-sale-cancel.png',fullPage:true})
  await confirm.evaluate(b=>{b.click();b.click()})
  await page.getByRole('heading',{name:'ابطال همین فروش',exact:true}).waitFor({state:'hidden'})
  assert.deepEqual(await page.evaluate(()=>window.account()), {debt:9000,stock:30,cash:1000,payments:2,deleted:true})
  assert.equal(await page.evaluate(async()=> (await (await import('/src/db.ts')).db.sales.get(window.fixture.sale)).cancelledReason),'فقط این فروش اشتباه بود')
  const guards = await page.evaluate(async () => {
    const { db, accessFlags } = await import('/src/db.ts')
    const { addSale, addSaleShipping } = await import('/src/lib/ops.ts')
    const { cancelLedgerSale, ledgerSaleCancellationPreview } = await import('/src/lib/ledgerSaleCancellation.ts')
    const { c, v } = window.fixture
    const id = await addSale({ date:Date.now(), saleType:'wholesale', customerId:c, total:800, paid:0, lines:[{variantId:v,productName:'بوت دیگر',size:'40',color:'سیاه',qty:1,unitPrice:800}] })
    const preview = await ledgerSaleCancellationPreview(id,c)
    const rejected = async f => { try { await f(); return false } catch { return true } }
    const emptyReason = await rejected(()=>cancelLedgerSale(id,c,' ',preview))
    accessFlags.readOnly = true
    const readOnly = await rejected(()=>cancelLedgerSale(id,c,'اشتباه',preview))
    accessFlags.readOnly = false
    await db.sales.update(id,{bookPage:'تغییر بعد از پیش‌نمایش'})
    const stale = await rejected(()=>cancelLedgerSale(id,c,'اشتباه',preview))
    const wrongCustomer = await rejected(()=>ledgerSaleCancellationPreview(id,c+100))
    await db.sales.update(id,{groupUuid:'test-linked-document'})
    const linked = await rejected(()=>ledgerSaleCancellationPreview(id,c))
    await db.sales.update(id,{groupUuid:undefined})
    const ret = await db.returns.add({kind:'customer',partyId:c,refId:id,date:Date.now(),lines:[],amount:0,settlement:'reduceDebt'})
    const returned = await rejected(()=>ledgerSaleCancellationPreview(id,c))
    await db.returns.update(ret,{deleted:true})
    await addSaleShipping(id,{total:100,customerShare:100,received:0,date:Date.now()})
    const freight = await rejected(()=>ledgerSaleCancellationPreview(id,c))
    return {emptyReason,readOnly,stale,wrongCustomer,linked,returned,freight,active:!(await db.sales.get(id)).deleted,stock:(await db.variants.get(v)).stockQty,debt:(await db.customers.get(c)).balance}
  })
  assert.deepEqual(guards,{emptyReason:true,readOnly:true,stale:true,wrongCustomer:true,linked:true,returned:true,freight:true,active:true,stock:29,debt:9900})
  assert.deepEqual(errors,[])
  console.log('PASS: ledger sale cancellation restores only its debt/stock, retains later receipt/opening debt/audit; reason required, double-click safe, responsive')
} finally { await browser?.close(); server.kill() }
