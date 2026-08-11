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
  addAdjustment,
  addVariant,
  setOpeningStock,
  setPurchaseCost,
  addCapital,
  addPartnerWithdrawal,
  reconcile,
  cashBalance,
  addLoan,
  repayLoan,
  giveCashToLender,
  giveGoodsToLender,
  updateLender,
  deleteLender,
  convertLoanToCapital,
  transferCash,
  boxBalances,
  deleteSale,
  deleteSaleImpact,
  deletePayment,
  deletePaymentImpact,
  exportBackup,
  importBackup,
  SHOP_BOX
} from '../src/lib/ops'
import { allocate, afn } from '../src/lib/ops'
import { buildCashLedger, buildCustomerLedger, buildLenderLedger, summarizeLenderAccount, pageTotals } from '../src/lib/ledger'
import { runIntegrityCheck, fixMismatch } from '../src/lib/integrity'
import { retailVsWholesale, byModel, byCustomer, byMonth, changePct } from '../src/lib/analytics'
import { applyDocEffects, shouldResetForGeneration } from '../src/lib/sync'
import { buildForecast, dailyFlow } from '../src/lib/cashflow'
import { mergeProducts, findDuplicateGroups, normalizeName } from '../src/lib/merge'
import { soldInPeriod, soldVariantIds } from '../src/lib/sold'
import { netWorth, computeNetWorth } from '../src/lib/networth'
import { pageOrder, familyPages } from '../src/lib/format'
import { rebuildCosts } from '../src/lib/costing'
import { addPartner, startYear, settleYear, listPartners, totalCapital, remainingCapital, setPartnerCapital } from '../src/lib/partnership'
import { getServerConfig, isPasswordRecoveryUrl, passwordRecoveryRedirectUrl } from '../src/lib/supa'

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

  // همان تابعی که خود اپ صدا می‌زند — نه یک کپیِ دستی، وگرنه اختلافشان دیده نمی‌شود
  const n = computeNetWorth({ variants, movements, customers, suppliers, purchases })
  const assets = n.assets

  const DRAW = ['withdrawal', 'homeExpense', 'personalExpense']
  const draws = movements.filter((m) => DRAW.includes(m.type))
  const wSum = draws.reduce((s, m) => s - m.amount, 0)
  const capSum = suppliers.filter((x) => x.kind === 'partner').reduce((s, p) => s + (p.capital ?? 0), 0)

  return { stockValue: n.stock, cash: n.cash, receivables: n.receivables, assets, wSum, capSum, yearProfit: assets + wSum - capSum }
}

// ── سناریوها ────────────────────────────────────────────────────
const SCENARIOS: { name: string; run: () => Promise<void> }[] = [
  {
    name: 'تنظیم ناقص سرور — حساب و همگام‌سازی در مرورگر پنهان نشود',
    run: async () => {
      await db.settings.put({ key: 'supaUrl', value: 'https://old-project.example' })
      const onlyUrl = await getServerConfig()
      is('URL تنها به پروژهٔ پیش‌فرض برمی‌گردد', onlyUrl?.url, 'https://xkvpdeguayorxzvjgpmv.supabase.co')
      is('URL تنها کلید پیش‌فرض عمومی دارد', onlyUrl?.anonKey.startsWith('sb_publishable_'), true)

      await db.settings.clear()
      await db.settings.put({ key: 'supaKey', value: 'old-incomplete-key' })
      const onlyKey = await getServerConfig()
      is('کلید تنها به پروژهٔ پیش‌فرض برمی‌گردد', onlyKey?.url, 'https://xkvpdeguayorxzvjgpmv.supabase.co')
      is('کلید تنها با کلید پیش‌فرض عمومی جایگزین می‌شود', onlyKey?.anonKey.startsWith('sb_publishable_'), true)
    }
  },
  {
    name: 'بازیابی رمز — لینک به نسخهٔ زنده برگردد، نه localhost',
    run: async () => {
      is(
        'آدرس برگشت ریشهٔ همان اپ است',
        passwordRecoveryRedirectUrl('https://najiballahhaqmal568-hub.github.io/epr/?from=login#old'),
        'https://najiballahhaqmal568-hub.github.io/epr/'
      )
      is(
        'لینک بازیابی شناخته می‌شود',
        isPasswordRecoveryUrl('https://najiballahhaqmal568-hub.github.io/epr/#access_token=test&type=recovery'),
        true
      )
      is('لینک عادی بازیابی نیست', isPasswordRecoveryUrl('https://najiballahhaqmal568-hub.github.io/epr/'), false)
    }
  },
  {
    name: 'نسخهٔ بازگردانی سرور — دستگاه کهنه پیش از ارسال پاک شود',
    run: async () => {
      is('همان دکان و همان نسخه پاک نمی‌شود', shouldResetForGeneration('shop-a', 2, 'shop-a', 2, true), false)
      is('نسخهٔ تازهٔ سرور دستگاه را پاک می‌کند', shouldResetForGeneration('shop-a', 1, 'shop-a', 2, true), true)
      is('تعویض دکان دستگاه را پاک می‌کند', shouldResetForGeneration('shop-a', 2, 'shop-b', 2, true), true)
      is('دستگاه قدیمی با سابقهٔ همگام‌سازی پاک می‌شود', shouldResetForGeneration(undefined, undefined, 'shop-a', 1, true), true)
      is('دستگاه تازه و خالی پاک‌سازی اضافی نمی‌شود', shouldResetForGeneration(undefined, undefined, 'shop-a', 1, false), false)
    }
  },
  {
    name: 'برگرداندن بکاپ مالک قبلی — حساب نو بماند و همهٔ دیتا دوباره همگام شود',
    run: async () => {
      const currentProfile = { user_id: 'new-owner', shop_id: 'new-shop', role: 'owner', name: 'مالک نو' }
      await db.settings.bulkPut([
        { key: 'supaUrl', value: 'https://new-project.supabase.co' },
        { key: 'supaKey', value: 'new-current-anon-key-1234567890' },
        { key: 'cachedProfile', value: currentProfile }
      ])
      await db.syncState.bulkPut([
        { key: 'deviceId', value: 'new-device' },
        { key: 'push:products', value: Date.now() + 100000 },
        { key: 'pull:products', value: '2099-01-01T00:00:00Z' }
      ])

      const oldBackup = JSON.stringify({
        app: 'shoeErp',
        version: 2,
        exportedAt: Date.now(),
        data: {
          products: [{ id: 1, name: 'جنس بکاپ', uuid: '11111111-1111-4111-8111-111111111111', localUpdatedAt: 1 }],
          customers: [{ id: 1, name: 'مشتری بکاپ قدیمی', type: 'retail', balance: 0 }],
          settings: [
            { key: 'supaUrl', value: 'https://old-project.supabase.co' },
            { key: 'supaKey', value: 'old-anon-key' },
            { key: 'cachedProfile', value: { user_id: 'old-owner', shop_id: 'old-shop', role: 'owner', name: 'مالک قبلی' } },
            { key: 'pinHash', value: 'old-pin-that-should-restore' }
          ]
        }
      })

      await importBackup(oldBackup)

      is('آدرس سرور حساب نو ماند', (await db.settings.get('supaUrl'))?.value, 'https://new-project.supabase.co')
      is('کلید سرور حساب نو ماند', (await db.settings.get('supaKey'))?.value, 'new-current-anon-key-1234567890')
      is(
        'پروفایل مالک نو ماند',
        ((await db.settings.get('cachedProfile'))?.value as { shop_id?: string } | undefined)?.shop_id,
        currentProfile.shop_id
      )
      is('تنظیم غیرحسابی بکاپ برگشت', (await db.settings.get('pinHash'))?.value, 'old-pin-that-should-restore')
      is('نشانگر ارسال قبلی پاک شد', await db.syncState.get('push:products'), undefined)
      is('نشانگر دریافت قبلی پاک شد', await db.syncState.get('pull:products'), undefined)
      is('شناسهٔ دستگاه قبلی پاک شد', await db.syncState.get('deviceId'), undefined)
      is('بکاپ عادی برای ادغام امن نشانه‌گذاری شد', (await db.syncState.get('restorePushMode'))?.value, 'merge')
      is('جنس بکاپ برگشت', (await db.products.get(1))?.name, 'جنس بکاپ')
      const legacyCustomer = await db.customers.get(1)
      is('مشتری بکاپ قدیمی برگشت', legacyCustomer?.name, 'مشتری بکاپ قدیمی')
      is('برای ردیف قدیمی شناسهٔ همگام‌سازی ساخته شد', Boolean(legacyCustomer?.uuid), true)
      is('برای ردیف قدیمی زمان همگام‌سازی ساخته شد', Number(legacyCustomer?.localUpdatedAt) > 0, true)

      const exported = JSON.parse(await exportBackup())
      const exportedKeys = (exported.data.settings as Array<{ key: string }>).map((row) => row.key)
      is('بکاپ نو آدرس سرور را نمی‌برد', exportedKeys.includes('supaUrl'), false)
      is('بکاپ نو کلید سرور را نمی‌برد', exportedKeys.includes('supaKey'), false)
      is('بکاپ نو پروفایل مالک را نمی‌برد', exportedKeys.includes('cachedProfile'), false)
      is('نسخهٔ بکاپ نو است', exported.version, 3)
    }
  },
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
      // همان تابعی که فورم گدام صدا می‌زند — نه کپیِ دستی از آن
      const openStock = async (id: number, qty: number, cost: number, _size: string) => {
        await db.variants.update(id, { purchasePrice: cost })
        await setOpeningStock(id, qty, 'اسپرتکس')
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
    name: 'جای پول — بردن پول به خانه برداشت حساب نشود',
    run: async () => {
      await db.suppliers.add({ name: 'مالک', balance: 0, kind: 'partner', share: 100, capital: 100000 })
      await seedCash(100000) // در دکان
      const before = await settlement()
      eq('مفاد پیش از انتقال صفر', before.yearProfit, 0)
      eq('برداشت‌ها صفر', before.wSum, 0)

      // ۳۰٬۰۰۰ به خانه و ۲۰٬۰۰۰ نزد صراف
      await transferCash(SHOP_BOX, 'خانه', 30000)
      await transferCash(SHOP_BOX, 'صراف', 20000)

      const bb = await boxBalances()
      eq('پول کل تغییر نکرد', bb.total, 100000)
      eq('دکان', bb.boxes.find((b) => b.name === SHOP_BOX)!.balance, 50000)
      eq('خانه', bb.boxes.find((b) => b.name === 'خانه')!.balance, 30000)
      eq('صراف', bb.boxes.find((b) => b.name === 'صراف')!.balance, 20000)

      const after = await settlement()
      eq('پول کل در دارایی بدون تغییر', after.cash, 100000)
      eq('برداشت‌ها هنوز صفر — انتقال برداشت نیست', after.wSum, 0)
      eq('مفاد هنوز صفر — انتقال مفاد را تغییر نمی‌دهد', after.yearProfit, 0)

      // برگرداندن پول از خانه
      await transferCash('خانه', SHOP_BOX, 10000)
      const bb2 = await boxBalances()
      eq('دکان بعد از برگشت', bb2.boxes.find((b) => b.name === SHOP_BOX)!.balance, 60000)
      eq('خانه بعد از برگشت', bb2.boxes.find((b) => b.name === 'خانه')!.balance, 20000)
      eq('پول کل باز هم همان', bb2.total, 100000)
      eq('مفاد باز هم صفر', (await settlement()).yearProfit, 0)
    }
  },
  {
    name: 'جای پول — از جایی که پول نیست خرج نشود',
    run: async () => {
      await seedCash(50000) // دکان
      await transferCash(SHOP_BOX, 'خانه', 20000)
      await throws('انتقال بیشتر از موجودی دکان رد شود', () => transferCash(SHOP_BOX, 'خانه', 40000))
      await throws('انتقال بیشتر از موجودی خانه رد شود', () => transferCash('خانه', SHOP_BOX, 30000))
      await throws('انتقال به خودش رد شود', () => transferCash('خانه', 'خانه', 1000))
      await throws('مبلغ صفر رد شود', () => transferCash(SHOP_BOX, 'خانه', 0))

      const bb = await boxBalances()
      eq('دکان دست‌نخورده', bb.boxes.find((b) => b.name === SHOP_BOX)!.balance, 30000)
      eq('خانه دست‌نخورده', bb.boxes.find((b) => b.name === 'خانه')!.balance, 20000)
      eq('پول کل', bb.total, 50000)

      // مصرف از دکان می‌رود؛ بیشتر از موجودی دکان نباید اجازه داشته باشد
      const catId = (await db.expenseCategories.add({ name: 'کرایه' })) as number
      await throws('مصرف بیشتر از موجودی دکان رد شود', () =>
        addExpense({ date: Date.now(), type: 'business', categoryId: catId, categoryName: 'کرایه', amount: 35000 } as Expense)
      )
      eq('پول کل بعد از خطا', (await boxBalances()).total, 50000)
    }
  },
  {
    name: 'جای پول — تصفیه هر جا جدا و دفتر برابر بماند',
    run: async () => {
      await seedCash(60000)
      await transferCash(SHOP_BOX, 'صراف', 25000)

      // شمارش دکان: ۳۴٬۰۰۰ به‌جای ۳۵٬۰۰۰ → کسر ۱٬۰۰۰
      await reconcile(34000, 'شمارش شام', { mode: 'expense' }, SHOP_BOX)
      eq('دکان برابر شمارش', await cashBalance(SHOP_BOX), 34000)
      eq('صراف دست‌نخورده', await cashBalance('صراف'), 25000)
      eq('پول کل', await cashBalance(), 59000)
      eq('کسر از مفاد کم شد', await profitAndLoss(), -1000)

      // شمارش صراف: ۲۵٬۵۰۰ → ۵۰۰ زیاد
      await reconcile(25500, undefined, { mode: 'adjust' }, 'صراف')
      eq('صراف برابر شمارش', await cashBalance('صراف'), 25500)
      eq('دکان دست‌نخورده', await cashBalance(SHOP_BOX), 34000)
      eq('مفاد تغییر نکرد', await profitAndLoss(), -1000)

      // دفتر صندوق باید با مجموع همهٔ جاها برابر باشد
      eq('دفتر = پول کل', await cashLedgerEnd(), await cashBalance())
      eq('جمع جاها = پول کل', (await boxBalances()).total, await cashBalance())
    }
  },
  {
    name: 'پول آینده — آنچه می‌آید و آنچه باید داده شود',
    run: async () => {
      const DAY = 86400000
      const now = Date.now()
      await seedCash(80000)

      // سه مشتری: وعدهٔ نزدیک، وعدهٔ گذشته، بدون وعده
      const c1 = (await db.customers.add({ name: 'احمد', type: 'retail', balance: 0, promiseDate: now + 3 * DAY })) as number
      const c2 = (await db.customers.add({ name: 'کریم', type: 'retail', balance: 0, promiseDate: now - 5 * DAY })) as number
      const c3 = await newCustomer('نامعلوم')
      await addOpeningDebt('customer', c1, 'احمد', 50000)
      await addOpeningDebt('customer', c2, 'کریم', 30000)
      await addOpeningDebt('customer', c3, 'نامعلوم', 25000)
      // مشتری با وعدهٔ دور — نباید در هفتهٔ آینده بیاید
      const c4 = (await db.customers.add({ name: 'دور', type: 'retail', balance: 0, promiseDate: now + 40 * DAY })) as number
      await addOpeningDebt('customer', c4, 'دور', 90000)

      // قرض ما: تأمین‌کننده + قرض‌دهنده + مصارف رسیدن پرداخت‌نشده
      const supId = await newSupplier()
      await addOpeningDebt('supplier', supId, 'تأمین‌کننده', 60000)
      const lenderId = (await db.suppliers.add({ name: 'حاجی', balance: 0, kind: 'lender' })) as number
      await addLoan(lenderId, 'حاجی', 40000)
      const vId = await makeVariant()
      const pid = await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))
      await addLandingCost([pid], 3000, 'later')

      const customers = await db.customers.filter((c) => !c.deleted).toArray()
      const suppliers = await db.suppliers.filter((x) => !x.deleted).toArray()
      const purchases = await db.purchases.filter((p) => !p.deleted).toArray()
      const f = buildForecast(await cashBalance(), customers, suppliers, purchases, now + 7 * DAY, now)

      eq('پول امروز (شامل قرض دریافتی)', f.cashNow, 120000)
      eq('طلب هفتهٔ آینده = احمد ۵۰٬۰۰۰ + کریم ۳۰٬۰۰۰', f.incomingTotal, 80000)
      is('وعدهٔ دور نیامده', f.incoming.some((i) => i.name === 'دور'), false)
      is('بدون وعده در تخمین نیست', f.incoming.some((i) => i.name === 'نامعلوم'), false)
      eq('طلب بدون وعده جدا شمرده شد', f.noPromise, 25000)
      eq('طلب گذشته از وعده', f.overdueTotal, 30000)
      is('وعدهٔ گذشته نشانه‌گذاری شد', f.incoming.find((i) => i.name === 'کریم')!.overdue, true)

      // قرض ما: تأمین‌کننده ۶۰٬۰۰۰ + خرید قرضی ۵٬۰۰۰ + حاجی ۴۰٬۰۰۰ + مصارف رسیدن ۳٬۰۰۰
      eq('باید داده شود', f.outgoingTotal, 108000)
      is('مصارف رسیدن آمده', f.outgoing.some((o) => o.kind === 'landing'), true)
      is('قرض‌دهنده آمده', f.outgoing.some((o) => o.kind === 'lender'), true)

      // ۱۲۰٬۰۰۰ + ۸۰٬۰۰۰ − ۱۰۸٬۰۰۰
      eq('تخمین پول هفتهٔ آینده', f.projected, 92000)
      eq('تخمین = نقد + آمد − رفت', f.projected, f.cashNow + f.incomingTotal - f.outgoingTotal)
    }
  },
  {
    name: 'پول آینده — دکان بدون قرض تخمین درست بدهد',
    run: async () => {
      await seedCash(45000)
      const f = buildForecast(await cashBalance(), [], [], [], Date.now() + 7 * 86400000)
      eq('پول امروز', f.cashNow, 45000)
      eq('آمدنی صفر', f.incomingTotal, 0)
      eq('رفتنی صفر', f.outgoingTotal, 0)
      eq('تخمین برابر پول امروز', f.projected, 45000)
      eq('شرکا در قرض حساب نشوند', f.outgoing.length, 0)
    }
  },
  {
    name: 'جریان پول روزانه — آمد و رفت هر روز',
    run: async () => {
      const DAY = 86400000
      const sod = (ts: number) => new Date(ts).setHours(0, 0, 0, 0)
      const now = Date.now()
      const t = (d: number) => sod(now - d * DAY) + 3600000

      const moves = [
        { date: t(9), amount: 40000 }, // پیش از دورهٔ ۷ روزه
        { date: t(5), amount: 10000 },
        { date: t(5), amount: -3000 },
        { date: t(2), amount: 7000 },
        { date: t(0), amount: -5000 }
      ]
      const rows = dailyFlow(moves, 7, (ts) => String(new Date(ts).getDate()), sod, now)

      eq('هفت روز', rows.length, 7)
      const d5 = rows.find((r) => r.day === sod(now - 5 * DAY))!
      eq('آمد روز پنجم', d5.inflow, 10000)
      eq('رفت روز پنجم', d5.outflow, 3000)
      // ۴۰٬۰۰۰ قبل از دوره + ۱۰٬۰۰۰ − ۳٬۰۰۰
      eq('موجودی پایان روز پنجم', d5.balance, 47000)

      const d4 = rows.find((r) => r.day === sod(now - 4 * DAY))!
      eq('روز بدون حرکت آمد صفر', d4.inflow, 0)
      eq('روز بدون حرکت موجودی همان می‌ماند', d4.balance, 47000)

      const last = rows[rows.length - 1]
      eq('موجودی امروز = جمع همهٔ حرکات', last.balance, 49000)
      eq('رفت امروز', last.outflow, 5000)
      eq('جمع آمد دوره', rows.reduce((s, r) => s + r.inflow, 0), 17000)
      eq('جمع رفت دوره', rows.reduce((s, r) => s + r.outflow, 0), 8000)
    }
  },
  {
    name: 'جریان پول روزانه — فقط یک جای پول',
    run: async () => {
      const sod = (ts: number) => new Date(ts).setHours(0, 0, 0, 0)
      const now = Date.now()
      await seedCash(50000)
      await transferCash(SHOP_BOX, 'خانه', 20000)
      const all = await db.cashMovements.filter((m) => !m.deleted).toArray()

      const shopRows = dailyFlow(all.filter((m) => (m.box ?? SHOP_BOX) === SHOP_BOX), 7, () => '', sod, now)
      eq('موجودی دکان در نمودار', shopRows[shopRows.length - 1].balance, 30000)
      const homeRows = dailyFlow(all.filter((m) => m.box === 'خانه'), 7, () => '', sod, now)
      eq('موجودی خانه در نمودار', homeRows[homeRows.length - 1].balance, 20000)
      const allRows = dailyFlow(all, 7, () => '', sod, now)
      eq('پول کل در نمودار', allRows[allRows.length - 1].balance, 50000)
    }
  },
  {
    name: 'حذف فروش — اثرش پیش از تأیید معلوم شود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      const cId = await newCustomer()
      await addPurchase(buy(supId, vId, 20, 500, { paid: 0 }))
      await seedCash(5000)

      // فروش نقدی ۳ × ۹۰۰ = ۲٬۷۰۰
      const saleId = await addSale(sell(vId, 3, 900))
      eq('پول بعد از فروش', await cashBalance(SHOP_BOX), 7700)

      const im1 = (await deleteSaleImpact(saleId))!
      eq('مبلغی که پس می‌رود', im1.paid, 2700)
      is('از کدام جای پول', im1.box, SHOP_BOX)
      eq('پول فعلی', im1.before, 7700)
      eq('پول بعد از حذف', im1.after, 5000)
      is('منفی نمی‌شود', im1.after < 0, false)

      // حالا پول را خرج می‌کنیم تا حذف، پول را منفی کند
      const catId = (await db.expenseCategories.add({ name: 'کرایه' })) as number
      await addExpense({ date: Date.now(), type: 'business', categoryId: catId, categoryName: 'کرایه', amount: 7000 } as Expense)
      eq('پول بعد از مصرف', await cashBalance(SHOP_BOX), 700)

      const im2 = (await deleteSaleImpact(saleId))!
      eq('پول بعد از حذف منفی می‌شود', im2.after, -2000)
      is('هشدار باید داده شود', im2.after < 0, true)

      // حذف باید باز هم ممکن باشد — اصلاح اشتباه نباید بسته شود
      await deleteSale(saleId)
      eq('پول واقعاً منفی شد', await cashBalance(SHOP_BOX), -2000)
      eq('جنس به گدام برگشت', await stockOf(vId), 20)
      eq('دفتر با پول برابر ماند', await cashLedgerEnd(), await cashBalance())

      // فروش قرضی: پولی پس نمی‌رود
      const s2 = await addSale(sell(vId, 2, 900, { customerId: cId, customerName: 'مشتری', paid: 0 }))
      const im3 = (await deleteSaleImpact(s2))!
      eq('فروش قرضی پول پس نمی‌دهد', im3.paid, 0)
      eq('پول تغییر نمی‌کند', im3.after, im3.before)

      is('فروش حذف‌شده اثری ندارد', await deleteSaleImpact(saleId), null)
    }
  },
  {
    name: 'صفحهٔ دفتر فزیکی — ترتیبش مثل ورق زدن دفتر باشد',
    run: async () => {
      const order = (ps: (string | undefined)[]) =>
        [...ps]
          .sort((a, b) => {
            const x = pageOrder(a)
            const y = pageOrder(b)
            return x.num - y.num || x.rest.localeCompare(y.rest)
          })
          .map((p) => p ?? '—')
          .join(',')

      // ۱۰ نباید پیش از ۲ بیاید (اشتباهِ چیدمانِ حرف‌به‌حرف)
      is('عدد صفحه سنجیده می‌شود، نه حرف', order(['۱۰', '۲', '۱']), '۱,۲,۱۰')
      // ارقام فارسی و لاتین یک چیز اند
      is('رقم فارسی و لاتین یکی', pageOrder('۱۲').num, pageOrder('12').num)
      // «۱۲/الف» بعد از «۱۲» می‌آید
      is('صفحهٔ فرعی بعد از اصلی', order(['۱۲/الف', '۱۲']), '۱۲,۱۲/الف')
      // بی‌صفحه‌ها آخر می‌مانند — (undefined را خودِ sort آخر می‌برد، پس اینجا با '' می‌سنجیم)
      is('بی‌صفحه آخر می‌ماند', order(['', '۳']), '۳,')
      is('بی‌صفحه عدد ندارد', pageOrder(undefined).num, pageOrder('').num)

      // ساحه فقط یادداشت است — به هیچ عددی دست نمی‌زند
      const cId = (await db.customers.add({ name: 'قندی', type: 'retail', balance: 0, bookPage: '۷' })) as number
      await addOpeningDebt('customer', cId, 'قندی', 1000)
      eq('قرض مثل همیشه', (await db.customers.get(cId))!.balance, 1000)
      is('صفحه سر جایش', (await db.customers.get(cId))!.bookPage, '۷')
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // خانواده: بعضی اعضا صفحه دارند، بعضی نه
      const f1 = familyPages([{ bookPage: '۷' }, { bookPage: '۳' }, {}, { bookPage: '  ' }])
      is('صفحه‌های خانواده به ترتیب', f1.pages.join(','), '۳,۷')
      eq('بی‌صفحه‌ها شمرده می‌شوند', f1.missing, 2)
      // همه در یک صفحه — یک بار گفته شود، نه چند بار
      const f2 = familyPages([{ bookPage: '۵' }, { bookPage: '۵' }])
      is('صفحهٔ تکراری یک بار', f2.pages.join(','), '۵')
      eq('هیچ‌کس بی‌صفحه نیست', f2.missing, 0)
      // ۱۰ نباید پیش از ۲ بیاید اینجا هم
      is('ترتیب عددی در خانواده هم', familyPages([{ bookPage: '۱۰' }, { bookPage: '۲' }]).pages.join(','), '۲,۱۰')
    }
  },
  {
    name: 'مشتری عمده با چند صفحهٔ دفتر — کدام صفحه چقدر است',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 100, 500, { paid: 0 }))
      const cId = (await db.customers.add({ name: 'حاجی', type: 'wholesale', balance: 0, bookPage: '۱۲' })) as number

      // صفحهٔ ۱۲: قرض قبلی ۵٬۰۰۰ + فروش قرضی ۲×۹۰۰ = ۱٬۸۰۰ → ۶٬۸۰۰
      await addOpeningDebt('customer', cId, 'حاجی', 5000, '', '۱۲')
      await addSale({ ...sell(vId, 2, 900, { customerId: cId, customerName: 'حاجی', paid: 0 }), bookPage: '۱۲' } as Sale)
      // صفحهٔ ۱۳: فروش قرضی ۳×۹۰۰ = ۲٬۷۰۰
      await addSale({ ...sell(vId, 3, 900, { customerId: cId, customerName: 'حاجی', paid: 0 }), bookPage: '۱۳' } as Sale)
      // دریافت ۲٬۰۰۰ بابت صفحهٔ ۱۲ → ۴٬۸۰۰
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'حاجی', amount: 2000, bookPage: '۱۲' })
      // یک سند بی‌صفحه — نباید در هیچ صفحه‌ای گم شود
      await addOpeningDebt('customer', cId, 'حاجی', 700)

      const ledgerOf = async () => {
        const [sl, pm, rt] = await Promise.all([
          db.sales.filter((x) => !x.deleted && x.customerId === cId).toArray(),
          db.payments.filter((x) => !x.deleted && x.partyType === 'customer' && x.partyId === cId).toArray(),
          db.returns.filter((x) => !x.deleted && x.kind === 'customer' && x.partyId === cId).toArray()
        ])
        return buildCustomerLedger(sl, pm, rt)
      }
      let pages = pageTotals(await ledgerOf())
      const of = (p?: string) => pages.find((x) => x.page === p)?.total ?? 0

      is('صفحه‌ها به ترتیب و بی‌صفحه آخر', pages.map((p) => p.page ?? '—').join(','), '۱۲,۱۳,—')
      eq('صفحهٔ ۱۲', of('۱۲'), 4800)
      eq('صفحهٔ ۱۳', of('۱۳'), 2700)
      eq('بی‌صفحه', of(undefined), 700)

      // قانون آهنین: جمع صفحه‌ها = قرض کل مشتری
      const bal = (await db.customers.get(cId))!.balance
      eq('جمع صفحه‌ها با قرض کل برابر است', pages.reduce((s, p) => s + p.total, 0), bal)
      eq('قرض کل', bal, 8200)

      // مرجوعی به همان صفحه‌ای می‌نشیند که فروشش نوشته شده بود
      const s13 = (await db.sales.filter((x) => !x.deleted && x.bookPage === '۱۳').toArray())[0]
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: cId,
        partyName: 'حاجی',
        refId: s13.id,
        lines: [{ variantId: vId, productName: 'بوت', size: '42', color: 'سیاه', qty: 1, unitPrice: 900, restock: true }],
        reason: 'خراب بود',
        settlement: 'reduceDebt',
        amount: 900
      } as ReturnDoc)
      pages = pageTotals(await ledgerOf())
      eq('مرجوعی از صفحهٔ ۱۳ کم شد', of('۱۳'), 1800)
      eq('صفحهٔ ۱۲ دست نخورد', of('۱۲'), 4800)
      eq('جمع باز هم با قرض کل برابر', pages.reduce((s, p) => s + p.total, 0), (await db.customers.get(cId))!.balance)
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // صفحه فقط یادداشت است — پخش سندها روی موبایل دوم همان قرض را می‌سازد
      const live = await db.payments.filter((p) => !p.deleted && p.partyId === cId).toArray()
      const liveSales = await db.sales.filter((x) => !x.deleted && x.customerId === cId).toArray()
      const liveRet = await db.returns.filter((x) => !x.deleted && x.partyId === cId).toArray()
      const before = (await db.customers.get(cId))!.balance
      await db.customers.update(cId, { balance: 0 })
      for (const d of liveSales) await applyDocEffects('sales', d as unknown as Record<string, unknown>, false)
      for (const d of live) await applyDocEffects('payments', d as unknown as Record<string, unknown>, false)
      for (const d of liveRet) await applyDocEffects('returns', d as unknown as Record<string, unknown>, false)
      eq('موبایل نو همان قرض را می‌سازد', (await db.customers.get(cId))!.balance, before)
    }
  },
  {
    name: 'قرض‌دهنده — قرض قبلی، پرداخت مستقیم فروشنده و حذف اشتباه',
    run: async () => {
      const lenderId = (await db.suppliers.add({ name: 'حاجی قرض‌دهنده', balance: 0, kind: 'lender' })) as number
      const supplierId = await newSupplier('فروشنده')
      await seedCash(100000)
      await addOpeningDebt('supplier', supplierId, 'فروشنده', 50000)

      // این پول قبلاً برای جنسِ موجودی اولیه مصرف شده؛ نباید دوباره وارد صندوق شود.
      await addLoan(lenderId, 'حاجی قرض‌دهنده', 30000, Date.now(), 'جنس موجودی اولیه', 'opening')
      eq('قرض قبلی به حساب قرض‌دهنده نشست', (await db.suppliers.get(lenderId))!.balance, 30000)
      eq('قرض قبلی صندوق را زیاد نکرد', await cashBalance(), 100000)

      // در خرید آینده قرض‌دهنده مستقیماً فروشنده را می‌پردازد.
      await throws('پرداخت مستقیم بدون انتخاب قرض‌دهنده ثبت نمی‌شود', () =>
        addPayment({
          date: Date.now(),
          partyType: 'supplier',
          partyId: supplierId,
          partyName: 'فروشنده',
          amount: 20000,
          via: 'lender'
        })
      )
      eq('سند ناقص قرض فروشنده را تغییر نداد', (await db.suppliers.get(supplierId))!.balance, 50000)
      await addPayment({
        date: Date.now(),
        partyType: 'supplier',
        partyId: supplierId,
        partyName: 'فروشنده',
        amount: 20000,
        via: 'lender',
        lenderId,
        lenderName: 'حاجی قرض‌دهنده'
      })
      eq('قرض فروشنده کم شد', (await db.suppliers.get(supplierId))!.balance, 30000)
      eq('قرض قرض‌دهنده زیاد شد', (await db.suppliers.get(lenderId))!.balance, 50000)
      eq('پرداخت مستقیم صندوق را تغییر نداد', await cashBalance(), 100000)

      const docs = await db.payments.filter((p) => !p.deleted).toArray()
      const lenderLedger = buildLenderLedger(docs, lenderId)
      eq('دفتر قرض‌دهنده هر دو سند را نشان می‌دهد', lenderLedger.length, 2)
      eq('جمع دفتر قرض‌دهنده درست است', lenderLedger.at(-1)?.balance ?? -1, 50000)

      // عین بازپخش موبایل دوم: هر دو حساب باید از روی سندها دوباره ساخته شوند.
      await db.suppliers.update(supplierId, { balance: 0 })
      await db.suppliers.update(lenderId, { balance: 0 })
      for (const p of docs) await applyDocEffects('payments', p as unknown as Record<string, unknown>, false)
      eq('موبایل دوم قرض فروشنده را درست ساخت', (await db.suppliers.get(supplierId))!.balance, 30000)
      eq('موبایل دوم قرض قرض‌دهنده را درست ساخت', (await db.suppliers.get(lenderId))!.balance, 50000)

      await throws('قرض‌دهنده با سند زنده حذف نمی‌شود', () => deleteLender(lenderId))
      await updateLender(lenderId, { name: 'حاجی اصلاح‌شده', phone: '0700000000', note: 'قسط ماهانه' })
      is('نام قرض‌دهنده ویرایش شد', (await db.suppliers.get(lenderId))!.name, 'حاجی اصلاح‌شده')

      const direct = docs.find((p) => p.via === 'lender')!
      const directImpact = (await deletePaymentImpact(direct.id!))!
      eq('حذف پرداخت مستقیم قرض فروشنده را برمی‌گرداند', directImpact.after, 50000)
      eq('حذف پرداخت مستقیم قرض قرض‌دهنده را برمی‌گرداند', directImpact.related?.after ?? -1, 30000)
      eq('حذف پرداخت مستقیم صندوق را دست نمی‌زند', directImpact.cash, 0)
      await deletePayment(direct.id!)
      eq('بعد حذف، قرض فروشنده برگشت', (await db.suppliers.get(supplierId))!.balance, 50000)
      eq('بعد حذف، قرض قرض‌دهنده برگشت', (await db.suppliers.get(lenderId))!.balance, 30000)

      const opening = docs.find((p) => p.partyId === lenderId && p.amount < 0)!
      const openingImpact = (await deletePaymentImpact(opening.id!))!
      eq('حذف قرض قبلی صندوق را دست نمی‌زند', openingImpact.cash, 0)
      await deletePayment(opening.id!)
      eq('قرض اشتباه پاک شد', (await db.suppliers.get(lenderId))!.balance, 0)
      eq('صندوق بعد از هر دو حذف همان ماند', await cashBalance(), 100000)
      await deleteLender(lenderId)
      is('قرض‌دهندهٔ بدون سند حذف شد', (await db.suppliers.get(lenderId))!.deleted, true)

      // قرض نقدی واقعاً وارد صندوق می‌شود و حذفش همان پول را برمی‌گرداند.
      const cashLenderId = (await db.suppliers.add({ name: 'قرض‌دهنده نقدی', balance: 0, kind: 'lender' })) as number
      await addLoan(cashLenderId, 'قرض‌دهنده نقدی', 7000, Date.now(), undefined, 'cash')
      eq('قرض نقدی وارد صندوق شد', await cashBalance(), 107000)
      const cashLoan = await db.payments.filter((p) => !p.deleted && p.partyId === cashLenderId).first()
      await deletePayment(cashLoan!.id!)
      eq('حذف قرض نقدی پول را از صندوق برگرداند', await cashBalance(), 100000)
      eq('حذف قرض نقدی قرض را صفر کرد', (await db.suppliers.get(cashLenderId))!.balance, 0)
      is('کنترل حساب‌ها سالم است', (await runIntegrityCheck()).mismatches.length, 0)
    }
  },
  {
    name: 'حساب کامل قرض‌دهنده — پول و کفش، تسویه و قرض',
    run: async () => {
      const lenderId = (await db.suppliers.add({ name: 'حاجی عبدالکریم', balance: 0, kind: 'lender' })) as number
      const variantId = await makeVariant({ purchasePrice: 500 })
      await setOpeningStock(variantId, 10, 'اسپرتکس')
      await seedCash(50000)
      await addLoan(lenderId, 'حاجی عبدالکریم', 100000, Date.now(), 'قرض پیشین', 'opening')

      await giveCashToLender(lenderId, 'حاجی عبدالکریم', 20000, Date.now(), 'قسط ماه', 'cashRepayment')
      await giveCashToLender(lenderId, 'حاجی عبدالکریم', 10000, Date.now(), 'قرض برای خانه', 'cashLoan')
      eq('دو پرداخت نقدی از صندوق کم شد', await cashBalance(), 20000)
      eq('دو پرداخت نقدی در حساب خالص کم شد', (await db.suppliers.get(lenderId))!.balance, 70000)

      await giveGoodsToLender(
        lenderId,
        'حاجی عبدالکریم',
        [{ variantId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 2, unitPrice: 900 }],
        Date.now(),
        'دو جوړه بابت قسط',
        'goodsSettlement'
      )
      await giveGoodsToLender(
        lenderId,
        'حاجی عبدالکریم',
        [{ variantId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 800 }],
        Date.now(),
        'یک جوړه برای خودش',
        'goodsCredit'
      )
      eq('سه جوړه از گدام کم شد', await stockOf(variantId), 7)
      eq('قیمت توافقی کفش از حساب خالص کم شد', (await db.suppliers.get(lenderId))!.balance, 67400)
      eq('دادن کفش صندوق را تغییر نداد', await cashBalance(), 20000)
      eq('مفاد با قیمت توافقی و قیمت خرید حساب شد', await profitAndLoss(), 1100)

      const payments = await db.payments.filter((p) => !p.deleted).toArray()
      const sales = await db.sales.filter((s) => !s.deleted).toArray()
      const summary = summarizeLenderAccount(payments, lenderId)
      eq('خلاصه قرض قبلی', summary.openingLoan, 100000)
      eq('خلاصه پرداخت نقدی قرض', summary.cashRepaid, 20000)
      eq('خلاصه قرض نقدی به قرض‌دهنده', summary.cashLoaned, 10000)
      eq('خلاصه کفش بابت تسویه', summary.goodsSettlement, 1800)
      eq('خلاصه کفش قرضی', summary.goodsCredit, 800)
      eq('خلاصه با حساب ذخیره‌شده برابر است', summary.net, 67400)
      const ledger = buildLenderLedger(payments, lenderId, sales)
      eq('دفتر پنج نوع سند را نشان می‌دهد', ledger.length, 5)
      is('جزئیات کفش در دفتر است', ledger.find((r) => r.label === 'کفش بابت تسویه')?.items, 'اسپرتکس 42 سیاه ×۲')
      eq('آخر دفتر با حساب خالص برابر است', ledger.at(-1)?.balance ?? -1, 67400)

      // بازپخش عین موبایل دوم: موجودی و حساب باید فقط از اسناد دوباره ساخته شود.
      await db.suppliers.update(lenderId, { balance: 0 })
      await db.variants.update(variantId, { stockQty: 10 })
      for (const s of sales) await applyDocEffects('sales', s as unknown as Record<string, unknown>, false)
      for (const p of payments) await applyDocEffects('payments', p as unknown as Record<string, unknown>, false)
      eq('موبایل دوم همان موجودی را می‌سازد', await stockOf(variantId), 7)
      eq('موبایل دوم همان حساب قرض‌دهنده را می‌سازد', (await db.suppliers.get(lenderId))!.balance, 67400)

      const settlementPayment = payments.find((p) => p.lenderAction === 'goodsSettlement')!
      const settlementSale = sales.find((s) => s.lenderAction === 'goodsSettlement')!
      await deletePayment(settlementPayment.id!)
      eq('حذف سند کفش، جنس را به گدام برگرداند', await stockOf(variantId), 9)
      eq('حذف سند کفش، حساب را برگرداند', (await db.suppliers.get(lenderId))!.balance, 69200)
      is('فروش پیوندشده هم حذف شد', (await db.sales.get(settlementSale.id!))!.deleted, true)
      eq('پس از حذف فقط مفاد کفش قرضی ماند', await profitAndLoss(), 300)

      const creditSale = sales.find((s) => s.lenderAction === 'goodsCredit')!
      const creditPayment = payments.find((p) => p.lenderAction === 'goodsCredit')!
      await deleteSale(creditSale.id!)
      eq('حذف از سند فروش هم جنس را برگرداند', await stockOf(variantId), 10)
      eq('حذف از سند فروش هم حساب را برگرداند', (await db.suppliers.get(lenderId))!.balance, 70000)
      is('سند حساب پیوندشده هم حذف شد', (await db.payments.get(creditPayment.id!))!.deleted, true)

      await throws('تسویه نقدی بیشتر از قرض پذیرفته نمی‌شود', () =>
        giveCashToLender(lenderId, 'حاجی عبدالکریم', 70001, Date.now(), undefined, 'cashRepayment')
      )
      await throws('تسویه با کفش بیشتر از قرض پذیرفته نمی‌شود', () =>
        giveGoodsToLender(
          lenderId,
          'حاجی عبدالکریم',
          [{ variantId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 70001 }],
          Date.now(),
          undefined,
          'goodsSettlement'
        )
      )
      eq('سند نامعتبر حساب را تغییر نداد', (await db.suppliers.get(lenderId))!.balance, 70000)
      eq('سند نامعتبر گدام را تغییر نداد', await stockOf(variantId), 10)
      await giveGoodsToLender(
        lenderId,
        'حاجی عبدالکریم',
        [{ variantId, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 70001 }],
        Date.now(),
        'قرض بزرگ برای خودش',
        'goodsCredit'
      )
      eq('کفش قرضی می‌تواند حساب را به طلب ما تبدیل کند', (await db.suppliers.get(lenderId))!.balance, -1)
      const crossing = await db.payments.filter((p) => !p.deleted && p.lenderAction === 'goodsCredit').first()
      await deletePayment(crossing!.id!)
      eq('حذف کفش قرضی بزرگ حساب را برگرداند', (await db.suppliers.get(lenderId))!.balance, 70000)
      eq('حذف کفش قرضی بزرگ گدام را برگرداند', await stockOf(variantId), 10)
      is('کنترل حساب‌ها سالم است', (await runIntegrityCheck()).mismatches.length, 0)
    }
  },
  {
    name: 'قرض اشتباهی — پاک شود و حساب به تصفیه برگردد',
    run: async () => {
      const cId = await newCustomer()
      await seedCash(10000)

      // مشتری حسابش را خلاص کرده بود؛ حالا به اشتباه ۳٬۰۰۰ قرض قبلی به نامش خورد
      await addOpeningDebt('customer', cId, 'مشتری', 3000)
      eq('قرض اشتباهی نشست', (await db.customers.get(cId))!.balance, 3000)
      const wrong = (await db.payments.where('[partyType+partyId]').equals(['customer', cId]).toArray())[0]

      const im = (await deletePaymentImpact(wrong.id!))!
      eq('قرض حالا', im.before, 3000)
      eq('قرض بعد از پاک کردن', im.after, 0)
      eq('قرض قبلی پولی جابه‌جا نکرده بود', im.cash, 0)

      await deletePayment(wrong.id!)
      eq('حساب تصفیه شد', (await db.customers.get(cId))!.balance, 0)
      eq('صندوق دست نخورد', await cashBalance(SHOP_BOX), 10000)
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)
      is('دوباره پاک کردن اثری ندارد', await deletePaymentImpact(wrong.id!), null)

      // دریافت پول اشتباهی: هم قرض و هم صندوق باید برگردند
      await addOpeningDebt('customer', cId, 'مشتری', 5000)
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 2000 })
      eq('قرض بعد از دریافت', (await db.customers.get(cId))!.balance, 3000)
      eq('صندوق بعد از دریافت', await cashBalance(SHOP_BOX), 12000)

      const recv = (await db.payments.where('[partyType+partyId]').equals(['customer', cId]).filter((p) => p.amount > 0).toArray())[0]
      const im2 = (await deletePaymentImpact(recv.id!))!
      eq('پولی که از صندوق پس می‌رود', im2.cash, -2000)
      await deletePayment(recv.id!)
      eq('قرض دوباره ۵٬۰۰۰ شد', (await db.customers.get(cId))!.balance, 5000)
      eq('صندوق هم برگشت', await cashBalance(SHOP_BOX), 10000)
      eq('دفتر پول با صندوق برابر ماند', await cashLedgerEnd(), await cashBalance())
      is('کنترل حساب‌ها باز هم سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // موبایل دیگر با پخش سندها باید به همین عدد برسد
      const live = await db.payments.filter((p) => !p.deleted).toArray()
      await db.customers.update(cId, { balance: 0 })
      for (const p of live) await applyDocEffects('payments', p as unknown as Record<string, unknown>, false)
      eq('موبایل نو هم ۵٬۰۰۰ می‌سازد', (await db.customers.get(cId))!.balance, 5000)
    }
  },
  {
    name: 'حذف فروش — پول در همان جای خود برمی‌گردد',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))
      await seedCash(20000)
      await transferCash(SHOP_BOX, 'خانه', 15000)

      const saleId = await addSale(sell(vId, 2, 900)) // به دکان می‌آید
      eq('دکان', await cashBalance(SHOP_BOX), 6800)
      eq('خانه', await cashBalance('خانه'), 15000)

      const im = (await deleteSaleImpact(saleId))!
      is('جای پول درست شناخته شد', im.box, SHOP_BOX)
      await deleteSale(saleId)
      eq('پول از دکان پس رفت', await cashBalance(SHOP_BOX), 5000)
      eq('خانه دست‌نخورده', await cashBalance('خانه'), 15000)
      eq('پول کل', await cashBalance(), 20000)
    }
  },
  {
    name: 'همگام‌سازی — موبایل نو همان موجودی را بسازد',
    run: async () => {
      const supId = await newSupplier()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      const cId = await newCustomer()
      await seedCash(200000)

      // خرید عادی، خرید «در راه» که بعداً رسید، فروش، مرجوعی، تعدیل
      await addPurchase(buy(supId, v1, 100, 500))
      const pid = await addPurchase(buy(supId, v2, 60, 700, { received: false, paid: 0 }))
      await receivePurchase(pid)
      await addSale(sell(v1, 10, 900, { customerId: cId, customerName: 'مشتری', paid: 0 }))
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
      await db.adjustments.add({
        date: Date.now(),
        variantId: v2,
        productName: 'اسپرتکس',
        size: '43',
        color: 'سیاه',
        qtyChange: -3,
        reason: 'damaged'
      })
      await db.variants.update(v2, { stockQty: (await stockOf(v2)) - 3 })

      const stock1 = await stockOf(v1)
      const stock2 = await stockOf(v2)
      const debt = (await db.customers.get(cId))!.balance
      const owed = (await db.suppliers.get(supId))!.balance
      eq('موجودی جنس اول در موبایل اول', stock1, 92)
      eq('موجودی جنس دوم در موبایل اول', stock2, 57)

      // موبایل نو: همهٔ اسناد را از نو پخش می‌کند (عیناً همان کاری که همگام‌سازی می‌کند)
      const [sales, purchases, payments, adjustments, returns] = await Promise.all([
        db.sales.filter((x) => !x.deleted).toArray(),
        db.purchases.filter((x) => !x.deleted).toArray(),
        db.payments.filter((x) => !x.deleted).toArray(),
        db.adjustments.filter((x) => !x.deleted).toArray(),
        db.returns.filter((x) => !x.deleted).toArray()
      ])
      await db.variants.update(v1, { stockQty: 0 })
      await db.variants.update(v2, { stockQty: 0 })
      await db.customers.update(cId, { balance: 0 })
      await db.suppliers.update(supId, { balance: 0 })
      for (const [table, rows] of [
        ['purchases', purchases],
        ['sales', sales],
        ['payments', payments],
        ['adjustments', adjustments],
        ['returns', returns]
      ] as const) {
        for (const r of rows) await applyDocEffects(table, r as unknown as Record<string, unknown>, false)
      }

      eq('موبایل نو — جنس اول', await stockOf(v1), stock1)
      eq('موبایل نو — جنس دوم (خرید در راه)', await stockOf(v2), stock2)
      eq('موبایل نو — قرض مشتری', (await db.customers.get(cId))!.balance, debt)
      eq('موبایل نو — قرض تأمین‌کننده', (await db.suppliers.get(supId))!.balance, owed)
      is('کنترل حساب‌ها هم سالم', (await runIntegrityCheck()).mismatches.length, 0)
    }
  },
  {
    name: 'مصرف خانه به نام شریک — از سهم خودش کم شود',
    run: async () => {
      // دو شریک، هر کدام ۵۰٪
      const meId = (await db.suppliers.add({ name: 'مالک', balance: 0, kind: 'partner', share: 50, capital: 50000 })) as number
      const heId = (await db.suppliers.add({ name: 'شریک', balance: 0, kind: 'partner', share: 50, capital: 50000 })) as number
      await seedCash(100000)
      await db.settings.put({ key: 'partnershipStart', value: 1 })
      const catId = (await db.expenseCategories.add({ name: 'خرچ خانه' })) as number

      // مالک ۱۰٬۰۰۰ مصرف خانه کرد — به نام خودش
      await addExpense(
        { date: Date.now(), type: 'home', categoryId: catId, categoryName: 'خرچ خانه', amount: 10000 } as Expense,
        'مالک'
      )

      const movements = await db.cashMovements.filter((m) => !m.deleted).toArray()
      const DRAW = ['withdrawal', 'homeExpense', 'personalExpense']
      const draws = movements.filter((m) => DRAW.includes(m.type))
      const wOf = (n: string) => draws.filter((m) => m.partnerName === n).reduce((s, m) => s - m.amount, 0)
      const untagged = draws.filter((m) => !m.partnerName).reduce((s, m) => s - m.amount, 0)

      eq('برداشت مالک', wOf('مالک'), 10000)
      eq('برداشت شریک', wOf('شریک'), 0)
      eq('برداشت بی‌نام صفر است', untagged, 0)

      const s0 = await settlement()
      eq('پول صندوق', s0.cash, 90000)
      eq('دارایی', s0.assets, 90000)
      eq('مجموع برداشت‌ها', s0.wSum, 10000)
      eq('مفاد سال صفر — مصرف خانه مفاد تجارت نیست', s0.yearProfit, 0)

      // سهم هر کس صفر است؛ ولی مالک ۱۰٬۰۰۰ گرفته پس باید همان از او کم شود
      const shareOf = (share: number) => Math.round((s0.yearProfit * share) / 100)
      eq('پرداختنی به مالک', shareOf(50) - wOf('مالک'), -10000)
      eq('پرداختنی به شریک', shareOf(50) - wOf('شریک'), 0)
      is('مالک و شریک هر دو ثبت‌اند', (await db.suppliers.bulkGet([meId, heId])).every(Boolean), true)
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
  },
  {
    name: 'یکجا کردن یک جنس که کارتنی و جوړه‌ای جدا ثبت شده',
    run: async () => {
      // «کوهستان» کارتنی: سایز ۴۲ و ۴۳ — و «کوهستان جوړه‌ای»: سایز ۴۲ و ۴۴
      const pA = (await db.products.add({ name: 'کوهستان', createdAt: Date.now() })) as number
      const pB = (await db.products.add({ name: 'کوهستان جوړه‌ای', createdAt: Date.now() })) as number
      const mk = async (pid: number, size: string, qty: number) =>
        (await db.variants.add({
          productId: pid,
          size,
          color: 'سیاه',
          stockQty: qty,
          purchasePrice: 500,
          retailPrice: 900,
          wholesalePrice: 800,
          lowStock: 2
        })) as number
      const a42 = await mk(pA, '42', 480)
      await mk(pA, '43', 240)
      await mk(pB, '42', 12)
      await mk(pB, '44', 7)
      // اسناد «موجودی اولیه» تا کنترل حساب‌ها از ابتدا سالم باشد
      for (const v of await db.variants.toArray())
        await db.adjustments.add({
          date: Date.now(),
          variantId: v.id!,
          productName: '',
          size: v.size,
          color: v.color,
          qtyChange: v.stockQty,
          reason: 'correction',
          note: 'موجودی اولیه'
        })

      const before = (await db.variants.filter((v) => !v.deleted).toArray()).reduce((s, v) => s + v.stockQty, 0)
      eq('مجموع جوړه پیش از یکجا کردن', before, 739)
      is('کنترل حساب‌ها پیش از یکجا کردن سالم', (await runIntegrityCheck()).mismatches.length, 0)

      const groups = findDuplicateGroups(await db.products.toArray())
      eq('گروه تکراری پیدا شد', groups.length, 1)
      is('«جوړه‌ای» در نام نادیده گرفته می‌شود', normalizeName('کوهستان جوړه‌ای'), normalizeName('کوهستان'))

      const r = await mergeProducts(pA, [pB])
      eq('یک سایز جمع شد (۴۲)', r.combined, 1)
      eq('یک سایز منتقل شد (۴۴)', r.moved, 1)

      const after = (await db.variants.filter((v) => !v.deleted).toArray()).reduce((s, v) => s + v.stockQty, 0)
      eq('مجموع جوړه تغییر نکرد', after, before)
      eq('سایز ۴۲ جمع شد: ۴۸۰ + ۱۲', (await db.variants.get(a42))!.stockQty, 492)
      const kept = await db.variants.filter((v) => !v.deleted && v.productId === pA).toArray()
      eq('همه زیر یک جنس آمدند', kept.length, 3)
      is('جنس تکراری برداشته شد', (await db.products.get(pB))!.deleted, true)
      // مهم‌ترین بررسی: عددهای ذخیره‌شده هنوز با اسناد جور است
      is('کنترل حساب‌ها بعد از یکجا کردن سالم', (await runIntegrityCheck()).mismatches.length, 0)
      eq('جنس تکراری دیگر نمانده', findDuplicateGroups(await db.products.filter((p) => !p.deleted).toArray()).length, 0)

      // اگر یک جنس دو بار در لیست بیاید، نباید موجودی‌اش دو بار جمع شود
      const pC = (await db.products.add({ name: 'بامیان', createdAt: Date.now() })) as number
      const c42 = await mk(pC, '42', 30)
      await db.adjustments.add({
        date: Date.now(),
        variantId: c42,
        productName: 'بامیان',
        size: '42',
        color: 'سیاه',
        qtyChange: 30,
        reason: 'correction',
        note: 'موجودی اولیه'
      })
      const beforeDup = (await db.variants.filter((v) => !v.deleted).toArray()).reduce((s, v) => s + v.stockQty, 0)
      await mergeProducts(pA, [pC, pC, pC])
      const afterDup = (await db.variants.filter((v) => !v.deleted).toArray()).reduce((s, v) => s + v.stockQty, 0)
      eq('نام تکراری در لیست، موجودی را دو بار جمع نمی‌کند', afterDup, beforeDup)
      is('کنترل حساب‌ها بعد از لیست تکراری سالم', (await runIntegrityCheck()).mismatches.length, 0)
    }
  },
  {
    name: 'لیست اجناس فروخته‌شده — فقط همان‌ها، نه تمام گدام',
    run: async () => {
      const supId = await newSupplier()
      const sold = await makeVariant()
      const untouched = await makeVariant({ size: '44' })
      const cId = await newCustomer()
      await addPurchase(buy(supId, sold, 10, 500, { paid: 0 }))
      await addPurchase(buy(supId, untouched, 10, 500, { paid: 0 }))
      await addSale(sell(sold, 3, 900, { customerId: cId, customerName: 'مشتری' }))
      await addSale(sell(sold, 2, 900))

      const sales = await db.sales.toArray()
      const rows = soldInPeriod(sales, [])
      eq('فقط یک سایز در لیست است', rows.length, 1)
      eq('تعداد فروخته‌شده جمع می‌شود', rows[0].qty, 5)
      eq('فروش پولی', rows[0].revenue, 4500)
      is('سایز فروخته‌نشده در لیست نیست', rows.some((r) => r.variantId === untouched), false)

      // مرجوعی از تعداد کم می‌شود
      await addCustomerReturn({
        date: Date.now(),
        kind: 'customer',
        partyId: cId,
        partyName: 'مشتری',
        lines: [{ variantId: sold, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 1, unitPrice: 900, restock: true }],
        amount: 900,
        settlement: 'cash'
      })
      const after = soldInPeriod(await db.sales.toArray(), await db.returns.toArray())
      eq('مرجوعی از فروش کم شد', after[0].qty, 4)
      // ۴ جوړه × (۹۰۰ − ۵۰۰) = ۱٬۶۰۰ — قیمت خرید مرجوعی هم باید پس رفته باشد
      eq('مفاد بعد از مرجوعی درست است', after[0].revenue - after[0].cost, 1600)

      // شمارش کوتاه: فقط همین سایزها
      const ids = soldVariantIds(await db.sales.toArray(), await db.returns.toArray())
      is('سایز فروخته‌شده باید شمرده شود', ids.has(sold), true)
      is('سایز حرکت‌نکرده لازم نیست شمرده شود', ids.has(untouched), false)
    }
  },
  {
    name: 'مصارف رسیدن دو بار — یک بار نقد، یک بار از صراف',
    run: async () => {
      const supId = await newSupplier()
      const sarrafId = (await db.suppliers.add({ name: 'صراف', balance: 0, kind: 'sarraf' })) as number
      const vId = await makeVariant()
      await seedCash(100000)
      const pid = await addPurchase(buy(supId, vId, 10, 500, { paid: 0 }))

      // اول ۱٬۰۰۰ نقد، بعد ۴۰۰ از طریق صراف — روی همان خرید
      await addLandingCost([pid], 1000, 'cash')
      await addLandingCost([pid], 400, 'sarraf', { id: sarrafId, name: 'صراف' })

      // فقط ۴۰۰ قرض صراف است، نه مجموع ۱٬۴۰۰
      eq('قرض ما به صراف فقط بخش خودش است', (await db.suppliers.get(sarrafId))!.balance, 400)
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // و موبایل نو هم باید همان ۴۰۰ را بسازد
      const purchases = await db.purchases.filter((p) => !p.deleted).toArray()
      await db.suppliers.update(sarrafId, { balance: 0 })
      for (const p of purchases) await applyDocEffects('purchases', p as unknown as Record<string, unknown>, false)
      eq('موبایل نو هم همان ۴۰۰ را می‌سازد', (await db.suppliers.get(sarrafId))!.balance, 400)
    }
  },
  {
    name: 'دارایی خالص — مصارف رسیدنِ پرداخت‌نشده قرض است، نه سود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await seedCash(50000)
      // ۱۰ جوړه × ۵۰۰ = ۵٬۰۰۰ نقد پرداخت شد
      const pid = await addPurchase(buy(supId, vId, 10, 500, { paid: 5000 }))
      // ۲٬۰۰۰ مصارف رسیدن که «بعداً» پرداخت می‌شود
      await addLandingCost([pid], 2000, 'later')

      const n = await netWorth()
      // ارزش گدام حالا ۵٬۰۰۰ + ۲٬۰۰۰ = ۷٬۰۰۰ است چون مصارف رسیدن در قیمت نشسته
      eq('ارزش گدام مصارف رسیدن را در خود دارد', n.stock, 7000)
      eq('پول نقد', n.cash, 45000)
      eq('مصارف رسیدنِ پرداخت‌نشده قرض است', n.unpaidLanding, 2000)
      // ۷٬۰۰۰ + ۴۵٬۰۰۰ − ۲٬۰۰۰ = ۵۰٬۰۰۰ — همان که اول داشتیم، نه یک افغانی بیشتر
      eq('دارایی خالص تغییر نکرده — خرید سود نمی‌سازد', n.assets, 50000)

      // پرداخت قرض، دارایی را کم نمی‌کند: هم پول کم می‌شود هم قرض
      await payLanding(pid)
      const after = await netWorth()
      eq('بعد از پرداخت، قرضی نمانده', after.unpaidLanding, 0)
      eq('پول به اندازهٔ پرداخت کم شد', after.cash, 43000)
      eq('دارایی خالص دست‌نخورده — قرض دادن سود و زیان نیست', after.assets, 50000)
    }
  },
  {
    name: 'قیمت تمام‌شده — مصارف رسیدن روی موجودی قبلی پخش نشود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await seedCash(200000)
      // ۱۰ جوړه × ۵۰۰ خرید اول
      await addPurchase(buy(supId, vId, 10, 500, { paid: 5000 }))
      eq('قیمت بعد از خرید اول', (await db.variants.get(vId))!.purchasePrice, 500)
      // ۱۰ جوړهٔ دیگر × ۵۰۰ — حالا ۲۰ جوړه به قیمت ۵۰۰
      const p2 = await addPurchase(buy(supId, vId, 10, 500, { paid: 5000 }))
      eq('قیمت بعد از خرید دوم', (await db.variants.get(vId))!.purchasePrice, 500)

      // ۱٬۰۰۰ مصارف رسیدن فقط روی حملِ دوم (۱۰ جوړه) → ۱۰۰ فی جوړه
      // میانگین درست: (۱۰×۵۰۰ + ۱۰×۶۰۰) ÷ ۲۰ = ۵۵۰ — نه ۶۰۰
      await addLandingCost([p2], 1000, 'cash')
      eq('میانگین وزنی، نه جمع ساده', (await db.variants.get(vId))!.purchasePrice, 550)
      is('کنترل حساب‌ها قیمت را هم می‌سنجد و سالم است', (await runIntegrityCheck()).mismatches.length, 0)

      // موبایل نو باید به همان ۵۵۰ برسد
      const rebuilt = await rebuildCosts()
      eq('موبایل نو همان قیمت را می‌سازد', rebuilt.get(vId)!, 550)

      // و اگر کسی قیمت را دستی خراب کند، کنترل حساب‌ها می‌گیردش
      await db.variants.update(vId, { purchasePrice: 999 })
      const bad = await runIntegrityCheck()
      eq('قیمت خرابْ گرفته می‌شود', bad.mismatches.filter((m) => m.kind === 'cost').length, 1)
      for (const m of bad.mismatches) await fixMismatch(m)
      eq('بعد از اصلاح، قیمت درست شد', (await db.variants.get(vId))!.purchasePrice, 550)
    }
  },
  {
    name: 'اثر سندها یک تعریف دارد — پخش و کنترل و ثبت هر سه یکی‌اند',
    run: async () => {
      const supId = await newSupplier()
      const sarrafId = (await db.suppliers.add({ name: 'صراف', balance: 0, kind: 'sarraf' })) as number
      const cId = await newCustomer()
      const v1 = await makeVariant()
      const v2 = await makeVariant({ size: '43' })
      await seedCash(300000)

      // هر نوع سند یک بار: خرید عادی، خرید در راه که رسید، حواله، فروش قرضی،
      // پرداخت، مرجوعی مشتری، مرجوعی به تأمین‌کننده، تعدیل
      await addPurchase(buy(supId, v1, 100, 500, { paid: 20000 }))
      const inTransit = await addPurchase(buy(supId, v2, 60, 700, { received: false, paid: 0 }))
      await receivePurchase(inTransit)
      await addPurchase(buy(supId, v1, 10, 500, { paid: 0, sarrafId, sarrafAmount: 3000 }))
      await addSale(sell(v1, 10, 900, { customerId: cId, customerName: 'مشتری', paid: 1000 }))
      await addPayment({ date: Date.now(), partyType: 'customer', partyId: cId, partyName: 'مشتری', amount: 500 })
      await addCustomerReturn({
        date: Date.now(), kind: 'customer', partyId: cId, partyName: 'مشتری',
        lines: [{ variantId: v1, productName: 'اسپرتکس', size: '42', color: 'سیاه', qty: 2, unitPrice: 900, restock: true }],
        amount: 1800, settlement: 'reduceDebt'
      })
      await addSupplierReturn({
        date: Date.now(), kind: 'supplier', partyId: supId, partyName: 'تأمین‌کننده',
        lines: [{ variantId: v2, productName: 'اسپرتکس', size: '43', color: 'سیاه', qty: 5, unitPrice: 700, restock: false }],
        amount: 3500, settlement: 'reduceDebt'
      })
      await addAdjustment({
        date: Date.now(), variantId: v1, productName: 'اسپرتکس', size: '42', color: 'سیاه',
        qtyChange: -3, reason: 'damaged'
      })

      // ۱) آنچه ops.ts نوشته
      const stored = {
        v1: (await db.variants.get(v1))!.stockQty,
        v2: (await db.variants.get(v2))!.stockQty,
        cust: (await db.customers.get(cId))!.balance,
        sup: (await db.suppliers.get(supId))!.balance,
        sarraf: (await db.suppliers.get(sarrafId))!.balance
      }
      is('کنترل حساب‌ها با ثبت می‌خواند', (await runIntegrityCheck()).mismatches.length, 0)

      // ۲) موبایل نو: همه‌چیز صفر و بعد پخش دوبارهٔ اسناد
      const docs = {
        purchases: await db.purchases.filter((x) => !x.deleted).toArray(),
        sales: await db.sales.filter((x) => !x.deleted).toArray(),
        payments: await db.payments.filter((x) => !x.deleted).toArray(),
        adjustments: await db.adjustments.filter((x) => !x.deleted).toArray(),
        returns: await db.returns.filter((x) => !x.deleted).toArray()
      }
      for (const id of [v1, v2]) await db.variants.update(id, { stockQty: 0 })
      await db.customers.update(cId, { balance: 0 })
      for (const id of [supId, sarrafId]) await db.suppliers.update(id, { balance: 0 })
      for (const [table, rows] of Object.entries(docs))
        for (const r of rows) await applyDocEffects(table as 'sales', r as unknown as Record<string, unknown>, false)

      eq('موبایل نو — موجودی جنس اول', (await db.variants.get(v1))!.stockQty, stored.v1)
      eq('موبایل نو — موجودی جنس دوم (خرید در راه)', (await db.variants.get(v2))!.stockQty, stored.v2)
      eq('موبایل نو — قرض مشتری', (await db.customers.get(cId))!.balance, stored.cust)
      eq('موبایل نو — قرض تأمین‌کننده', (await db.suppliers.get(supId))!.balance, stored.sup)
      eq('موبایل نو — قرض صراف', (await db.suppliers.get(sarrafId))!.balance, stored.sarraf)

      // ۳) و پخشِ برعکس باید همه را به صفر برگرداند
      for (const [table, rows] of Object.entries(docs))
        for (const r of rows) await applyDocEffects(table as 'sales', r as unknown as Record<string, unknown>, true)
      eq('پخش برعکس — جنس اول صفر', (await db.variants.get(v1))!.stockQty, 0)
      eq('پخش برعکس — قرض مشتری صفر', (await db.customers.get(cId))!.balance, 0)
      eq('پخش برعکس — قرض صراف صفر', (await db.suppliers.get(sarrafId))!.balance, 0)
    }
  },
  {
    name: 'شراکت — شروع سال با تابع واقعی اپ، نه کپیِ آزمایش',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await seedCash(100000)
      await addPurchase(buy(supId, vId, 100, 500, { paid: 50000 }))

      // شریک ۲۰٬۰۰۰ گذاشته؛ دارایی خالص = ۵۰٬۰۰۰ نقد + ۵۰٬۰۰۰ گدام = ۱۰۰٬۰۰۰
      const n = await netWorth()
      eq('دارایی خالص', n.assets, 100000)

      await addPartner({ name: 'شریک', capital: 20000, share: 30 })
      const left = await remainingCapital()
      eq('باقی‌مانده برای مالک', left, 80000)

      await startYear('مالک')
      const partners = await listPartners()
      const owner = partners.find((p) => p.name === 'مالک')!
      eq('سرمایهٔ مالک خودکار = باقی‌ماندهٔ دارایی', owner.capital!, 80000)
      eq('فیصدی مالک = باقی‌ماندهٔ فیصدی', owner.share!, 70)
      eq('مجموع فیصدی‌ها دقیقاً ۱۰۰', partners.reduce((s, p) => s + (p.share ?? 0), 0), 100)
      eq('مجموع سرمایه‌ها = دارایی، پس مفاد روز اول صفر', await totalCapital(), 100000)

      // محافظ‌ها — دیگر فقط در ظاهرِ فورم نیستند
      await throws('سرمایهٔ بیشتر از دارایی رد می‌شود', () =>
        addPartner({ name: 'زیادی', capital: 999999, share: 10 })
      )
      await throws('فیصدی که سهمی برای مالک نگذارد رد می‌شود', () =>
        addPartner({ name: 'حریص', capital: 100, share: 95 })
      )
      await throws('اصلاح سرمایه به عددی بیشتر از دارایی رد می‌شود', () =>
        setPartnerCapital(owner.id!, 500000)
      )
    }
  },
  {
    name: 'شراکت — بستن سال اتمی است و سهم درست تقسیم می‌شود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      const cId = await newCustomer()
      await seedCash(100000)
      await addPurchase(buy(supId, vId, 100, 500, { paid: 50000 }))
      await addPartner({ name: 'شریک', capital: 20000, share: 30 })
      await startYear('مالک')
      eq('مفاد روز اول صفر', (await netWorth()).assets - (await totalCapital()), 0)

      // حالا ۱۰ جوړه به ۹۰۰ فروش نقدی → مفاد ۴٬۰۰۰
      await addSale(sell(vId, 10, 900, { customerId: cId, customerName: 'مشتری' }))
      const profit = (await netWorth()).assets - (await totalCapital())
      eq('مفاد سال = ۱۰ × (۹۰۰ − ۵۰۰)', profit, 4000)

      const partners = await listPartners()
      const owner = partners.find((p) => p.name === 'مالک')!
      const mate = partners.find((p) => p.name === 'شریک')!

      // هر دو فایده را دوباره سرمایه می‌کنند → سرمایه‌ها زیاد و مفاد صفر می‌شود
      await settleYear({
        choices: { [owner.id!]: 'reinvest', [mate.id!]: 'reinvest' },
        payCash: false,
        yearProfit: profit,
        withdrawnBy: () => 0
      })

      const after = await listPartners()
      eq('سهم شریک ۳۰٪ = ۱٬۲۰۰', after.find((p) => p.name === 'شریک')!.capital!, 21200)
      eq('سهم مالک ۷۰٪ = ۲٬۸۰۰', after.find((p) => p.name === 'مالک')!.capital!, 82800)
      eq('مجموع سرمایه‌ها = دارایی، پس سال نو با مفاد صفر شروع می‌شود', await totalCapital(), (await netWorth()).assets)
      is('تاریخ سال نو ثبت شد', Number((await db.settings.get('partnershipStart'))?.value ?? 0) > 0, true)
    }
  },
  {
    name: 'ثبت جنس و موجودی اولیه — همیشه با سند، و منفی رد می‌شود',
    run: async () => {
      const pid = (await db.products.add({ name: 'کوهستان', createdAt: Date.now() })) as number

      // ساختن سایز با موجودی اولیه — عدد و سند با هم
      const vId = await addVariant(
        { productId: pid, size: '42', color: 'سیاه', purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, stockQty: 24, lowStock: 2 },
        'کوهستان'
      )
      eq('موجودی ثبت شد', (await db.variants.get(vId))!.stockQty, 24)
      const docs = await db.adjustments.filter((a) => a.variantId === vId).toArray()
      eq('یک سند «موجودی اولیه» نوشته شد', docs.length, 1)
      eq('سند همان تعداد را می‌گوید', docs[0].qtyChange, 24)
      is('سند نامش «موجودی اولیه» است', docs[0].note, 'موجودی اولیه')
      is('کد جنس ساخته شد', typeof (await db.variants.get(vId))!.sku, 'string')
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // اصلاح موجودی از فورم — باز هم سند می‌سازد، نه نوشتنِ مستقیم
      await setOpeningStock(vId, 20, 'کوهستان')
      eq('موجودی اصلاح شد', (await db.variants.get(vId))!.stockQty, 20)
      eq('سند دوم هم نوشته شد', (await db.adjustments.filter((a) => a.variantId === vId).toArray()).length, 2)
      is('کنترل حساب‌ها باز هم سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // محافظ — دیگر فقط در ظاهر فورم نیست
      await throws('موجودی منفی رد می‌شود', () => setOpeningStock(vId, -5))
      await throws('ساختن سایز با موجودی منفی رد می‌شود', () =>
        addVariant(
          { productId: pid, size: '44', color: 'سیاه', purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, stockQty: -3, lowStock: 2 },
          'کوهستان'
        )
      )
      eq('بعد از رد شدن، چیزی عوض نشد', (await db.variants.get(vId))!.stockQty, 20)

      // موبایل نو هم همان عدد را می‌سازد
      const adjustments = await db.adjustments.filter((a) => !a.deleted).toArray()
      await db.variants.update(vId, { stockQty: 0 })
      for (const a of adjustments) await applyDocEffects('adjustments', a as unknown as Record<string, unknown>, false)
      eq('موبایل نو همان ۲۰ را می‌سازد', (await db.variants.get(vId))!.stockQty, 20)
    }
  },
  {
    name: 'اصلاح قیمت خرید با سند می‌ماند و پاک نمی‌شود',
    run: async () => {
      const supId = await newSupplier()
      const vId = await makeVariant()
      await seedCash(100000)
      await addPurchase(buy(supId, vId, 10, 500, { paid: 5000 }))
      eq('قیمت از خرید', (await db.variants.get(vId))!.purchasePrice, 500)

      // مالک قیمت را اصلاح می‌کند — مثلاً ۵۰۰ اشتباه بود و ۹۰۰ درست است
      await setPurchaseCost(vId, 900, 'اسپرتکس')
      eq('قیمت اصلاح شد', (await db.variants.get(vId))!.purchasePrice, 900)

      // حالا کارهایی که بازسازی قیمت را صدا می‌زنند — نباید اصلاح را پاک کنند
      const p2 = (await db.products.add({ name: 'دیگر', createdAt: Date.now() })) as number
      await addVariant(
        { productId: p2, size: '41', color: 'سیاه', purchasePrice: 300, retailPrice: 600, wholesalePrice: 500, stockQty: 5, lowStock: 2 },
        'دیگر'
      )
      eq('بعد از افزودن جنس نو', (await db.variants.get(vId))!.purchasePrice, 900)

      await addPurchase(buy(supId, vId, 10, 900, { paid: 9000 }))
      eq('خرید نو با همان قیمت، میانگین را عوض نمی‌کند', (await db.variants.get(vId))!.purchasePrice, 900)

      // و موبایل دوم هم به همان ۹۰۰ می‌رسد
      eq('موبایل نو همان قیمت را می‌سازد', (await rebuildCosts()).get(vId)!, 900)
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)

      // سند اصلاح، تعداد را دست نزده
      const stock = (await db.variants.get(vId))!.stockQty
      eq('موجودی دست‌نخورده', stock, 20)
    }
  },
  {
    name: 'قرض پرچون — از بابت کدام بوت و کدام تاریخ',
    run: async () => {
      const supId = await newSupplier()
      const cId = await newCustomer('کریم')
      await seedCash(100000)
      const pid = (await db.products.add({ name: 'کوهستان', createdAt: Date.now() })) as number
      const v42 = await addVariant(
        { productId: pid, size: '42', color: 'سیاه', purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, stockQty: 20, lowStock: 2 },
        'کوهستان'
      )
      const v40 = await addVariant(
        { productId: pid, size: '40', color: 'خاکی', purchasePrice: 500, retailPrice: 900, wholesalePrice: 800, stockQty: 20, lowStock: 2 },
        'کوهستان'
      )

      // قرض قبلی، بعد دو فروش قرضی از دو بوت مختلف، بعد یک پرداخت
      await addOpeningDebt('customer', cId, 'کریم', 1000)
      await addSale({
        date: Date.parse('2026-05-10'),
        customerId: cId,
        customerName: 'کریم',
        saleType: 'retail',
        lines: [{ variantId: v42, productName: 'کوهستان', size: '42', color: 'سیاه', qty: 2, unitPrice: 900 }],
        total: 1800,
        paid: 0
      })
      await addSale({
        date: Date.parse('2026-06-01'),
        customerId: cId,
        customerName: 'کریم',
        saleType: 'retail',
        lines: [{ variantId: v40, productName: 'کوهستان', size: '40', color: 'خاکی', qty: 1, unitPrice: 900 }],
        total: 900,
        paid: 400
      })
      await addPayment({ date: Date.parse('2026-06-05'), partyType: 'customer', partyId: cId, partyName: 'کریم', amount: 700 })

      const sales = await db.sales.filter((x) => !x.deleted && x.customerId === cId).toArray()
      const payments = await db.payments.filter((x) => !x.deleted && x.partyId === cId).toArray()
      const rows = buildCustomerLedger(sales, payments, [])

      eq('چهار سند در دفتر', rows.length, 4)
      // هر فروش قرضی باید بگوید کدام بوت
      const s1 = rows.find((r) => r.items?.includes('42'))!
      is('بوت اول با سایز و رنگ و تعداد', s1.items, 'کوهستان 42 سیاه ×۲')
      eq('قرضِ همان فروش', s1.delta, 1800)
      is('تاریخش همان روز فروش است', s1.date, Date.parse('2026-05-10'))

      const s2 = rows.find((r) => r.items?.includes('40'))!
      is('بوت دوم', s2.items, 'کوهستان 40 خاکی ×۱')
      eq('فقط باقی‌ماندهٔ آن فروش قرض شد', s2.delta, 500)

      // قرض قبلی و پرداخت، بوت ندارند
      is('قرض قبلی بوت ندارد', rows.find((r) => r.delta === 1000)!.items, undefined)
      is('دریافت پول بوت ندارد', rows.find((r) => r.delta === -700)!.items, undefined)

      // قرض نهایی: ۱٬۰۰۰ + ۱٬۸۰۰ + ۵۰۰ − ۷۰۰
      eq('قرض نهایی دفتر', rows[rows.length - 1].balance, 2600)
      eq('با عدد ذخیره‌شده هم برابر است', (await db.customers.get(cId))!.balance, 2600)
      is('کنترل حساب‌ها سالم', (await runIntegrityCheck()).mismatches.length, 0)
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
