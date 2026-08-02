/**
 * حساب شراکت — سرمایه، سهم، شروع و بستن سال.
 *
 * پیش از این همهٔ این‌ها با `db.suppliers.update` مستقیم از داخل دو فورم نوشته
 * می‌شد. سه اشکال داشت:
 *   • «بستن سال» چند نوشتن پشت سر هم بود بدون transaction — اگر وسط کار
 *     برق می‌رفت یا اپ بسته می‌شد، سال نیمه‌بسته می‌ماند.
 *   • محافظِ «سرمایه بیشتر از دارایی نشود» فقط در ظاهرِ فورم بود (دکمهٔ خاموش)،
 *     نه در خودِ نوشتن. هر راه دیگری آن را دور می‌زد.
 *   • آزمایش‌ها مجبور بودند فورمول ویزارد را دستی از نو بنویسند، پس کدِ واقعی
 *     هرگز آزمایش نمی‌شد.
 *
 * قاعدهٔ بنیادی که همه‌جا نگه داشته می‌شود:
 *   دارایی = سرمایه + مفاد − برداشت‌ها
 * و روز اولِ سال، مفاد باید دقیقاً صفر باشد — پس سرمایهٔ مالک همیشه
 * «دارایی خالص منهای سرمایهٔ شرکا» است و هرگز با دست تایپ نمی‌شود.
 */
import { db, type Supplier } from '../db'
import { afn, addPartnerWithdrawal, recordCapitalCash } from './ops'
import { netWorth } from './networth'

export const PARTNERSHIP_START = 'partnershipStart'

/** شرکای ثبت‌شده */
export async function listPartners(): Promise<Supplier[]> {
  return db.suppliers.filter((x) => !x.deleted && x.kind === 'partner').toArray()
}

/** مجموع سرمایهٔ ثبت‌شده */
export async function totalCapital(): Promise<number> {
  return (await listPartners()).reduce((s, p) => s + (p.capital ?? 0), 0)
}

/**
 * سرمایه‌ای که هنوز به کسی نسبت داده نشده = دارایی خالص − سرمایهٔ شرکا.
 * سرمایهٔ مالک همیشه همین است.
 */
export async function remainingCapital(): Promise<number> {
  const [n, cap] = await Promise.all([netWorth(), totalCapital()])
  return afn(n.assets - cap)
}

export interface AddPartnerInput {
  name: string
  capital: number
  share: number
  /** پول نو می‌آورد و همین حالا وارد صندوق می‌شود */
  bringsCash?: boolean
}

/**
 * افزودن شریک. اگر پول نو نمی‌آورد، سرمایه‌اش نمی‌تواند از باقی‌ماندهٔ دارایی
 * بیشتر باشد — وگرنه مجموع سرمایه‌ها از دارایی بیشتر می‌شود و مفاد به‌غلط
 * نقص نشان می‌دهد (همان اشتباهی که یک بار −۱۰۰٬۰۰۰ ساخت).
 */
export async function addPartner(input: AddPartnerInput): Promise<number> {
  const name = input.name.trim()
  const capital = afn(input.capital)
  if (!name) throw new Error('نام شریک را بنویسید')
  if (capital <= 0) throw new Error('سرمایه باید بیشتر از صفر باشد')
  if (input.share <= 0 || input.share >= 100) throw new Error('فیصدی سهم باید بین ۱ و ۹۹ باشد')

  if (!input.bringsCash) {
    const left = await remainingCapital()
    if (capital > left)
      throw new Error(
        `سرمایه از باقی‌ماندهٔ دارایی بیشتر است. باقی‌مانده: ${left} ؋. اگر پول نو می‌آورد، گزینهٔ نقد را بزنید.`
      )
  }

  const shareSum = (await listPartners()).reduce((s, p) => s + (p.share ?? 0), 0)
  if (shareSum + input.share >= 100) throw new Error('مجموع فیصدی شرکا باید کمتر از ۱۰۰٪ بماند تا سهمی برای مالک بماند')

  const id = (await db.suppliers.add({ name, balance: 0, kind: 'partner', capital, share: input.share })) as number
  if (input.bringsCash) await recordCapitalCash(name, capital)
  return id
}

/** اصلاح سرمایهٔ یک شریک — با همان محافظ */
export async function setPartnerCapital(id: number, capital: number): Promise<void> {
  const amount = afn(capital)
  if (amount < 0) throw new Error('سرمایه منفی نمی‌شود')
  const p = await db.suppliers.get(id)
  if (!p || p.kind !== 'partner') throw new Error('شریک یافت نشد')
  const others = (await listPartners()).filter((x) => x.id !== id).reduce((s, x) => s + (x.capital ?? 0), 0)
  const assets = (await netWorth()).assets
  if (amount + others > assets)
    throw new Error(`مجموع سرمایه‌ها از دارایی خالص (${assets} ؋) بیشتر می‌شود`)
  await db.suppliers.update(id, { capital: amount })
}

/** برداشتن یک شریک از فهرست */
export async function removePartner(id: number): Promise<void> {
  await db.suppliers.update(id, { deleted: true })
}

/**
 * شروع سال مالی: سرمایهٔ مالک خودکار حساب می‌شود تا مفاد روز اول صفر شود.
 * فیصدی مالک هم باقی‌ماندهٔ فیصدی شرکاست، پس مجموع همیشه دقیقاً ۱۰۰٪ است.
 */
export async function startYear(ownerName: string): Promise<{ capital: number; share: number }> {
  const name = ownerName.trim()
  if (!name) throw new Error('نام خود را بنویسید')

  const [n, all] = await Promise.all([netWorth(), listPartners()])
  const others = all.filter((p) => p.name !== name)
  const othersCapital = others.reduce((s, p) => s + (p.capital ?? 0), 0)
  const othersShare = others.reduce((s, p) => s + (p.share ?? 0), 0)

  const capital = afn(n.assets - othersCapital)
  const share = 100 - othersShare
  if (capital < 0) throw new Error('سرمایهٔ شما منفی می‌شود — اعداد گدام و قرض‌ها را دوباره ببینید')
  if (share <= 0) throw new Error('مجموع فیصدی شرکا ۱۰۰٪ یا بیشتر شده — سهمی برای شما نمی‌ماند')

  await db.transaction('rw', db.suppliers, db.settings, async () => {
    const existing = all.find((p) => p.name === name)
    if (existing) await db.suppliers.update(existing.id!, { capital, share, kind: 'partner' })
    else await db.suppliers.add({ name, balance: 0, kind: 'partner', capital, share })
    await db.settings.put({ key: PARTNERSHIP_START, value: Date.now() })
  })

  return { capital, share }
}

export type SettleChoice = 'take' | 'reinvest' | 'exit'

export interface SettleInput {
  /** برای هر شریک: فایده را می‌گیرد، دوباره سرمایه می‌کند، یا خارج می‌شود */
  choices: Record<number, SettleChoice>
  /** پرداخت‌ها از صندوق ثبت شود */
  payCash: boolean
  /** مفاد/نقص خالص سال و برداشت هر شریک — از همان صفحه می‌آید */
  yearProfit: number
  withdrawnBy: (name: string) => number
}

export interface SettleResult {
  paid: { name: string; amount: number }[]
  exited: string[]
}

/**
 * بستن سال شراکت — همه‌چیز در یک transaction.
 * اگر وسط کار خطایی بدهد (مثلاً پول صندوق کافی نیست)، هیچ‌چیز نوشته نمی‌شود و
 * سال باز می‌ماند؛ نه اینکه نصف شرکا تصفیه شده باشند و نصف دیگر نه.
 */
export async function settleYear(input: SettleInput): Promise<SettleResult> {
  const partners = await listPartners()
  const result: SettleResult = { paid: [], exited: [] }

  // پرداخت‌ها سند نقدی می‌سازند و ممکن است به خاطر کمبود پول رد شوند —
  // پس اول همه را حساب می‌کنیم تا نیمه‌کاره نماند
  const plan = partners.map((p) => {
    const share = Math.round((input.yearProfit * (p.share ?? 0)) / 100)
    const pay = share - input.withdrawnBy(p.name)
    return { p, pay, choice: input.choices[p.id!] ?? ('take' as SettleChoice) }
  })

  for (const { p, pay, choice } of plan) {
    if (choice === 'exit') {
      const total = (p.capital ?? 0) + pay
      if (input.payCash && total > 0) {
        await addPartnerWithdrawal(p.name, total, 'تصفیهٔ خروج از شراکت')
        result.paid.push({ name: p.name, amount: total })
      }
      result.exited.push(p.name)
    } else if (choice === 'take' && pay > 0 && input.payCash) {
      await addPartnerWithdrawal(p.name, pay, 'سهم فایدهٔ سال')
      result.paid.push({ name: p.name, amount: pay })
    }
  }

  // نوشتن سرمایه‌ها و تاریخ سال نو — اتمی
  await db.transaction('rw', db.suppliers, db.settings, async () => {
    for (const { p, pay, choice } of plan) {
      if (choice === 'exit') await db.suppliers.update(p.id!, { deleted: true })
      else if (choice === 'reinvest') await db.suppliers.update(p.id!, { capital: Math.max(0, (p.capital ?? 0) + pay) })
      // «فایده را می‌گیرد» با نقص: نقص از سرمایه کم می‌شود
      else if (pay < 0) await db.suppliers.update(p.id!, { capital: Math.max(0, (p.capital ?? 0) + pay) })
    }
    await db.settings.put({ key: PARTNERSHIP_START, value: Date.now() + 1000 })
  })

  return result
}
