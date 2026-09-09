// Local-only: two isolated IndexedDB devices + real sync/encoding with a fake transport.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright-core'

const url = 'http://localhost:5200/direct-trade-sync'
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', '5200', '--strictPort'], { stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(url)).ok) break } catch {} await new Promise(r => setTimeout(r, 500)) }
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' })
  const remote = new Map()
  const install = async context => {
    const page = await context.newPage()
    await page.route('**/*', route => {
      const request = new URL(route.request().url())
      if (!['localhost', '127.0.0.1'].includes(request.hostname)) return route.abort()
      if (request.pathname === '/direct-trade-sync') return route.fulfill({ contentType: 'text/html', body: '<html></html>' })
      if (request.pathname === '/src/lib/supa.ts') return route.fulfill({ contentType: 'application/javascript', body: 'export async function getSupa(){return window.testServer}; export async function getProfile(){return {shop_id:"test-shop",role:"owner"}}' })
      return route.continue()
    })
    await page.goto(url)
    await page.exposeFunction('remoteQuery', async ({ table, filters, orders, limit }) => {
      const rows = [...(remote.get(table) ?? new Map()).values()].filter(row => filters.every(([kind, key, value]) => kind === 'eq' ? row[key] === value : kind === 'gte' ? row[key] >= value : row[key] > value))
      rows.sort((a,b) => { for (const key of orders) { if (a[key] < b[key]) return -1; if (a[key] > b[key]) return 1 } return 0 })
      return rows.slice(0, limit)
    })
    await page.exposeFunction('remoteUpsert', async ({ table, rows }) => {
      if (!remote.has(table)) remote.set(table, new Map())
      for (const row of rows) remote.get(table).set(row.uuid, { ...row, updated_at: `2026-09-08T00:00:${String(remote.get(table).size).padStart(2,'0')}Z` })
    })
    await page.evaluate(() => {
      window.testServer = {
        auth: { getSession: async () => ({ data: { session: {} } }) },
        from(table) {
          let filters=[], orders=[], limit=1000
          const q={ select(){return q}, eq(k,v){filters.push(['eq',k,v]);return q}, gt(k,v){filters.push(['gt',k,v]);return q}, gte(k,v){filters.push(['gte',k,v]);return q},
            or(expression){ const m=expression.match(/^updated_at.gt.(.+),and\(updated_at.eq.(.+),uuid.gt.(.+)\)$/); q._or=m; return q }, order(k){orders.push(k);return q}, limit(v){limit=v;return q},
            single:async()=>({data:{restore_generation:0}}), upsert:async rows=>{await window.remoteUpsert({table,rows});return {error:null}},
            then(resolve,reject){ return window.remoteQuery({table,filters,orders,limit}).then(data=>resolve({data:data.filter(row=>!q._or||row.updated_at>q._or[1]||(row.updated_at===q._or[2]&&row.uuid>q._or[3])),error:null}),reject) } }
          return q
        }
      }
    })
    return page
  }
  const a = await install(await browser.newContext()), b = await install(await browser.newContext())
  const seed = async (page, padding) => page.evaluate(async padding => {
    const { db, SYNC_TABLES } = await import('/src/db.ts'); await db.open()
    for (const t of SYNC_TABLES) await db.table(t).clear(); await db.syncState.clear()
    for(let i=0;i<padding;i++) await db.customers.add({uuid:`pad-${padding}-${i}`,name:'pad',type:'retail',balance:0,deleted:true})
    const customerId=await db.customers.add({uuid:'customer-u',name:'Customer',type:'retail',balance:0})
    for(let i=0;i<padding;i++) await db.suppliers.add({uuid:`spad-${padding}-${i}`,name:'pad',balance:0,deleted:true})
    const supplierId=await db.suppliers.add({uuid:'supplier-u',name:'Supplier',balance:0})
    return {customerId,supplierId}
  }, padding)
  const idsA=await seed(a,0), idsB=await seed(b,3)
  await a.evaluate(async ids => {
    const {db}=await import('/src/db.ts'); const meta={uuid:'trade-u',revision:'rev-a',status:'active'}
    const lines=[{lineUuid:'line-u',productName:'Boot',size:'40',color:'Black',qty:5,unitCost:1000,unitPrice:1600}]
    await db.sales.add({uuid:'sale-u',date:1000,customerId:ids.customerId,customerName:'Customer',saleType:'wholesale',lines:[],directLines:lines,directTrade:{...meta,counterpartUuid:'purchase-u'},total:8000,paid:0,discount:0})
    await db.purchases.add({uuid:'purchase-u',date:1000,supplierId:ids.supplierId,supplierName:'Supplier',lines:[],directLines:lines,directTrade:{...meta,counterpartUuid:'sale-u'},total:5000,paid:0,received:false})
    await db.payments.bulkAdd([
      {uuid:'pay-c',date:1001,partyType:'customer',partyId:ids.customerId,partyName:'Customer',amount:3000,cashDelta:3000,via:'cash',directPayment:{tradeUuid:'trade-u',route:'customerCash'}},
      {uuid:'pay-d',date:1002,partyType:'customer',partyId:ids.customerId,partyName:'Customer',amount:2000,cashDelta:0,directPayment:{tradeUuid:'trade-u',route:'customerToSupplier',supplierId:ids.supplierId}}
    ])
    // These are literal fixture rows until direct operations exist; mirror their shared effects.
    await db.customers.update(ids.customerId,{balance:3000}); await db.suppliers.update(ids.supplierId,{balance:3000})
    await (await import('/src/lib/sync.ts')).syncNow(true)
  }, idsA)
  const tokenA=await a.evaluate(async()=>(await (await import('/src/lib/directTradeState.ts')).loadDirectTrade('trade-u')).token)
  const result=await b.evaluate(async ids => {
    const {db,accessFlags}=await import('/src/db.ts'); const sync=await import('/src/lib/sync.ts'); const stateApi=await import('/src/lib/directTradeState.ts')
    await sync.syncNow(true)
    const first=await stateApi.loadDirectTrade('trade-u'); const before=first.token
    await sync.syncNow(true); const after=(await stateApi.loadDirectTrade('trade-u')).token
    const payment=await db.payments.where('uuid').equals('pay-d').first()
    const enabledBefore=await stateApi.directFeatureEnabled(); await db.settings.put({key:'directTrades.enabled',value:true}); const enabledAfter=await stateApi.directFeatureEnabled()
    accessFlags.readOnly=true; let readOnlyRejected=false; try{stateApi.assertDirectWriteReady(first)}catch{readOnlyRejected=true} accessFlags.readOnly=false
    let staleRejected=false; try{stateApi.assertDirectWriteReady(first,'wrong')}catch{staleRejected=true}
    const purchase=await db.purchases.where('uuid').equals('purchase-u').first(); await db.purchases.delete(purchase.id)
    const partialTradeStatus=(await stateApi.loadDirectTrade('trade-u')).status; await db.purchases.add(purchase)
    await db.purchases.update(purchase.id,{directTrade:{...purchase.directTrade,revision:'rev-mismatch'}})
    const mismatchStatus=(await stateApi.loadDirectTrade('trade-u')).status
    await db.purchases.update(purchase.id,{directTrade:purchase.directTrade})
    let disabledRejected=false; try{stateApi.assertDirectWriteReady(first)}catch{disabledRejected=true}
    return {effects:{customer:first.balances.customerRemaining,supplier:first.balances.supplierRemaining,cash:first.balances.cashDelta},resolvedLocalRefs:ids.customerId===payment.partyId&&ids.supplierId===payment.directPayment.supplierId,afterReplay:after,beforeReplay:before,status:first.status,partialTradeStatus,mismatchStatus,enabledBefore,enabledAfter,readOnlyRejected,staleRejected,disabledRejected}
  },idsB)
  assert.deepEqual(result.effects,{customer:3000,supplier:3000,cash:3000})
  assert.equal(idsA.customerId===idsB.customerId && idsA.supplierId===idsB.supplierId,false)
  assert.equal(result.resolvedLocalRefs,true)
  assert.equal(result.afterReplay,result.beforeReplay)
  assert.equal(result.beforeReplay,tokenA,'tokens must not contain device-local numeric IDs')
  assert.equal(result.status,'ready')
  assert.equal(result.partialTradeStatus,'incomplete'); assert.equal(result.mismatchStatus,'conflict')
  assert.equal(result.enabledBefore,false); assert.equal(result.enabledAfter,true)
  assert.equal(result.readOnlyRejected,true); assert.equal(result.staleRejected,true); assert.equal(result.disabledRejected,true)

  // Strict required-party decoding: never accept the sender's numeric fallback.
  const missing=await b.evaluate(async()=>{
    const {db}=await import('/src/db.ts'); const {applyRemoteRow}=await import('/src/lib/sync.ts')
    let rejected=false; try{await applyRemoteRow('payments',{uuid:'missing-party',deleted:false,data:{date:2,partyType:'customer',partyId:999,partyUuid:'missing-u',partyName:'Missing',amount:1,cashDelta:1,directPayment:{tradeUuid:'trade-u',route:'customerCash'}}})}catch{rejected=true}
    return {rejected,stored:Boolean(await db.payments.where('uuid').equals('missing-party').first())}
  })
  assert.deepEqual(missing,{rejected:true,stored:false})
  const adversarial=await b.evaluate(async ids=>{
    const {db}=await import('/src/db.ts'); const {applyRemoteRow}=await import('/src/lib/sync.ts'); const {loadDirectTrade}=await import('/src/lib/directTradeState.ts')
    await db.payments.add({uuid:'pay-concurrent',date:1003,partyType:'customer',partyId:ids.customerId,partyName:'Customer',amount:4000,cashDelta:4000,via:'cash',directPayment:{tradeUuid:'trade-u',route:'customerCash'}})
    const overallocated=(await loadDirectTrade('trade-u')).status; await db.payments.where('uuid').equals('pay-concurrent').delete()
    const sale=await db.sales.where('uuid').equals('sale-u').first(), purchase=await db.purchases.where('uuid').equals('purchase-u').first()
    await db.sales.update(sale.id,{directTrade:{...sale.directTrade,status:'cancelled'},cancelledAt:1000})
    await db.purchases.update(purchase.id,{directTrade:{...purchase.directTrade,status:'cancelled'},cancelledAt:1000})
    const cancellationVsPayment=(await loadDirectTrade('trade-u')).status
    await db.sales.update(sale.id,{directTrade:sale.directTrade,cancelledAt:undefined}); await db.purchases.update(purchase.id,{directTrade:purchase.directTrade,cancelledAt:undefined})
    const data={...sale,id:undefined,customerId:undefined,customerUuid:'customer-u',deleted:false,directTrade:{...sale.directTrade,revision:'rev-left',previousRevision:'rev-a'}}
    await applyRemoteRow('sales',{uuid:'sale-u',deleted:false,data}); await applyRemoteRow('sales',{uuid:'sale-u',deleted:false,data:{...data,directTrade:{...data.directTrade,revision:'rev-right'}}})
    const firstOrder=(await db.sales.where('uuid').equals('sale-u').first()).directTrade.revision
    await db.sales.update(sale.id,{directTrade:sale.directTrade}); await db.syncState.filter(r=>r.key.startsWith('directConflict:trade-u:sales:')).delete()
    await applyRemoteRow('sales',{uuid:'sale-u',deleted:false,data:{...data,directTrade:{...data.directTrade,revision:'rev-right'}}}); await applyRemoteRow('sales',{uuid:'sale-u',deleted:false,data})
    const secondOrder=(await db.sales.where('uuid').equals('sale-u').first()).directTrade.revision
    await applyRemoteRow('sales',{uuid:'sale-u',deleted:false,data:{...data,directTrade:sale.directTrade}})
    const afterPredecessor=(await db.sales.where('uuid').equals('sale-u').first()).directTrade.revision
    return {overallocated,cancellationVsPayment,firstOrder,secondOrder,afterPredecessor,conflict:(await loadDirectTrade('trade-u')).status}
  },idsB)
  assert.deepEqual(adversarial,{overallocated:'conflict',cancellationVsPayment:'conflict',firstOrder:'rev-right',secondOrder:'rev-right',afterPredecessor:'rev-right',conflict:'conflict'})
  const cursorBefore=await b.evaluate(async()=>(await (await import('/src/db.ts')).db.syncState.get('pullUuid:payments'))?.value)
  remote.get('payments').set('zz-missing-party',{uuid:'zz-missing-party',generation:0,updated_at:'2026-09-08T00:01:00Z',device_id:'other-device',deleted:false,data:{date:2,partyType:'customer',partyUuid:'missing-u',partyName:'Missing',amount:1,cashDelta:1,directPayment:{tradeUuid:'trade-u',route:'customerCash'}}})
  const failedPull=await b.evaluate(async()=>{try{await (await import('/src/lib/sync.ts')).syncNow(true);return false}catch{return true}})
  const cursorAfter=await b.evaluate(async()=>(await (await import('/src/db.ts')).db.syncState.get('pullUuid:payments'))?.value)
  assert.equal(failedPull,true); assert.equal(cursorAfter,cursorBefore,'unapplied required-party row must not advance its cursor')
  console.log('PASS: direct trade UUID replay, stable state token, strict party references, eligibility guards')
} finally { await browser?.close(); server.kill() }
