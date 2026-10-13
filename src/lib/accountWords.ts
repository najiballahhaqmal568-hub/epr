/**
 * یک زبان برای همهٔ حساب‌ها — مشتری، تأمین‌کننده، صراف، قرض‌دهنده، طلبکار مصارف.
 *
 * پیش از این هر صفحه برای یک چیز نام دیگر داشت («قرض مشتری به دکان»، «قرض ما به او»، «طلب ما از او»،
 * «قرض مصرف»…) و علامت و رنگ هم برعکس می‌شد: بدهکاریِ مشتری به ما «+ سرخ» بود و بدهکاریِ ما به نبی «− سبز».
 * ریشه‌اش این بود که `balance` مثبت در مشتری یعنی «او به ما بدهکار است» و در همهٔ دیگران یعنی «ما به او».
 *
 * اینجا همه به یک عدد برمی‌گردند — `net`: مثبت = او به ما بدهکار است (باید بگیریم)، منفی = ما به او
 * بدهکاریم (باید بدهیم). هیچ عددی عوض نمی‌شود؛ فقط خواندنش یکی است. سبز همیشه «باید بگیریم»
 * و سرخ همیشه «باید بدهیم» است.
 */
import { fmtMoney } from './format'

export type Side = 'receive' | 'pay' | 'settled'

/** مشتری: balance مثبت = مشتری به ما بدهکار است. */
export const netOfCustomer = (balance: number): number => balance
/** تأمین‌کننده، صراف، قرض‌دهنده، طلبکار مصارف: balance مثبت = ما به او بدهکاریم. */
export const netOfCreditor = (balance: number): number => -balance

export function sideOf(net: number): Side {
  return net > 0.5 ? 'receive' : net < -0.5 ? 'pay' : 'settled'
}

/** برچسب کوتاه زیر عدد در فهرست‌ها. */
export const SIDE_LABEL: Record<Side, string> = { receive: 'باید بگیریم', pay: 'باید بدهیم', settled: 'تصفیه' }

/** سبز = باید بگیریم، سرخ = باید بدهیم، خاکستری = تصفیه. */
export const SIDE_TONE: Record<Side, string> = { receive: 'text-teal-700', pay: 'text-red-700', settled: 'text-slate-500' }

/** «باید ۵٬۰۰۰ ؋ بگیریم» / «باید ۱۲٬۲۰۰ ؋ بدهیم» / «حساب تصفیه است» */
export function standing(net: number): string {
  const side = sideOf(net)
  const amount = fmtMoney(Math.abs(net))
  return side === 'receive' ? `باید ${amount} بگیریم` : side === 'pay' ? `باید ${amount} بدهیم` : 'حساب تصفیه است'
}

/**
 * سرِ صفحهٔ هر حساب: یک جملهٔ کوچک و زیرش عدد بزرگ — «باید بدهیم» و «۱۲٬۲۰۰ ؋» با رنگ همان سمت.
 * `notes` برای سمتی است که معنای خاصی دارد (مثلاً مشتری که «باید بدهیم» دارد، پیش‌پرداخت داده است).
 */
export function headline(net: number, notes: Partial<Record<Side, string>> = {}): { side: Side; label: string; amount: string; tone: string } {
  const side = sideOf(net)
  const base = side === 'settled' ? 'حساب تصفیه است' : SIDE_LABEL[side]
  const note = notes[side]
  return { side, label: note ? `${base} — ${note}` : base, amount: fmtMoney(Math.abs(net)), tone: SIDE_TONE[side] }
}

/** بعد از یک سند در دفتر: «بعد از این: باید ۱۲٬۲۰۰ ؋ بدهیم». */
export const afterThis = (net: number): string => `بعد از این: ${standing(net)}`

/** مجموع چند حساب: هر کدام یک `net`؛ سمتِ گرفتنی‌ها و سمتِ دادنی‌ها جدا جمع می‌شود (با هم خنثی نمی‌شوند). */
export function totals(nets: number[]): { receive: number; pay: number } {
  let receive = 0
  let pay = 0
  for (const n of nets) {
    if (n > 0.5) receive += n
    else if (n < -0.5) pay += -n
  }
  return { receive, pay }
}

/** از دفتری که فقط «تغییر هر سند» را می‌داند، عدد بعد از هر سند را می‌سازد (قدیمی‌ترین اول). */
export function runningNet<T extends { change: number }>(rowsOldestFirst: T[]): (T & { after: number })[] {
  let net = 0
  return rowsOldestFirst.map((row) => {
    net += row.change
    return { ...row, after: net }
  })
}

/**
 * دفتری که فقط «تغییر هر سند» دارد: عدد بعد از هر سند را فقط وقتی می‌دهد که جمع همهٔ تغییرها دقیقاً
 * برابر عدد فعلی حساب شود. اگر برابر نشد (سندی در این دفتر نیامده)، حدس زده نمی‌شود: `after` نمی‌آید.
 * ورودی هر ترتیبی باشد، با تاریخ مرتب می‌شود؛ خروجی قدیمی‌ترین اول است.
 */
export function withAfter<T extends { date: number; change: number }>(rows: T[], currentNet: number): (T & { after?: number })[] {
  const sorted = rows.map((row, i) => ({ row, i })).sort((a, b) => a.row.date - b.row.date || a.i - b.i).map((x) => x.row)
  const out = runningNet(sorted)
  const end = out.length ? out[out.length - 1].after : 0
  const ok = Math.abs(end - currentNet) < 0.5
  return out.map((row) => (ok ? row : { ...row, after: undefined }))
}

/** وقتی عدد بعد از سند معلوم نیست: فقط جهتِ تغییر، بدون رنگِ خوب/بد. `change` از نگاه ما: مثبت = بیشتر باید بگیریم. */
export const changeWord = (change: number): string => (change > 0.5 ? 'باید بگیریم بیشتر شد' : change < -0.5 ? 'باید بگیریم کمتر شد' : '')
