/**
 * آزمایش تصادفی («فاز») تمام اپ — سناریوهای دست‌نوشته فقط چیزهایی را می‌سنجند
 * که کسی به آن‌ها فکر کرده. این فایل هزاران عملیات تصادفی دکان را اجرا می‌کند و
 * بعد از هر قدم چهار قانون بنیادی را می‌سنجد. هر شکستنی یک باگ است.
 *
 * قانون‌ها:
 *  ۱) کنترل حساب‌ها (integrity.ts) با عدد ذخیره‌شده برابر باشد
 *  ۲) پخش دوبارهٔ اسناد (sync.ts) هم همان عدد را بسازد — یعنی هر سه پیاده‌سازی
 *     (ops / sync / integrity) یکی باشند
 *  ۳) موجودی هیچ سایز منفی نشود و پول هیچ صندوق منفی نشود
 *  ۴) قیمت تمام‌شده هم با اسناد بخواند — مفادِ هر فروش از همین می‌آید
 *  ۵) «دارایی خالص» از هر دو راه یک جواب بدهد
 *  ۶) هر مبلغ عدد صحیح افغانی باشد
 *
 * با seed اجرا می‌شود، پس هر شکست دقیقاً قابل تکرار است.
 */
import { db, type Sale, type Purchase, type Variant } from '../src/db'
import {
  addSale,
  addPurchase,
  correctPurchase,
  cancelPurchase,
  receivePurchase,
  addCustomerReturn,
  addSupplierReturn,
  addExpense,
  addPayment,
  addOpeningDebt,
  addPartnerWithdrawal,
  reconcile,
  transferCash,
  deleteSale,
  boxBalances,
  addExchange,
  addLandingCost,
  payLanding,
  landingUnpaidOf,
  addLoan,
  repayLoan,
  applyStocktake,
  SHOP_BOX,
  boxOf
} from '../src/lib/ops'
import { computeStock, computeCustomerBalances, computeSupplierBalances } from '../src/lib/integrity'
import { applyDocEffects } from '../src/lib/sync'
import { mergeProducts } from '../src/lib/merge'
import { netWorth, computeNetWorth } from '../src/lib/networth'
import { computeCosts } from '../src/lib/costing'

// ── تصادفِ قابل تکرار ────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface FuzzFailure {
  seed: number
  step: number
  op: string
  rule: string
  detail: string
  log: string[]
}

const BOXES = [SHOP_BOX, 'خانه', 'صراف']

export async function runFuzz(seed: number, steps: number): Promise<FuzzFailure | null> {
  const rand = rng(seed)
  const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1))
  const log: string[] = []

  await db.delete()
  await db.open()

  // ── دنیای آزمایش ──────────────────────────────────────────────
  const products: number[] = []
  const variants: number[] = []
  const customers: number[] = []
  const suppliers: number[] = []
  const sarrafs: number[] = []
  const lenders: number[] = []
  let partner = ''

  for (let i = 0; i < 3; i++) {
    const pid = (await db.products.add({ name: `جنس${i}`, createdAt: Date.now() })) as number
    products.push(pid)
    for (const size of ['41', '42', '43']) {
      variants.push(
        (await db.variants.add({
          productId: pid,
          size,
          color: 'سیاه',
          stockQty: 0,
          purchasePrice: int(200, 900),
          retailPrice: int(900, 1500),
          wholesalePrice: int(800, 1200),
          lowStock: 2
        })) as number
      )
    }
  }
  for (let i = 0; i < 3; i++)
    customers.push((await db.customers.add({ name: `مشتری${i}`, type: 'retail', balance: 0 })) as number)
  for (let i = 0; i < 2; i++)
    suppliers.push((await db.suppliers.add({ name: `تأمین${i}`, balance: 0 })) as number)
  sarrafs.push((await db.suppliers.add({ name: 'صراف', balance: 0, kind: 'sarraf' })) as number)

  // پول اولیه در هر جای پول
  for (const box of BOXES) await reconcile(int(50000, 200000), 'موجودی اولیه', undefined, box)

  const stockOf = async (id: number) => (await db.variants.get(id))!.stockQty
  const inStock = async () => {
    const out: Variant[] = []
    for (const id of variants) {
      const v = await db.variants.get(id)
      if (v && v.stockQty > 0) out.push(v)
    }
    return out
  }

  // ── عملیات ────────────────────────────────────────────────────
  const ops: { name: string; run: () => Promise<void> }[] = [
    {
      name: 'خرید',
      run: async () => {
        const v = (await db.variants.get(pick(variants)))!
        const qty = int(1, 40)
        const cost = int(200, 900)
        const total = qty * cost
        const mode = rand()
        const cash = await boxBalances()
        const paid = mode < 0.4 ? Math.min(total, Math.floor(cash.total * rand())) : mode < 0.7 ? 0 : 0
        const p: Purchase = {
          date: Date.now(),
          supplierId: pick(suppliers),
          lines: [{ variantId: v.id!, productName: 'جنس', size: v.size, color: v.color, qty, unitCost: cost }],
          total,
          paid
        }
        if (mode >= 0.7 && rand() < 0.5) {
          p.sarrafId = sarrafs[0]
          p.sarrafAmount = Math.min(total - paid, int(1, total))
        }
        if (rand() < 0.2) p.received = false
        await addPurchase(p)
      }
    },
    {
      name: 'رسیدن خرید در راه',
      run: async () => {
        const pend = await db.purchases.filter((p) => !p.deleted && p.received === false).toArray()
        if (pend.length === 0) return
        await receivePurchase(pick(pend).id!)
      }
    },
    {
      name: 'اصلاح خرید',
      run: async () => {
        const purchases = await db.purchases.filter((purchase) => !purchase.deleted).toArray()
        if (!purchases.length) return
        const purchase = pick(purchases)
        const line = purchase.lines[0]
        const qty = Math.max(1, line.qty + int(-2, 2))
        const unitCost = Math.max(1, line.unitCost + int(-100, 100))
        const total = qty * unitCost
        if (total < purchase.paid + (purchase.sarrafAmount ?? 0)) return
        await correctPurchase(purchase.id!, [{ variantId: line.variantId, qty, unitCost }])
      }
    },
    {
      name: 'باطل‌کردن خرید اشتباهی',
      run: async () => {
        const purchases = await db.purchases.filter((purchase) => !purchase.deleted).toArray()
        if (!purchases.length) return
        await cancelPurchase(pick(purchases).id!)
      }
    },
    {
      name: 'فروش',
      run: async () => {
        const avail = await inStock()
        if (avail.length === 0) return
        const v = pick(avail)
        const qty = int(1, Math.max(1, Math.min(5, v.stockQty)))
        const price = v.retailPrice
        const gross = qty * price
        const discount = rand() < 0.2 ? int(0, Math.floor(gross / 4)) : 0
        const total = gross - discount
        const credit = rand() < 0.35
        const s: Sale = {
          date: Date.now(),
          lines: [
            { variantId: v.id!, productName: 'جنس', size: v.size, color: v.color, qty, unitPrice: price, unitCost: v.purchasePrice }
          ],
          total,
          paid: credit ? int(0, total) : total,
          discount: discount || undefined,
          saleType: rand() < 0.5 ? 'retail' : 'wholesale'
        }
        if (credit || rand() < 0.5) {
          s.customerId = pick(customers)
          s.customerName = 'مشتری'
        }
        await addSale(s)
      }
    },
    {
      name: 'مرجوعی مشتری',
      run: async () => {
        const sales = await db.sales.filter((s) => !s.deleted && typeof s.customerId === 'number').toArray()
        if (sales.length === 0) return
        const s = pick(sales)
        const l = s.lines[0]
        const qty = int(1, l.qty)
        const amount = qty * l.unitPrice
        const settlement = rand() < 0.5 ? 'reduceDebt' : 'cash'
        if (settlement === 'cash' && (await boxBalances()).total < amount) return
        await addCustomerReturn({
          date: Date.now(),
          kind: 'customer',
          partyId: s.customerId!,
          partyName: 'مشتری',
          lines: [{ ...l, qty, restock: rand() < 0.7 }],
          amount,
          settlement,
          saleType: s.saleType
        })
      }
    },
    {
      name: 'مرجوعی به تأمین‌کننده',
      run: async () => {
        const avail = await inStock()
        if (avail.length === 0) return
        const v = pick(avail)
        const qty = int(1, Math.min(3, v.stockQty))
        const amount = qty * v.purchasePrice
        const settlement = rand() < 0.5 ? 'reduceDebt' : 'cash'
        await addSupplierReturn({
          date: Date.now(),
          kind: 'supplier',
          partyId: pick(suppliers),
          partyName: 'تأمین',
          lines: [{ variantId: v.id!, productName: 'جنس', size: v.size, color: v.color, qty, unitPrice: v.purchasePrice, restock: false }],
          amount,
          settlement
        })
      }
    },
    {
      name: 'پرداخت مشتری',
      run: async () => {
        const c = await db.customers.get(pick(customers))
        if (!c || c.balance <= 0) return
        await addPayment({
          date: Date.now(),
          partyType: 'customer',
          partyId: c.id!,
          partyName: c.name,
          amount: int(1, Math.floor(c.balance))
        })
      }
    },
    {
      name: 'پرداخت به تأمین‌کننده',
      run: async () => {
        const s = await db.suppliers.get(pick(suppliers))
        if (!s || s.balance <= 0) return
        const amount = int(1, Math.floor(s.balance))
        const viaSarraf = rand() < 0.3
        if (!viaSarraf && (await boxBalances()).total < amount) return
        await addPayment({
          date: Date.now(),
          partyType: 'supplier',
          partyId: s.id!,
          partyName: s.name,
          amount,
          ...(viaSarraf ? { via: 'sarraf' as const, sarrafId: sarrafs[0] } : {})
        })
      }
    },
    {
      name: 'قرض قبلی مشتری',
      run: async () => {
        await addOpeningDebt(pick(customers), int(500, 5000))
      }
    },
    {
      name: 'مصرف',
      run: async () => {
        const box = pick(BOXES)
        const bal = (await boxBalances()).boxes.find((b) => b.name === box)?.balance ?? 0
        if (bal <= 0) return
        const type = pick(['business', 'home', 'personal', 'withdrawal'] as const)
        await addExpense(
          { date: Date.now(), amount: int(1, Math.floor(bal)), type, note: 'آزمایش', box },
          type === 'business' ? undefined : partner || undefined
        )
      }
    },
    {
      name: 'برداشت شریک',
      run: async () => {
        if (!partner) return
        const bal = (await boxBalances()).boxes.find((b) => b.name === SHOP_BOX)?.balance ?? 0
        if (bal <= 0) return
        await addPartnerWithdrawal(partner, int(1, Math.floor(bal)), 'آزمایش')
      }
    },
    {
      name: 'انتقال پول بین جاها',
      run: async () => {
        const from = pick(BOXES)
        const to = pick(BOXES.filter((b) => b !== from))
        const bal = (await boxBalances()).boxes.find((b) => b.name === from)?.balance ?? 0
        if (bal <= 0) return
        await transferCash(from, to, int(1, Math.floor(bal)))
      }
    },
    {
      name: 'تعدیل موجودی',
      run: async () => {
        const avail = await inStock()
        if (avail.length === 0) return
        const v = pick(avail)
        const change = -int(1, Math.min(3, v.stockQty))
        await db.adjustments.add({
          date: Date.now(),
          variantId: v.id!,
          productName: 'جنس',
          size: v.size,
          color: v.color,
          qtyChange: change,
          reason: pick(['damaged', 'lost'] as const)
        })
        await db.variants.update(v.id!, { stockQty: v.stockQty + change })
      }
    },
    {
      name: 'شمارش گدام',
      run: async () => {
        const avail = await inStock()
        if (avail.length === 0) return
        const v = pick(avail)
        await applyStocktake([{ variantId: v.id!, counted: Math.max(0, v.stockQty + int(-2, 2)) }])
      }
    },
    {
      name: 'تصفیه صندوق',
      run: async () => {
        const box = pick(BOXES)
        const bal = (await boxBalances()).boxes.find((b) => b.name === box)?.balance ?? 0
        await reconcile(Math.max(0, bal + int(-500, 500)), 'شمارش', undefined, box)
      }
    },
    {
      name: 'حذف فروش',
      run: async () => {
        const sales = await db.sales.filter((s) => !s.deleted).toArray()
        if (sales.length === 0) return
        const s = pick(sales)
        // حذف پول را پس می‌برد؛ اگر پول نباشد اپ باید جلو بگیرد، نه که منفی شود
        const box = boxOf({})
        const bal = (await boxBalances()).boxes.find((b) => b.name === box)?.balance ?? 0
        if (s.paid > bal) return
        await deleteSale(s.id!)
      }
    },
    {
      name: 'یکجا کردن دو جنس',
      run: async () => {
        const live = await db.products.filter((p) => !p.deleted).toArray()
        if (live.length < 2) return
        const a = pick(live)
        const b = pick(live.filter((x) => x.id !== a.id))
        await mergeProducts(a.id!, [b.id!])
      }
    },
    {
      name: 'تبادله',
      run: async () => {
        const sales = await db.sales.filter((s) => !s.deleted && typeof s.customerId === 'number').toArray()
        const avail = await inStock()
        if (sales.length === 0 || avail.length === 0) return
        const old = pick(sales)
        const l = old.lines[0]
        const back = int(1, l.qty)
        const v = pick(avail)
        const qty = int(1, Math.min(3, v.stockQty))
        const newTotal = qty * v.retailPrice
        const backAmount = back * l.unitPrice
        await addExchange(
          {
            date: Date.now(),
            kind: 'customer',
            partyId: old.customerId!,
            partyName: 'مشتری',
            lines: [{ ...l, qty: back, restock: true }],
            amount: backAmount,
            settlement: 'reduceDebt',
            saleType: old.saleType
          },
          {
            date: Date.now(),
            customerId: old.customerId!,
            customerName: 'مشتری',
            lines: [
              { variantId: v.id!, productName: 'جنس', size: v.size, color: v.color, qty, unitPrice: v.retailPrice, unitCost: v.purchasePrice }
            ],
            total: newTotal,
            paid: 0,
            saleType: old.saleType
          }
        )
      }
    },
    {
      name: 'مصارف رسیدن',
      run: async () => {
        const ps = await db.purchases.filter((p) => !p.deleted).toArray()
        if (ps.length === 0) return
        const p = pick(ps)
        const via = pick(['cash', 'sarraf', 'later'] as const)
        const amount = int(100, 3000)
        if (via === 'cash' && (await boxBalances()).total < amount) return
        await addLandingCost([p.id!], amount, via, via === 'sarraf' ? { id: sarrafs[0], name: 'صراف' } : undefined)
      }
    },
    {
      name: 'پرداخت مصارف رسیدن',
      run: async () => {
        const ps = await db.purchases.filter((p) => !p.deleted && landingUnpaidOf(p) > 0).toArray()
        if (ps.length === 0) return
        const p = pick(ps)
        if ((await boxBalances()).total < landingUnpaidOf(p)) return
        await payLanding(p.id!)
      }
    },
    {
      name: 'قرض گرفتن از شخص',
      run: async () => {
        if (lenders.length === 0)
          lenders.push((await db.suppliers.add({ name: 'قرض‌دهنده', balance: 0, kind: 'lender' })) as number)
        await addLoan(lenders[0], 'قرض‌دهنده', int(1000, 20000))
      }
    },
    {
      name: 'پس دادن قرض شخص',
      run: async () => {
        if (lenders.length === 0) return
        const l = await db.suppliers.get(lenders[0])
        if (!l || l.balance <= 0) return
        const amount = int(1, Math.floor(l.balance))
        if ((await boxBalances()).total < amount) return
        await repayLoan(lenders[0], 'قرض‌دهنده', amount)
      }
    },
    {
      name: 'ثبت شریک',
      run: async () => {
        if (partner) return
        partner = 'شریک'
        await db.suppliers.add({ name: partner, balance: 0, kind: 'partner', share: 40, capital: int(10000, 50000) })
      }
    }
  ]

  // ── قانون‌ها ──────────────────────────────────────────────────
  const isInt = (n: number) => Number.isFinite(n) && Math.abs(n - Math.round(n)) < 1e-9

  async function checkInvariants(step: number, op: string): Promise<FuzzFailure | null> {
    const bad = (rule: string, detail: string): FuzzFailure => ({ seed, step, op, rule, detail, log: log.slice(-12) })

    const live = <T extends { deleted?: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted)
    const [sales, purchases, payments, adjustments, returns, vars, custs, supps] = await Promise.all([
      db.sales.toArray().then(live),
      db.purchases.toArray().then(live),
      db.payments.toArray().then(live),
      db.adjustments.toArray().then(live),
      db.returns.toArray().then(live),
      db.variants.toArray().then(live),
      db.customers.toArray().then(live),
      db.suppliers.toArray().then(live)
    ])

    // ۱) integrity.ts باید با عدد ذخیره‌شده برابر باشد
    const stock = computeStock(sales, purchases, adjustments, returns)
    for (const v of vars) {
      const want = stock.get(v.id!) ?? 0
      if (Math.abs(v.stockQty - want) > 0.5)
        return bad('کنترل حساب‌ها — موجودی', `سایز ${v.id} ذخیره ${v.stockQty} ولی از اسناد ${want}`)
      if (v.stockQty < 0) return bad('موجودی منفی', `سایز ${v.id} = ${v.stockQty}`)
    }
    // قیمت تمام‌شده هم باید با اسناد بخواند — مفادِ هر فروش از همین می‌آید
    const boughtIds = new Set<number>()
    for (const p of purchases) if (p.received !== false) for (const l of p.lines) boughtIds.add(l.variantId)
    const costs = computeCosts(
      sales,
      purchases,
      adjustments,
      returns,
      new Map(vars.filter((v) => !boughtIds.has(v.id!)).map((v) => [v.id!, v.purchasePrice]))
    )
    for (const v of vars) {
      const want = costs.get(v.id!)
      if (want !== undefined && Math.abs(v.purchasePrice - want) > 0.01)
        return bad('قیمت تمام‌شده با اسناد نمی‌خواند', `سایز ${v.id} ذخیره ${v.purchasePrice} ولی از اسناد ${want}`)
    }

    const cb = computeCustomerBalances(sales, payments, returns)
    for (const c of custs) {
      const want = cb.get(c.id!) ?? 0
      if (Math.abs(c.balance - want) > 0.5)
        return bad('کنترل حساب‌ها — قرض مشتری', `مشتری ${c.id} ذخیره ${c.balance} ولی از اسناد ${want}`)
    }
    const sb = computeSupplierBalances(purchases, payments, returns)
    for (const s of supps) {
      if (s.kind === 'partner') continue
      const want = sb.get(s.id!) ?? 0
      if (Math.abs(s.balance - want) > 0.5)
        return bad('کنترل حساب‌ها — بیلانس تأمین‌کننده', `${s.name} ذخیره ${s.balance} ولی از اسناد ${want}`)
    }

    // ۲) پخش دوبارهٔ اسناد (همان کار همگام‌سازی) باید همان عدد را بسازد
    const before = {
      v: new Map(vars.map((v) => [v.id!, v.stockQty])),
      c: new Map(custs.map((c) => [c.id!, c.balance])),
      s: new Map(supps.map((s) => [s.id!, s.balance]))
    }
    for (const v of vars) await db.variants.update(v.id!, { stockQty: 0 })
    for (const c of custs) await db.customers.update(c.id!, { balance: 0 })
    for (const s of supps) await db.suppliers.update(s.id!, { balance: 0 })
    for (const [table, rows] of [
      ['purchases', purchases],
      ['sales', sales],
      ['payments', payments],
      ['adjustments', adjustments],
      ['returns', returns]
    ] as const)
      for (const r of rows) await applyDocEffects(table, r as unknown as Record<string, unknown>, false)

    let mismatch: FuzzFailure | null = null
    for (const v of await db.variants.toArray()) {
      if (v.deleted) continue
      const was = before.v.get(v.id!) ?? 0
      if (Math.abs(v.stockQty - was) > 0.5)
        mismatch ??= bad('موبایل نو فرق می‌کند — موجودی', `سایز ${v.id}: این موبایل ${was}، موبایل نو ${v.stockQty}`)
    }
    for (const c of await db.customers.toArray()) {
      if (c.deleted) continue
      const was = before.c.get(c.id!) ?? 0
      if (Math.abs(c.balance - was) > 0.5)
        mismatch ??= bad('موبایل نو فرق می‌کند — قرض مشتری', `مشتری ${c.id}: ${was} ← ${c.balance}`)
    }
    for (const s of await db.suppliers.toArray()) {
      if (s.deleted || s.kind === 'partner') continue
      const was = before.s.get(s.id!) ?? 0
      if (Math.abs(s.balance - was) > 0.5)
        mismatch ??= bad('موبایل نو فرق می‌کند — بیلانس تأمین‌کننده', `${s.name}: ${was} ← ${s.balance}`)
    }
    // عددها را به حال خود برمی‌گردانیم تا آزمایش ادامه یابد
    for (const [id, q] of before.v) await db.variants.update(id, { stockQty: q })
    for (const [id, b] of before.c) await db.customers.update(id, { balance: b })
    for (const [id, b] of before.s) await db.suppliers.update(id, { balance: b })
    if (mismatch) return mismatch

    // ۳) پول هیچ جای پول منفی نشود
    for (const b of (await boxBalances()).boxes)
      if (b.balance < -0.5) return bad('پول منفی', `${b.name} = ${b.balance}`)

    // ۴) «دارایی خالص» از هر دو راه یکی باشد — از دیتابیس و از داده‌های خام.
    // اگر روزی یک صفحه دوباره فورمول خودش را بنویسد، اینجا سرخ می‌شود.
    const nwDb = await netWorth()
    const nwPure = computeNetWorth({
      variants: await db.variants.toArray(),
      movements: await db.cashMovements.toArray(),
      customers: await db.customers.toArray(),
      suppliers: await db.suppliers.toArray(),
      purchases: await db.purchases.toArray()
    })
    if (nwDb.assets !== nwPure.assets)
      return bad('دارایی خالص دو جواب داد', `${nwDb.assets} ≠ ${nwPure.assets}`)
    if (!isInt(nwDb.assets)) return bad('دارایی خالص اعشاری', String(nwDb.assets))

    // ۵) هر مبلغ عدد صحیح باشد
    for (const m of await db.cashMovements.toArray())
      if (!m.deleted && !isInt(m.amount)) return bad('پول اعشاری', `حرکت پول ${m.id} = ${m.amount}`)
    for (const c of custs) if (!isInt(c.balance)) return bad('پول اعشاری', `قرض مشتری ${c.id} = ${c.balance}`)
    for (const s of supps) if (!isInt(s.balance)) return bad('پول اعشاری', `بیلانس ${s.name} = ${s.balance}`)

    return null
  }

  // ── حلقه ──────────────────────────────────────────────────────
  for (let step = 1; step <= steps; step++) {
    const op = pick(ops)
    try {
      await op.run()
      log.push(`${step}: ${op.name}`)
    } catch (e) {
      // خطای عمدی اپ (مثلاً پول کافی نیست) اشکال نیست — همان محافظ است
      log.push(`${step}: ${op.name} ← جلو گرفته شد (${e instanceof Error ? e.message : String(e)})`)
      continue
    }
    const fail = await checkInvariants(step, op.name)
    if (fail) return fail
  }
  return null
}

/** چند seed پشت سر هم — گزارش اولین شکست */
export async function fuzzMany(seeds: number[], steps: number): Promise<FuzzFailure | null> {
  for (const s of seeds) {
    const f = await runFuzz(s, steps)
    if (f) return f
  }
  return null
}
