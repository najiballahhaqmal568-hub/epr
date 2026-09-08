// Real cart UI with synthetic local data. Block all external requests.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'
const url = 'http://localhost:5198/bulk-price-test'
const server = spawn(process.execPath,['node_modules/vite/bin/vite.js','--port','5198','--strictPort'],{stdio:'ignore'})
let browser
try {
  for(let i=0;i<60;i++){try{if((await fetch(url)).ok)break}catch{}await new Promise(r=>setTimeout(r,500))}
  browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
  const page = await browser.newPage({viewport:{width:390,height:844}})
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.route('**/*',route=>{
    const u=new URL(route.request().url())
    if(u.hostname!=='localhost')return route.abort()
    if(u.pathname==='/src/main.tsx')return route.fulfill({contentType:'application/javascript',body:'import "/src/index.css";'})
    return route.continue()
  })
  await page.goto(url)
  await page.evaluate(async()=>{
    const {db}=await import('/src/db.ts')
    const React=(await import('/node_modules/.vite/deps/react.js')).default
    const ReactDOM=(await import('/node_modules/.vite/deps/react-dom_client.js')).default
    const Sale=(await import('/src/pages/sales/NewSaleModal.tsx')).default
    const p=await db.products.add({name:'اسکچرز',createdAt:1})
    const other=await db.products.add({name:'اسکچرز',createdAt:1})
    const ids=[]
    for(const [i,size] of ['40','41','42'].entries())ids.push(await db.variants.add({productId:i<2?p:other,size,color:i===1?'سفید':'سیاه',stockQty:20,purchasePrice:500,wholesalePrice:800,retailPrice:1000}))
    await db.sales.add({date:1,saleType:'wholesale',total:800,paid:800,lines:[{variantId:ids[0],productName:'اسکچرز',size:'40',color:'سیاه',qty:1,unitPrice:800}]})
    const lines=ids.map((id,i)=>({variantId:id,productName:'اسکچرز',size:String(40+i),color:i===1?'سفید':'سیاه',qty:i===0?2:1,unitPrice:i===2?900:800}))
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Sale,{embedded:true,draft:{id:'working',saleType:'wholesale',lines,paidStr:'',paidTouched:false,discountStr:'100',promise:'',bookPage:''},onClose:()=>{},onSaved:s=>{window.saved=s}}))
    window.stored=async()=>({prices:(await db.variants.toArray()).map(v=>v.wholesalePrice),stocks:(await db.variants.toArray()).map(v=>v.stockQty),oldPrice:(await db.sales.toArray())[0].lines[0].unitPrice})
  })
  await page.getByRole('button',{name:'تغییر قیمت همهٔ سایزهای اسکچرز',exact:true}).click({timeout:5000})
  const input=page.getByLabel('قیمت یکسان فی‌جوره (افغانی)',{exact:true})
  const apply=page.getByRole('button',{name:'اعمال به سایزهای این جنس',exact:true})
  await input.fill('-5');assert.equal(await apply.isEnabled(),false)
  await input.fill('0');assert.equal(await apply.isEnabled(),false)
  await input.fill('');assert.equal(await apply.isEnabled(),false)
  await input.fill('۷۵۰')
  for(const width of [320,390,768,1024,1440]){
    await page.setViewportSize({width,height:900})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  }
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'qa-bulk-sale-price.png',fullPage:true})
  await page.evaluate(async()=>{(await import('/src/db.ts')).accessFlags.readOnly=true})
  await apply.click()
  assert.deepEqual(await page.getByLabel(/^قیمت اسکچرز /).evaluateAll(nodes=>nodes.map(n=>n.value)),['800','800','900'])
  await page.evaluate(async()=>{(await import('/src/db.ts')).accessFlags.readOnly=false})
  await apply.click()
  const prices=await page.getByLabel(/^قیمت اسکچرز /).evaluateAll(nodes=>nodes.map(n=>n.value))
  assert.deepEqual(prices,['750','750','900'])
  await page.getByLabel('قیمت اسکچرز 41',{exact:true}).fill('760')
  assert.deepEqual(await page.getByLabel(/^قیمت اسکچرز /).evaluateAll(nodes=>nodes.map(n=>n.value)),['750','760','900'])
  assert.deepEqual(await page.evaluate(()=>window.stored()),{prices:[800,800,800],stocks:[20,20,20],oldPrice:800})
  const draft=await page.evaluate(async()=> (await import('/src/lib/saleDrafts.ts')).readWorkingSale())
  assert.deepEqual(draft.lines.map(l=>l.unitPrice),[750,760,900])
  assert.equal(draft.discountStr,'100')
  await page.getByRole('button',{name:'ثبت فروش',exact:true}).click()
  await page.waitForFunction(()=>!!window.saved)
  assert.equal(await page.evaluate(()=>window.saved.total),3060)
  assert.equal((await page.evaluate(()=>window.stored())).oldPrice,800)
  assert.deepEqual(errors,[])
  console.log('PASS: bulk price is product-ID scoped, per-pair, draft-only until save; single-size edits, discount and historical/catalog prices preserved')
}finally{await browser?.close();server.kill()}
