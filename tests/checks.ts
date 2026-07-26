/**
 * آزمایش خودکار حساب‌های اپ — «سال شبیه‌سازی‌شدهٔ دکان» و ۱۳ سناریوی دیگر.
 *
 * هر سناریو با دیتابیس خالی شروع می‌شود، عملیات واقعی اپ را اجرا می‌کند،
 * و اعداد را با ارقامی که دستی حساب شده مقایسه می‌کند.
 *
 * این فایل جزو اپ نیست — فقط با `npm test` اجرا می‌شود و در نسخهٔ نصبی نمی‌آید.
 */
import { db, type Sale, type Purchase, type Expense, type ReturnDoc, type Variant } from '../src/db'
import {
  addSale,
  addPurchase,
  addLandingCost,
  payLanding,
  landingUnpaidOf,
  receivePurchase,
  addCustomerReturn,
  addSupplierReturn,
  addExchange,
  addExpense,
  addPayment,
  addOpeningDebt,
  addCapital,
  addPartnerWithdrawal,
  reconcile,
  cashBalance,
  addLoan,
  repayLoan,
  convertLoanToCapital
} from '../src/lib/ops'
import { allocate, afn } from '../src/lib/ops'
import { buildCashLedger, buildCustomerLedger } from '../src/lib/ledger'
import { runIntegrityCheck, fixMismatch } from '../src/lib/integrity'
import { retailVsWholesale, byModel, byCustomer, byMonth, changePct } from '../src/lib/analytics'

// ── ابزار آزمایش ────────────────────────────────────────────────
type Check = { name: string; ok: boolean; got: unknown; want: unknown }
let current: Check[] = []

const eq = (name: string, got: number, want: number) =>
  current.push({ name, ok: Math.abs(got - want) < 0.5, got, want })

const is = (name: string, got: unknown, want: unknown) =>
  current.push({ name, ok: got === want, got, want })

async function throws(name: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    current.push({ name, ok: false, got: 'بدون خطا اجرا شد', want: 'باید خطا می‌داد' })
  } catch {
    current.push({ name, ok: true, got: 'خطا داد', want: 'خطا داد' })
  }
}

// ── ابزار ساختن دیتای نمونه ─────────────────────────────────────
async function fresh() {
  await db.delete()
  await db.open()
}

async function makeVariant(over: Partial<Variant> = {}): Promise<number> {
  const productId = (await db.products.add({ name: 'اسپرتکس' })) as number
  return (await db.variants.add({
    productId,
    size: '42',
    color: 'سیاه',
    stockQty: 0,
    purchasePrice: 0,
    retailPrice: 900,
    wholesalePrice: 800,
    lowStock: 2,
    ...over
  })) as number
}

const buy = (supplierId: number, variantId: number, qty: number, unitCost: number, over: Partial<Purchase> = {}): Purchase => ({
  date: Date.now(),
  supplierId,
  supplierName: 'تأمین‌کننده',
  lines: [{ variantId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty, unitCost }],
  total: qty * unitCost,
  paid: qty * unitCost,
  ...over
})

const sell = (variantId: number, qty: number, unitPrice: number, over: Partial<Sale> = {}): Sale => ({
  date: Date.now(),
  lines: [{ variantId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty, unitPrice }],
  total: qty * unitPrice,
  paid: qty * unitPrice,
  ...over
})

/** پر کردن صندوق برای سناریوهایی که خرید نقدی دارند */
const seedCash = (amount: number) =>
  db.cashMovements.add({ date: Date.now(), type: 'capitalIn', amount, note: 'سرمایهٔ آزمایش' })

const stockOf = async (id: number) => (await db.variants.get(id))!.stockQty
const costOf = async (id: number) => (await db.variants.get(id))!.purchasePrice
const newSupplier = (name = 'تأمین‌کننده') => db.suppliers.add({ name, balance: 0 }) as Promise<number>
const newCustomer = (name = 'مشتری') => db.customers.add({ name, type: 'retail', balance: 0 }) as Promise<number>

/** جمع دفتر صندوق — باید دقیقاً با موجودی ذخیره‌شده برابر باشد */
async function cashLedgerEnd(): Promise<number> {
  const movements = await db.cashMovements.filter((m) => !m.deleted).toArray()
  const rows = buildCashLedger(movements, (t) => t)
  return rows.length ? rows[rows.length - 1].balance : 0
}

/** جمع دفتر یک مشتری — باید دقیقاً با قرض ذخیره‌شدهٔ او برابر باشد */
async function customerLedgerEnd(customerId: number): Promise<number> {
  const sales = await db.sales.filter((x) => !x.deleted && x.customerId === customerId).toArray()
  const payments = await db.payments.filter((x) => !x.deleted && x.partyType === 'customer' && x.partyId === customerId).toArray()
  const returns = await db.returns.filter((r) => !r.deleted && r.kind === 'customer' && r.partyId === customerId).toArray()
  const rows = buildCustomerLedger(sales, payments, returns)
  return rows.length ? rows[rows.length - 1].balance : 0
}

/** مفاد از راه سود و زیان — همان فورمول داشبورد و راپور */
async function profitAndLoss(): Promise<number> {
  const sales = await db.sales.filter((s) => !s.deleted).toArray()
  const returns = await db.returns.filter((r) => !r.deleted).toArray()
  const expenses = await db.expenses.filter((e) => !e.deleted).toArray()
  const salesProfit = sales.reduce(
    (sum, s) => sum + s.lines.reduce((a, l) => a + (l.unitPrice - (l.unitCost ?? 0)) * l.qty, 0) - (s.discount ?? 0),
    0
  )
  const retProfit = returns
    .filter((r) => r.kind === 'customer')
    .reduce((s, r) => s + r.lines.reduce((a, l) => a + (l.unitPrice - (l.unitCost ?? 0)) * l.qty, 0), 0)
  const bizExp = expenses.filter((e) => e.type === 'business').reduce((s, e) => s + e.amount, 0)
  return salesProfit - retProfit - bizExp
}

/** دارایی و مفاد سال — همان فورمول کارت «شرکا و سرمایه» در راپورها */
async function settlement() {
  const variants = await db.variants.filter((v) => !v.deleted).toArray()
  const movements = await db.cashMovements.filter((m) => !m.deleted).toArray()
  const customers = await db.customers.filter((c) => !c.deleted).toArray()
  const suppliers = await db.suppliers.filter((x) => !x.deleted).toArray()
  const purchases = await db.purchases.filter((p) => !p.deleted).toArray()

  const stockValue = variants.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0)
  const cash = movements.reduce((s, m) => s + m.amount, 0)
  const receivables = customers.reduce((s, c) => s + Math.max(0, c.balance), 0)
  const customerCredits = customers.reduce((s, c) => s + Math.max(0, -c.balance), 0)
  const unpaidLanding = purchases.reduce((s, p) => s + landingUnpaidOf(p), 0)
  const others = suppliers.filter((x) => x.kind !== 'partner')
  const payables = others.reduce((s, x) => s + Math.max(0, x.balance), 0) + unpaidLanding
  const supplierCredits = others.reduce((s, x) => s + Math.max(0, -x.balance), 0)
  const assets = stockValue + cash + receivables + supplierCredits - payables - customerCredits

  const DRAW = ['withdrawal', 'homeExpense', 'personalExpense']
  const draws = movements.filter((m) => DRAW.includes(m.type))
  const wSum = draws.reduce((s, m) => s - m.amount, 0)
  const capSum = suppliers.filter((x) => x.kind === 'partner').reduce((s, p) => s + (p.capital ?? 0), 0)

  return { stockValue, cash, receivables, assets, wSum, capSum, yearProfit: assets + wSum - capSum }
}

// ── سناریوها ────────────────────────────────────────────────────
const SCENARIOS: { name: string; run: () => Promise<void> }[] = [
  {
    name: 'سال کامل دکان — دارایی = سرمایه + مفاد − برداشت',
    run: async () => {
      // سرمایهٔ نقدی دو شریک: ۱۰۰٬۰۰۰ + ۵۰٬۰۰۰
      const aId = (await db.suppliers.add({ name: 'شریک الف', balance: 0, kind: 'partner', share: 60, capital: 0 })) as number
      const bId = (await db.suppliers.add({ name: 'شریک ب', balance: 0, kind: 'partner', share: 40, capital: 0 })) as number
      await addCapital(aId, 'شریک الف', 100000)
      await addCapital(bId, 'شریک ب', 50000)

      const supId = await newSupplier()
      const vId = await makeVariant()

      // خرید ۱۰۰ جوړه × ۵۰۰ نقد، مصارف رسیدن ۵٬۰۰۰ نقد → قیمت تمام‌شده ۵۵۰
      const pid = await addPurchase(buy(supId, vId, 100, 500))
      await addLandingCost([pid], 5000, 'cash')
      eq('قیمت تمام‌شده', await costOf(vId), 550)

      // فروش ۶۰ جوړه × ۹۰۰ = ۵۴٬۰۰۰ — نقد ۴۰٬۰۰۰، قرض ۱۴٬۰۰۰
      const cId = await newCustomer()
      await addSale(sell(vId, 60, 900, { customerId: cId, customerName: 'مشتری', paid: 40000 }))

      // مرجوعی ۵ جوړه نقدی با برگشت به گدام
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: cId,
        partyName: 'مشتری',
        lines: [{ variantId: vId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 5, unitPrice: 900, restock: true }],
        amount: 4500,
        settlement: 'cashRefund',
        reason: 'خراب'
      })

      // مصرف تجارت ۳٬۰۰۰، مصرف خانهٔ مالک ۲٬۰۰۰، برداشت شریک ۵٬۰۰۰
      const catId = (await db.expenseCategories.add({ name: 'کرایه' })) as number
      await addExpense({ date: Date.now(), type: 'business', categoryId: catId, categoryName: 'کرایه', amount: 3000 } as Expense)
      await addExpense({ date: Date.now(), type: 'home', categoryId: catId, categoryName: 'کرایه', amount: 2000 } as Expense)
      await addPartnerWithdrawal('شریک الف', 5000)

      const s = await settlement()
      eq('موجودی گدام', await stockOf(vId), 45)
      eq('ارزش گدام', s.stockValue, 24750)
      eq('صندوق', s.cash, 120500)
      eq('طلب از مشتری', s.receivables, 14000)
      eq('دارایی', s.assets, 159250)
      eq('برداشت‌ها و مصارف خانه/شخصی', s.wSum, 7000)
      eq('مجموع سرمایه', s.capSum, 150000)
      eq('مفاد سال (از راه دارایی)', s.yearProfit, 16250)
      eq('مفاد سال (از راه سود و زیان)', await profitAndLoss(), 16250)
      eq('برابری دقیق دو فورمول', (await profitAndLoss()) - s.yearProfit, 0)
    }
  },
  {
    name: 'میانگین وزنی قیمت خرید',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 })) // ۱۰ × ۵۰۰
      eq('بعد از خرید اول', await costOf(vId), 500)
      await addPurchase(buy(supId, vId, 10, 600, { paid: 0 })) // ۱۰ × ۶۰۰ → میانگین ۵۵۰
      eq('بعد از خرید دوم (میانگین وزنی)', await costOf(vId), 550)
      await addPurchase(buy(supId, vId, 20, 700, { paid: 0 })) // (۲۰×۵۵۰ + ۲۰×۷۰۰) ÷ ۴۰ = ۶۲۵
      eq('بعد از خرید سوم', await costOf(vId), 625)
      eq('موجودی', await stockOf(vId), 40)
    }
  },
  {
    name: 'مصارف رسیدن فقط روی جوړه‌های همان محموله می‌نشیند',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await seedCash(200000)
      await addPurchase(buy(supId, vId, 50, 400)) // محمولهٔ کهنه — بدون مصرف رسیدن
      const pid = await addPurchase(buy(supId, vId, 50, 400)) // محمولهٔ نو
      await addLandingCost([pid], 5000, 'cash') // ۱۰۰ فی جوړه روی ۵۰ جوړه
      // ۵۰ جوړه × ۴۰۰ + ۵۰ جوړه × ۵۰۰ = ۴۵٬۰۰۰ ÷ ۱۰۰ = ۴۵۰
      eq('قیمت تمام‌شدهٔ میانگین', await costOf(vId), 450)
      eq('صندوق', await cashBalance(), 200000 - 40000 - 5000)
    }
  },
  {
    name: 'یک محموله شامل چند خرید — تقسیم مساوی فی جوړه',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      await seedCash(200000)
      const p1 = await addPurchase(buy(supId, v1, 60, 500))
      const p2 = await addPurchase(buy(supId, v2, 40, 800))
      await addLandingCost([p1, p2], 10000, 'cash') // ۱۰۰ جوړه → ۱۰۰ فی جوړه
      eq('قیمت تمام‌شدهٔ جنس اول', await costOf(v1), 600)
      eq('قیمت تمام‌شدهٔ جنس دوم', await costOf(v2), 900)
      eq('صندوق', await cashBalance(), 200000 - 62000 - 10000)
    }
  },
  {
    name: 'مصارف رسیدن قرضی — پرداخت بعدی دو بار حساب نشود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await seedCash(200000)
      const pid = await addPurchase(buy(supId, vId, 100, 500))
      await addLandingCost([pid], 5000, 'later')
      eq('قیمت تمام‌شده بلافاصله بالا می‌رود', await costOf(vId), 550)
      eq('صندوق دست‌نخورده', await cashBalance(), 150000)
      eq('مصرف رسیدن پرداخت‌نشده', landingUnpaidOf((await db.purchases.get(pid))!), 5000)

      await payLanding(pid)
      eq('صندوق بعد از پرداخت', await cashBalance(), 145000)
      eq('قیمت تمام‌شده تغییر نکند', await costOf(vId), 550)
      eq('دیگر پرداخت‌نشده‌ای نماند', landingUnpaidOf((await db.purchases.get(pid))!), 0)
    }
  },
  {
    name: 'قیمت خرید فاکتور فروش با گران‌شدن بعدی عوض نشود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))
      await addSale(sell(vId, 5, 900)) // مفاد باید ۵ × ۴۰۰ = ۲٬۰۰۰ بماند
      await addPurchase(buy(supId, vId, 10, 900, { paid: 0 })) // خرید گران بعدی
      const sale = (await db.sales.toArray())[0]
      eq('قیمت خرید ثبت‌شده در فاکتور', sale.lines[0].unitCost!, 500)
      eq('مفاد فروش گذشته دست‌نخورده', (await profitAndLoss()), 2000)
    }
  },
  {
    name: 'مرجوعی مشتری مفاد را پس می‌گیرد',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))
      await addSale(sell(vId, 4, 900)) // مفاد ۱٬۶۰۰
      eq('مفاد پیش از مرجوعی', await profitAndLoss(), 1600)
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyName: 'نقدی',
        lines: [{ variantId: vId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 900, restock: true }],
        amount: 900,
        settlement: 'cashRefund',
        reason: 'خراب'
      })
      eq('مفاد بعد از مرجوعی یک جوړه', await profitAndLoss(), 1200)
      eq('جنس به گدام برگشت', await stockOf(vId), 7)
    }
  },
  {
    name: 'فروش زیر قیمت زیان نشان می‌دهد',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))
      await addSale(sell(vId, 3, 400)) // ۳ × (۴۰۰ − ۵۰۰) = −۳۰۰
      eq('مفاد منفی است', await profitAndLoss(), -300)
    }
  },
  {
    name: 'صندوق هرگز منفی نشود',
    run: async () => {
      const catId = (await db.expenseCategories.add({ name: 'کرایه' })) as number
      const vId = await makeVariant()
      const supId = await newSupplier()
      await addPurchase(buy(supId, vId, 2, 100, { total: 200, paid: 0 })) // قرضی — صندوق صفر
      await addSale(sell(vId, 1, 1000)) // صندوق ۱٬۰۰۰
      eq('صندوق', await cashBalance(), 1000)
      await throws('مصرف بیشتر از موجودی رد شود', () =>
        addExpense({ date: Date.now(), type: 'business', categoryId: catId, categoryName: 'کرایه', amount: 1500 } as Expense)
      )
      eq('صندوق دست‌نخورده ماند', await cashBalance(), 1000)
      await throws('برداشت بیشتر از موجودی رد شود', () => addPartnerWithdrawal('مالک', 1500))
      eq('صندوق باز هم دست‌نخورده', await cashBalance(), 1000)
    }
  },
  {
    name: 'جنس در راه — پیش از رسید به گدام اضافه نشود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      const pid = await addPurchase(buy(supId, vId, 20, 500, { received: false, paid: 0 }))
      eq('گدام هنوز خالی', await stockOf(vId), 0)
      eq('قرض ما به تأمین‌کننده', (await db.suppliers.get(supId))!.balance, 10000)
      await receivePurchase(pid)
      eq('بعد از رسید، گدام پر شد', await stockOf(vId), 20)
      eq('قیمت تمام‌شده', await costOf(vId), 500)
      is('خرید به حالت رسیده رفت', (await db.purchases.get(pid))!.received, true)
    }
  },
  {
    name: 'تبادله — صندوق فقط به اندازهٔ تفاوت قیمت حرکت کند',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      await addPurchase(buy(supId, v1, 5, 500, { paid: 0 }))
      await addPurchase(buy(supId, v2, 5, 700, { paid: 0 }))
      await addSale(sell(v1, 1, 900)) // صندوق ۹۰۰
      eq('صندوق بعد از فروش', await cashBalance(), 900)

      // جنس ۹۰۰ پس آمد، جنس ۱٬۲۰۰ گرفت → مشتری ۳۰۰ می‌دهد
      await addExchange(
        {
          date: Date.now(),
          kind: 'customer',
          partyName: 'نقدی',
          lines: [{ variantId: v1, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 900, restock: true }],
          amount: 900,
          settlement: 'cashRefund',
          reason: 'تبادله'
        },
        sell(v2, 1, 1200)
      )
      eq('صندوق فقط ۳۰۰ زیاد شد', await cashBalance(), 1200)
      eq('جنس کهنه برگشت', await stockOf(v1), 5)
      eq('جنس نو رفت', await stockOf(v2), 4)
    }
  },
  {
    name: 'مرجوعی به تأمین‌کننده قرض ما را کم کند',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 })) // قرض ۵٬۰۰۰
      eq('قرض ما', (await db.suppliers.get(supId))!.balance, 5000)
      await addSupplierReturn({
        date: Date.now(),
        kind: 'supplier',
        partyId: supId,
        partyName: 'تأمین‌کننده',
        lines: [{ variantId: vId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 2, unitPrice: 500, restock: false }],
        amount: 1000,
        settlement: 'reduceDebt',
        reason: 'خراب'
      })
      eq('قرض ما کم شد', (await db.suppliers.get(supId))!.balance, 4000)
      eq('جنس از گدام رفت', await stockOf(vId), 8)
      eq('صندوق دست‌نخورده', await cashBalance(), 0)
    }
  },
  {
    name: 'حوالهٔ صراف — صندوق فقط قسمت نقد را می‌دهد',
    run: async () => {
      const supId = await newSupplier()
      const sarrafId = (await db.suppliers.add({ name: 'صراف', balance: 0, kind: 'sarraf' })) as number
      const vId = await makeVariant()
      await addSale(sell(vId, 0, 0, { lines: [], total: 0, paid: 20000 })) // پر کردن صندوق
      await addPurchase(
        buy(supId, vId, 24, 500, { total: 12000, paid: 2000, sarrafId, sarrafName: 'صراف', sarrafAmount: 10000 })
      )
      eq('تأمین‌کننده تصفیه شد', (await db.suppliers.get(supId))!.balance, 0)
      eq('قرض ما به صراف', (await db.suppliers.get(sarrafId))!.balance, 10000)
      eq('صندوق فقط ۲٬۰۰۰ کم شد', await cashBalance(), 18000)

      await addPayment({ date: Date.now(), partyType: 'supplier', partyId: sarrafId, partyName: 'صراف', amount: 4000 })
      eq('قرض صراف بعد از پرداخت', (await db.suppliers.get(sarrafId))!.balance, 6000)
      eq('صندوق', await cashBalance(), 14000)
    }
  },
  {
    name: 'قرض قبلی — صندوق و مفاد را تغییر ندهد',
    run: async () => {
      const cId = await newCustomer()
      const supId = await newSupplier()
      await addOpeningDebt('customer', cId, 'مشتری', 7000, 'دفتر کهنه')
      await addOpeningDebt('supplier', supId, 'تأمین‌کننده', 3000)
      eq('قرض مشتری', (await db.customers.get(cId))!.balance, 7000)
      eq('قرض ما به تأمین‌کننده', (await db.suppliers.get(supId))!.balance, 3000)
      eq('صندوق دست‌نخورده', await cashBalance(), 0)
      eq('مفاد دست‌نخورده', await profitAndLoss(), 0)

      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 2000 })
      eq('بعد از دریافت ۲٬۰۰۰', (await db.customers.get(cId))!.balance, 5000)
      eq('صندوق', await cashBalance(), 2000)
    }
  },
  {
    name: 'کسر صندوق — هر سه راه درست کار کند',
    run: async () => {
      const vId = await makeVariant()

      // راه اول: مصرف «کسر صندوق» — از مفاد کم می‌شود
      await addSale(sell(vId, 0, 0, { lines: [], total: 0, paid: 10000 }))
      await reconcile(9700, 'شمارش شام', { mode: 'expense' })
      eq('صندوق برابر شمارش شد', await cashBalance(), 9700)
      eq('مصرف کسر صندوق ثبت شد', (await db.expenses.toArray()).reduce((s, e) => s + e.amount, 0), 300)
      eq('مفاد ۳۰۰ کم شد', await profitAndLoss(), -300)

      // راه دوم: به حساب شخص مسئول
      const cId = await newCustomer('فروشنده')
      await reconcile(9500, undefined, { mode: 'debt', customerId: cId, customerName: 'فروشنده' })
      eq('صندوق', await cashBalance(), 9500)
      eq('قرض فروشنده', (await db.customers.get(cId))!.balance, 200)
      eq('مفاد تغییر نکرد', await profitAndLoss(), -300)

      // راه سوم: فقط تنظیم
      await reconcile(9400, undefined, { mode: 'adjust' })
      eq('صندوق', await cashBalance(), 9400)
      eq('مفاد تغییر نکرد', await profitAndLoss(), -300)
    }
  },
  {
    name: 'دفتر مشتری با قرض ذخیره‌شده برابر باشد',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      const cId = await newCustomer()
      await addPurchase(buy(supId, vId, 20, 500, { paid: 0 }))

      await addOpeningDebt('customer', cId, 'مشتری', 3000, 'دفتر کهنه') // قرض ۳٬۰۰۰
      await addSale(sell(vId, 2, 900, { customerId: cId, customerName: 'مشتری', paid: 0 })) // +۱٬۸۰۰ → ۴٬۸۰۰
      await addSale(sell(vId, 1, 900, { customerId: cId, customerName: 'مشتری' })) // نقدی → بی‌اثر
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 1000 }) // → ۳٬۸۰۰
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: cId,
        partyName: 'مشتری',
        lines: [{ variantId: vId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 900, restock: true }],
        amount: 900,
        settlement: 'reduceDebt',
        reason: 'خراب'
      }) // → ۲٬۹۰۰

      eq('قرض ذخیره‌شده', (await db.customers.get(cId))!.balance, 2900)
      eq('جمع دفتر مشتری', await customerLedgerEnd(cId), 2900)
      eq('دفتر و عدد دقیقاً برابر', (await customerLedgerEnd(cId)) - (await db.customers.get(cId))!.balance, 0)

      // فروش نقدی نباید سطر قرض بسازد
      const sales = await db.sales.filter((x) => x.customerId === cId).toArray()
      const payments = await db.payments.filter((x) => x.partyType === 'customer' && x.partyId === cId).toArray()
      const returns = await db.returns.filter((r) => r.kind === 'customer' && r.partyId === cId).toArray()
      eq('تعداد سطرهای دفتر', buildCustomerLedger(sales, payments, returns).length, 4)
    }
  },
  {
    name: 'دفتر صندوق با موجودی ذخیره‌شده برابر باشد',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      const cId = await newCustomer()
      await seedCash(100000)
      const pid = await addPurchase(buy(supId, vId, 40, 500))
      await addLandingCost([pid], 2000, 'cash')
      await addSale(sell(vId, 10, 900, { customerId: cId, customerName: 'مشتری', paid: 5000 }))
      const catId = (await db.expenseCategories.add({ name: 'کرایه' })) as number
      await addExpense({ date: Date.now(), type: 'business', categoryId: catId, categoryName: 'کرایه', amount: 1500 } as Expense)
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 4000 })
      await addPartnerWithdrawal('مالک', 3000)
      await reconcile(80000, 'شمارش شام', { mode: 'adjust' })

      eq('موجودی صندوق', await cashBalance(), 80000)
      eq('جمع دفتر صندوق', await cashLedgerEnd(), 80000)
      eq('دفتر و صندوق دقیقاً برابر', (await cashLedgerEnd()) - (await cashBalance()), 0)
    }
  },
  {
    name: 'هیچ افغانی در تقسیم مصارف رسیدن گم نشود',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      const v3 = await makeVariant({ size: '44' })
      await seedCash(200000)
      // ۳ خرید با تعداد نابرابر، مصرف رسیدن ۱٬۰۰۰ که به ۳ تقسیم نمی‌شود
      const p1 = await addPurchase(buy(supId, v1, 1, 500))
      const p2 = await addPurchase(buy(supId, v2, 1, 500))
      const p3 = await addPurchase(buy(supId, v3, 1, 500))
      await addLandingCost([p1, p2, p3], 1000, 'later')

      const ps = await db.purchases.bulkGet([p1, p2, p3])
      const shares = ps.map((p) => p!.landingCost ?? 0)
      eq('جمع سهم‌ها دقیقاً برابر مبلغ کل', shares.reduce((a, b) => a + b, 0), 1000)
      is('هر سهم عدد صحیح است', shares.every((x) => Number.isInteger(x)), true)

      // ارزش گدام باید دقیقاً ۱٬۵۰۰ + ۱٬۰۰۰ شود
      const vs = await db.variants.filter((v) => !v.deleted).toArray()
      eq('ارزش گدام بعد از مصارف رسیدن', vs.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0), 2500)

      // پرداخت بعدی نباید صندوق را اعشاری کند
      for (const id of [p1, p2, p3]) await payLanding(id)
      const cash = await cashBalance()
      is('صندوق عدد صحیح ماند', Number.isInteger(cash), true)
      eq('صندوق', cash, 200000 - 1500 - 1000)
    }
  },
  {
    name: 'تقسیم مبلغ به سهم‌های صحیح — بدون گم شدن و بدون اضافه شدن',
    run: async () => {
      const cases: [number, number[]][] = [
        [1000, [1, 1, 1]],
        [100, [3, 3, 3, 3]],
        [7, [1, 1, 1, 1, 1]],
        [12345, [7, 11, 13]],
        [5000, [100]],
        [1, [1, 1, 1]]
      ]
      let allOk = true
      let allInt = true
      for (const [total, weights] of cases) {
        const parts = allocate(total, weights)
        if (parts.reduce((a, b) => a + b, 0) !== total) allOk = false
        if (!parts.every((x) => Number.isInteger(x) && x >= 0)) allInt = false
      }
      is('جمع سهم‌ها همیشه دقیقاً برابر مبلغ', allOk, true)
      is('همهٔ سهم‌ها عدد صحیح و نامنفی', allInt, true)
      eq('مبلغ اعشاری هم گرد می‌شود', afn(1666.7), 1667)
      eq('تقسیم نابرابر', allocate(100, [7, 11, 13]).reduce((a, b) => a + b, 0), 100)
    }
  },
  {
    name: 'صندوق و قرض‌ها همیشه عدد صحیح بمانند',
    run: async () => {
      const supId = await newSupplier()
      const cId = await newCustomer()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      await seedCash(50000)
      const p1 = await addPurchase(buy(supId, v1, 7, 333))
      const p2 = await addPurchase(buy(supId, v2, 11, 777, { paid: 0 }))
      await addLandingCost([p1, p2], 999, 'cash')
      await addSale(sell(v1, 3, 1234, { customerId: cId, customerName: 'مشتری', paid: 1000 }))
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 333 })

      const cash = await cashBalance()
      const cBal = (await db.customers.get(cId))!.balance
      const sBal = (await db.suppliers.get(supId))!.balance
      const moves = await db.cashMovements.toArray()
      is('صندوق عدد صحیح', Number.isInteger(cash), true)
      is('قرض مشتری عدد صحیح', Number.isInteger(cBal), true)
      is('قرض تأمین‌کننده عدد صحیح', Number.isInteger(sBal), true)
      is('هر حرکت صندوق عدد صحیح', moves.every((m) => Number.isInteger(m.amount)), true)
      eq('جمع دفتر صندوق برابر صندوق', (await cashLedgerEnd()) - cash, 0)
      eq('جمع دفتر مشتری برابر قرض', (await customerLedgerEnd(cId)) - cBal, 0)
    }
  },
  {
    name: 'کنترل حساب‌ها — دکان سالم هیچ اشکالی ندهد',
    run: async () => {
      const supId = await newSupplier()
      const sarrafId = (await db.suppliers.add({ name: 'صراف', balance: 0, kind: 'sarraf' })) as number
      const cId = await newCustomer()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      await seedCash(300000)

      // خرید نقدی، خرید قرضی، خرید حواله‌ای، خرید «در راه» که بعداً رسید
      const p1 = await addPurchase(buy(supId, v1, 40, 500))
      await addPurchase(buy(supId, v2, 20, 700, { paid: 0 }))
      await addPurchase(buy(supId, v1, 10, 500, { total: 5000, paid: 1000, sarrafId, sarrafName: 'صراف', sarrafAmount: 4000 }))
      const p4 = await addPurchase(buy(supId, v2, 15, 700, { received: false, paid: 0 }))
      await receivePurchase(p4)
      await addLandingCost([p1], 2000, 'cash')

      // فروش نقدی و قرضی، دریافت، مرجوعی مشتری و تأمین‌کننده، تعدیل، قرض قبلی
      await addSale(sell(v1, 5, 900))
      await addSale(sell(v1, 10, 900, { customerId: cId, customerName: 'مشتری', paid: 3000 }))
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 2000 })
      await addOpeningDebt('customer', cId, 'مشتری', 1500)
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: cId,
        partyName: 'مشتری',
        lines: [{ variantId: v1, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 2, unitPrice: 900, restock: true }],
        amount: 1800,
        settlement: 'reduceDebt',
        reason: 'خراب'
      })
      await addSupplierReturn({
        date: Date.now(),
        kind: 'supplier',
        partyId: supId,
        partyName: 'تأمین‌کننده',
        lines: [{ variantId: v2, productName: 'اسپرتکس', size: '43', color: 'سیاه', qty: 3, unitPrice: 700, restock: false }],
        amount: 2100,
        settlement: 'reduceDebt',
        reason: 'خراب'
      })
      await db.adjustments.add({
        date: Date.now(),
        variantId: v2,
        productName: 'اسپرتکس',
        size: '43',
        color: 'سیاه',
        qtyChange: -1,
        reason: 'damaged'
      })
      await db.variants.update(v2, { stockQty: (await stockOf(v2)) - 1 })
      await addPayment({ date: Date.now(), partyType: 'supplier', partyId: supId, partyName: 'تأمین‌کننده', amount: 5000 })

      const rep = await runIntegrityCheck()
      is('هیچ اشکالی پیدا نشود', rep.mismatches.length, 0)
      eq('تعداد سایزهای کنترل‌شده', rep.variants, 2)
    }
  },
  {
    name: 'کنترل حساب‌ها — عدد خراب را پیدا و اصلاح کند',
    run: async () => {
      const supId = await newSupplier()
      const cId = await newCustomer()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 20, 500, { paid: 0 }))
      await addSale(sell(vId, 4, 900, { customerId: cId, customerName: 'مشتری', paid: 0 }))

      is('پیش از خرابی سالم است', (await runIntegrityCheck()).mismatches.length, 0)

      // سه عدد را دستی خراب می‌کنیم — مثل باگ یا همگام‌سازی نیم‌کاره
      await db.variants.update(vId, { stockQty: 99 })
      await db.customers.update(cId, { balance: 12345 })
      await db.suppliers.update(supId, { balance: 7 })

      const bad = await runIntegrityCheck()
      is('هر سه خرابی پیدا شود', bad.mismatches.length, 3)
      const v = bad.mismatches.find((m) => m.kind === 'variant')!
      eq('موجودی درست محاسبه شود', v.computed, 16)
      eq('تفاوت گزارش شود', v.diff, 83)
      const c = bad.mismatches.find((m) => m.kind === 'customer')!
      eq('قرض درست محاسبه شود', c.computed, 3600)
      const sp = bad.mismatches.find((m) => m.kind === 'supplier')!
      eq('قرض تأمین‌کننده درست محاسبه شود', sp.computed, 10000)

      for (const m of bad.mismatches) await fixMismatch(m)
      is('بعد از اصلاح هیچ اشکالی نماند', (await runIntegrityCheck()).mismatches.length, 0)
      eq('موجودی اصلاح شد', await stockOf(vId), 16)
      eq('قرض مشتری اصلاح شد', (await db.customers.get(cId))!.balance, 3600)
    }
  },
  {
    name: 'تاریخ آخرین خرید هر سایز ثبت شود',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      const old = Date.now() - 200 * 86400000
      await addPurchase(buy(supId, v1, 10, 500, { date: old, paid: 0 }))
      is('تاریخ خرید ثبت شد', (await db.variants.get(v1))!.lastPurchaseAt, old)

      const recent = Date.now()
      await addPurchase(buy(supId, v1, 5, 500, { date: recent, paid: 0 }))
      is('تازه‌ترین تاریخ می‌ماند', (await db.variants.get(v1))!.lastPurchaseAt, recent)

      // خرید کهنه‌تر نباید تاریخ را عقب ببرد
      await addPurchase(buy(supId, v1, 5, 500, { date: old, paid: 0 }))
      is('خرید کهنه تاریخ را عقب نبرد', (await db.variants.get(v1))!.lastPurchaseAt, recent)

      // جنس «در راه» تا رسید تاریخ نگیرد
      const pid = await addPurchase(buy(supId, v2, 8, 700, { received: false, paid: 0 }))
      is('جنس در راه تاریخ ندارد', (await db.variants.get(v2))!.lastPurchaseAt, undefined)
      await receivePurchase(pid)
      is('بعد از رسید تاریخ گرفت', typeof (await db.variants.get(v2))!.lastPurchaseAt, 'number')
    }
  },
  {
    name: 'قرض از یک شخص — مفاد خیالی نسازد',
    run: async () => {
      // دکان: گدام ۴۰۰٬۰۰۰ + نقد ۱۰۰٬۰۰۰ − قرض تأمین‌کننده ۴۰۰٬۰۰۰ = دارایی خالص ۱۰۰٬۰۰۰
      const meId = (await db.suppliers.add({ name: 'مالک', balance: 0, kind: 'partner', share: 100, capital: 100000 })) as number
      await seedCash(100000)
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 800, 500, { paid: 0 }))

      const before = await settlement()
      eq('دارایی خالص', before.assets, 100000)
      eq('مفاد پیش از قرض صفر است', before.yearProfit, 0)

      // ۲۰۰٬۰۰۰ قرض از یک شخص، قسط‌وار
      const lenderId = (await db.suppliers.add({ name: 'حاجی صاحب', balance: 0, kind: 'lender' })) as number
      await addLoan(lenderId, 'حاجی صاحب', 120000)
      await addLoan(lenderId, 'حاجی صاحب', 80000)
      eq('قرض ما به او', (await db.suppliers.get(lenderId))!.balance, 200000)
      eq('پول وارد صندوق شد', await cashBalance(), before.cash + 200000)

      const after = await settlement()
      eq('دارایی تغییر نکرد — قرض دارایی نیست', after.assets, before.assets)
      eq('مفاد هنوز صفر است — مفاد خیالی ساخته نشد', after.yearProfit, 0)

      // با آن پول جنس خریدیم
      const v2 = await makeVariant({ size: '43' })
      await addPurchase(buy(supId, v2, 400, 500))
      const spent = await settlement()
      eq('بعد از خرید هم مفاد صفر است', spent.yearProfit, 0)

      // یک قسط پس دادیم
      await repayLoan(lenderId, 'حاجی صاحب', 50000)
      eq('قرض کم شد', (await db.suppliers.get(lenderId))!.balance, 150000)
      eq('بعد از پرداخت هم مفاد صفر است', (await settlement()).yearProfit, 0)
      is('مالک همچنان تنها شریک است', (await db.suppliers.get(meId))!.kind, 'partner')
    }
  },
  {
    name: 'تبدیل قرض به سرمایهٔ شریک',
    run: async () => {
      await db.suppliers.add({ name: 'مالک', balance: 0, kind: 'partner', share: 100, capital: 500000 })
      await seedCash(500000)
      const lenderId = (await db.suppliers.add({ name: 'حاجی صاحب', balance: 0, kind: 'lender' })) as number
      await addLoan(lenderId, 'حاجی صاحب', 150000)
      await addLoan(lenderId, 'حاجی صاحب', 50000)

      const before = await settlement()
      eq('دارایی خالص پیش از تبدیل', before.assets, 500000)
      eq('مفاد صفر', before.yearProfit, 0)
      eq('صندوق', before.cash, 700000)

      // سهم عادلانه: ۲۰۰٬۰۰۰ از مجموع ۷۰۰٬۰۰۰ = ۲۸.۵٪
      const owed = await convertLoanToCapital(lenderId, 29)
      eq('مبلغ تبدیل‌شده', owed, 200000)

      const l = (await db.suppliers.get(lenderId))!
      is('حالا شریک است', l.kind, 'partner')
      eq('قرضش صفر شد', l.balance, 0)
      eq('سرمایه‌اش شد', l.capital ?? 0, 200000)
      eq('سهمش', l.share ?? 0, 29)

      const after = await settlement()
      eq('صندوق تغییر نکرد — پول قبلاً آمده بود', after.cash, 700000)
      eq('دارایی حالا شامل پول اوست', after.assets, 700000)
      eq('مجموع سرمایه‌ها', after.capSum, 700000)
      eq('مفاد باز هم صفر — تبدیل مفاد نمی‌سازد', after.yearProfit, 0)

      // کنترل حساب‌ها هم نباید اشکالی ببیند
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)
    }
  },
  {
    name: 'شروع سال مالی — مفاد روز اول دقیقاً صفر',
    run: async () => {
      // وضعیت روز اول یک دکان واقعی: گدام، صندوق، طلب، قرض تأمین‌کننده، قرض از شخص
      const supId = await newSupplier()
      const cId = await newCustomer()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      // موجودی اولیه — عیناً مثل فورم گدام: عدد + سند «موجودی اولیه»
      const openStock = async (id: number, qty: number, cost: number, size: string) => {
        await db.variants.update(id, { stockQty: qty, purchasePrice: cost, lastPurchaseAt: Date.now() })
        await db.adjustments.add({
          date: Date.now(),
          variantId: id,
          productName: 'اسپرتکس',
          size,
          color: 'سیاه',
          qtyChange: qty,
          reason: 'correction',
          note: 'موجودی اولیه'
        })
      }
      await openStock(v1, 300, 550, '42') // ۱۶۵٬۰۰۰
      await openStock(v2, 120, 700, '43') // ۸۴٬۰۰۰
      await db.cashMovements.add({ date: Date.now(), type: 'openingSet', amount: 73000, note: 'پول اول سال' })
      await addOpeningDebt('customer', cId, 'مشتری', 41000)
      await addOpeningDebt('supplier', supId, 'تأمین‌کننده', 95000)
      const lenderId = (await db.suppliers.add({ name: 'حاجی صاحب', balance: 0, kind: 'lender' })) as number
      await addLoan(lenderId, 'حاجی صاحب', 60000)

      // همان فورمول ویزارد
      const variants = await db.variants.filter((v) => !v.deleted).toArray()
      const movements = await db.cashMovements.filter((m) => !m.deleted).toArray()
      const customers = await db.customers.filter((c) => !c.deleted).toArray()
      const suppliers = await db.suppliers.filter((x) => !x.deleted).toArray()
      const others = suppliers.filter((x) => x.kind !== 'partner')
      const stock = variants.reduce((s, v) => s + v.stockQty * v.purchasePrice, 0)
      const cash = movements.reduce((s, m) => s + m.amount, 0)
      const recv = customers.reduce((s, c) => s + Math.max(0, c.balance), 0)
      const credits = customers.reduce((s, c) => s + Math.max(0, -c.balance), 0)
      const payables = others.filter((x) => x.kind !== 'lender').reduce((s, x) => s + Math.max(0, x.balance), 0)
      const loans = others.filter((x) => x.kind === 'lender').reduce((s, x) => s + Math.max(0, x.balance), 0)
      const supCredit = others.reduce((s, x) => s + Math.max(0, -x.balance), 0)
      const assets = stock + cash + recv + supCredit - payables - loans - credits

      eq('ارزش گدام', stock, 249000)
      eq('صندوق (شامل قرض دریافتی)', cash, 133000)
      eq('قرض ما از شخص', loans, 60000)
      // ۲۴۹٬۰۰۰ + ۱۳۳٬۰۰۰ + ۴۱٬۰۰۰ − ۹۵٬۰۰۰ − ۶۰٬۰۰۰
      eq('دارایی خالص', assets, 268000)

      // ویزارد سرمایهٔ مالک را برابر دارایی خالص می‌گذارد
      await db.suppliers.add({ name: 'مالک', balance: 0, kind: 'partner', capital: afn(assets), share: 100 })
      await db.settings.put({ key: 'partnershipStart', value: Date.now() })

      const s0 = await settlement()
      eq('سرمایهٔ ثبت‌شده', s0.capSum, 268000)
      eq('مفاد روز اول دقیقاً صفر است', s0.yearProfit, 0)
      is('کنترل حساب‌ها هم سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // یک فروش با مفاد ۲۰۰ — از فردا مفاد درست شمرده شود
      await addSale(sell(v1, 1, 750))
      eq('مفاد بعد از یک فروش', (await settlement()).yearProfit, 200)
      eq('همان عدد از راه سود و زیان', await profitAndLoss(), 200)
    }
  },
  {
    name: 'شروع سال با شریک — پولش جنس شده، باز هم مفاد صفر',
    run: async () => {
      // حالت واقعی: با پول شریک جنس خریدیم و قرض تأمین‌کننده را خلاص کردیم.
      // پس پول او دیگر نقد نیست — ولی در گدام و در نبودِ قرض زنده است.
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const openStock = async (id: number, qty: number, cost: number) => {
        await db.variants.update(id, { stockQty: qty, purchasePrice: cost, lastPurchaseAt: Date.now() })
        await db.adjustments.add({
          date: Date.now(),
          variantId: id,
          productName: 'اسپرتکس',
          size: '42',
          color: 'سیاه',
          qtyChange: qty,
          reason: 'correction',
          note: 'موجودی اولیه'
        })
      }
      await openStock(v1, 1200, 500) // گدام ۶۰۰٬۰۰۰ (شامل جنسی که با پول او خریده شد)
      await db.cashMovements.add({ date: Date.now(), type: 'openingSet', amount: 50000, note: 'پول اول سال' })
      const cId = await newCustomer()
      await addOpeningDebt('customer', cId, 'مشتری', 80000)
      await addOpeningDebt('supplier', supId, 'تأمین‌کننده', 30000)

      // دارایی خالص: ۶۰۰٬۰۰۰ + ۵۰٬۰۰۰ + ۸۰٬۰۰۰ − ۳۰٬۰۰۰
      const beforeAssets = (await settlement()).assets
      eq('دارایی خالص', beforeAssets, 700000)

      // شریک: سرمایه = همان مبلغی که داده (۲۰۰٬۰۰۰)، سهم ۲۹٪
      await db.suppliers.add({ name: 'شریک', balance: 0, kind: 'partner', capital: 200000, share: 29 })
      // مالک: باقی‌مانده — عیناً همان چیزی که ویزارد حساب می‌کند
      const partners = await db.suppliers.filter((x) => !x.deleted && x.kind === 'partner').toArray()
      const othersCapital = partners.reduce((s, p) => s + (p.capital ?? 0), 0)
      const ownerCapital = afn(beforeAssets - othersCapital)
      eq('سرمایهٔ مالک (خودکار)', ownerCapital, 500000)
      await db.suppliers.add({ name: 'مالک', balance: 0, kind: 'partner', capital: ownerCapital, share: 71 })
      await db.settings.put({ key: 'partnershipStart', value: Date.now() })

      const s0 = await settlement()
      eq('مجموع سرمایه‌ها برابر دارایی', s0.capSum, 700000)
      eq('مفاد روز اول دقیقاً صفر', s0.yearProfit, 0)

      // قسط بعدی شریک: ۵۰٬۰۰۰ نقد → سرمایه‌اش بالا، مفاد باز هم صفر
      const p = (await db.suppliers.filter((x) => !x.deleted && x.name === 'شریک').first())!
      await addCapital(p.id!, 'شریک', 50000)
      eq('سرمایهٔ شریک بعد از قسط', (await db.suppliers.get(p.id!))!.capital ?? 0, 250000)
      const s1 = await settlement()
      eq('صندوق بالا رفت', s1.cash, 100000)
      eq('دارایی بالا رفت', s1.assets, 750000)
      eq('مفاد باز هم صفر — قسط مفاد نیست', s1.yearProfit, 0)

      // حالا یک فروش با مفاد ۳۰۰
      await addSale(sell(v1, 2, 650))
      eq('مفاد بعد از فروش', (await settlement()).yearProfit, 300)
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)
    }
  },
  {
    name: 'نمودارها — مفاد عمده و پرچون جدا و درست',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      await addPurchase(buy(supId, v1, 100, 500, { paid: 0 }))
      await addPurchase(buy(supId, v2, 100, 400, { paid: 0 }))
      const cW = await newCustomer('عمده‌فروش')
      const cR = await newCustomer('مشتری پرچون')

      // عمده: ۲۰ جوړه × ۶۰۰ = ۱۲٬۰۰۰ ، قیمت خرید ۵۰۰ → مفاد ۲٬۰۰۰ (فیصدی ۱۶.۶۷)
      await addSale(sell(v1, 20, 600, { saleType: 'wholesale', customerId: cW, customerName: 'عمده‌فروش' }))
      // پرچون: ۱۰ جوړه × ۹۰۰ = ۹٬۰۰۰ ، قیمت خرید ۵۰۰ → مفاد ۴٬۰۰۰ (فیصدی ۴۴.۴۴)
      await addSale(sell(v1, 10, 900, { saleType: 'retail', customerId: cR, customerName: 'مشتری پرچون' }))
      // پرچون از جنس دوم: ۵ × ۷۰۰ = ۳٬۵۰۰ ، خرید ۴۰۰ → مفاد ۱٬۵۰۰
      await addSale(sell(v2, 5, 700, { saleType: 'retail' }))

      const sales = await db.sales.filter((x) => !x.deleted).toArray()
      const rets = await db.returns.filter((r) => !r.deleted).toArray()
      const rw = retailVsWholesale(sales, rets)

      eq('فروش عمده', rw.wholesale.sales, 12000)
      eq('مفاد عمده', rw.wholesale.profit, 2000)
      eq('جوړهٔ عمده', rw.wholesale.pairs, 20)
      eq('فیصدی مفاد عمده', Math.round(rw.wholesale.margin), 17)

      eq('فروش پرچون', rw.retail.sales, 12500)
      eq('مفاد پرچون', rw.retail.profit, 5500)
      eq('جوړهٔ پرچون', rw.retail.pairs, 15)
      eq('فیصدی مفاد پرچون', Math.round(rw.retail.margin), 44)

      // مجموع دو نمودار باید دقیقاً برابر مفاد کل باشد
      eq('مجموع مفاد دو نمودار = مفاد کل', rw.retail.profit + rw.wholesale.profit, await profitAndLoss())

      // مرجوعی از فروش عمده باید از مفاد عمده کم شود
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: cW,
        partyName: 'عمده‌فروش',
        saleType: 'wholesale',
        lines: [{ variantId: v1, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 5, unitPrice: 600, restock: true }],
        amount: 3000,
        settlement: 'reduceDebt',
        reason: 'خراب'
      })
      const rw2 = retailVsWholesale(
        await db.sales.filter((x) => !x.deleted).toArray(),
        await db.returns.filter((r) => !r.deleted).toArray()
      )
      eq('مفاد عمده بعد از مرجوعی', rw2.wholesale.profit, 1500)
      eq('مفاد پرچون دست‌نخورده', rw2.retail.profit, 5500)
      eq('باز هم برابر مفاد کل', rw2.retail.profit + rw2.wholesale.profit, await profitAndLoss())
    }
  },
  {
    name: 'نمودارها — مدل‌ها، مشتریان، ماه‌ها',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      await addPurchase(buy(supId, v1, 200, 500, { paid: 0 }))
      const cId = await newCustomer('احمد')

      // ۱۰ × ۹۰۰ با تخفیف ۹۰۰ → فروش ۸٬۱۰۰، مفاد ۴٬۰۰۰ − ۹۰۰ = ۳٬۱۰۰
      await addSale(
        sell(v1, 10, 900, { customerId: cId, customerName: 'احمد', discount: 900, total: 8100, paid: 8100 })
      )
      await addSale(sell(v1, 4, 800, { customerId: cId, customerName: 'احمد' })) // مفاد ۱٬۲۰۰

      const sales = await db.sales.filter((x) => !x.deleted).toArray()

      const models = byModel(sales)
      eq('یک مدل', models.length, 1)
      eq('جوړهٔ مدل', models[0].pairs, 14)
      eq('مفاد مدل با تخفیف', models[0].profit, 4300)
      eq('فروش مدل با تخفیف', models[0].sales, 11300)
      eq('مفاد مدل = مفاد کل', models[0].profit, await profitAndLoss())

      const custs = byCustomer(sales)
      eq('یک مشتری', custs.length, 1)
      is('نام مشتری', custs[0].name, 'احمد')
      eq('خرید مشتری', custs[0].sales, 11300)
      eq('مفادی که مشتری داد', custs[0].profit, 4300)

      const months = byMonth(sales, () => ({ key: '1405-05', label: 'اسد ۱۴۰۵' }))
      eq('یک ماه', months.length, 1)
      eq('فروش ماه', months[0].sales, 11300)
      eq('مفاد ماه', months[0].profit, 4300)

      eq('تغییر ۱۰۰ به ۱۵۰ = ۵۰٪', changePct(150, 100) ?? -1, 50)
      eq('تغییر ۱۰۰ به ۵۰ = ‎−۵۰٪', changePct(50, 100) ?? -1, -50)
      is('تقسیم بر صفر خطا ندهد', changePct(50, 0), null)
    }
  },
  {
    name: 'تخفیف از مفاد کم شود و قرض نسازد',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      const cId = await newCustomer()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))
      // ۲ × ۹۰۰ = ۱٬۸۰۰، تخفیف ۳۰۰ → قابل پرداخت ۱٬۵۰۰، همه نقد
      await addSale(sell(vId, 2, 900, { customerId: cId, customerName: 'مشتری', discount: 300, total: 1500, paid: 1500 }))
      eq('قرض مشتری صفر', (await db.customers.get(cId))!.balance, 0)
      eq('مفاد = ۸۰۰ − ۳۰۰ تخفیف', await profitAndLoss(), 500)
    }
  }
]

// ── اجرا ────────────────────────────────────────────────────────
export async function runAll(): Promise<{ pass: number; fail: number; report: string }> {
  const out: string[] = []
  let pass = 0
  let fail = 0

  for (const s of SCENARIOS) {
    current = []
    await fresh()
    try {
      await s.run()
    } catch (e) {
      current.push({ name: 'اجرای سناریو', ok: false, got: e instanceof Error ? e.message : String(e), want: 'بدون خطا' })
    }
    const bad = current.filter((c) => !c.ok)
    pass += current.length - bad.length
    fail += bad.length
    out.push(`${bad.length === 0 ? '✅' : '❌'} ${s.name}`)
    for (const c of current) {
      if (!c.ok) out.push(`      ❌ ${c.name}: شد «${String(c.got)}» — باید «${String(c.want)}» می‌بود`)
    }
  }

  out.push('')
  out.push(fail === 0 ? `✅ همه درست — ${pass} بررسی در ${SCENARIOS.length} سناریو` : `❌ ${fail} بررسی ناکام از ${pass + fail}`)
  return { pass, fail, report: out.join('\n') }
}
