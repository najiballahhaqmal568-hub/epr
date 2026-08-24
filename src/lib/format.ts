// پول و تعداد همیشه بدون کسر نشان داده می‌شود — افغانی واحد خوردتر ندارد
const nf = new Intl.NumberFormat('fa-AF', { maximumFractionDigits: 0 })

export function fmtNum(n: number): string {
  return nf.format(n)
}

export function fmtMoney(n: number): string {
  return `${nf.format(n)} ؋`
}

/** نام ماه‌های هجری شمسی در افغانستان */
const AF_MONTHS = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت']

const faDigits = (s: string | number): string => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])

const persianParts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric'
})
const persianMonthLabel = new Intl.DateTimeFormat('fa-AF-u-ca-persian', {
  year: 'numeric',
  month: 'long'
})

export function jalaliDateParts(ts: number): { y: number; m: number; d: number } {
  const parts = persianParts.formatToParts(ts)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** یک روز تقویمی محلی جلو/عقب؛ برخلاف جمع میلی‌ثانیه در تغییر ساعت تابستانی نمی‌شکند. */
export function addCalendarDays(ts: number, amount: number): number {
  const date = new Date(ts)
  date.setDate(date.getDate() + amount)
  return date.setHours(0, 0, 0, 0)
}

/**
 * روزهای واقعی یک ماه هجری شمسی به شکل timestamp میلادیِ محلی.
 * ذخیرهٔ اسناد همچنان timestamp است؛ فقط مرز و خانه‌های تقویم از تقویم فارسی می‌آید.
 */
export function jalaliMonthWindow(
  now = Date.now(),
  monthOffset = 0
): { year: number; month: number; label: string; days: number[] } {
  const current = jalaliDateParts(now)
  const absoluteMonth = current.y * 12 + current.m - 1 + monthOffset
  const year = Math.floor(absoluteMonth / 12)
  const month = ((absoluteMonth % 12) + 12) % 12 + 1
  // ۳۰٫۴۴ روز میانگین ماه خورشیدی است؛ بازهٔ ±۴۵ روز تمام ماه هدف را می‌پوشاند.
  const approximate = addCalendarDays(now, Math.round(monthOffset * 30.44))
  const days: number[] = []
  for (let delta = -45; delta <= 45; delta++) {
    const day = addCalendarDays(approximate, delta)
    const parts = jalaliDateParts(day)
    if (parts.y === year && parts.m === month) days.push(day)
  }
  days.sort((a, b) => a - b)
  if (days.length < 29 || jalaliDateParts(days[0]).d !== 1) {
    throw new Error('مرز ماه هجری شمسی پیدا نشد')
  }
  return { year, month, label: persianMonthLabel.format(days[0]), days }
}

/** ساعت ۱۲ ساعته */
function fmtTime12(ts: number): string {
  const d = new Date(ts)
  let h = d.getHours()
  const period = h < 12 ? 'ق.ظ' : 'ب.ظ'
  h = h % 12 || 12
  return `${faDigits(h)}:${faDigits(String(d.getMinutes()).padStart(2, '0'))} ${period}`
}

export function fmtDate(ts: number): string {
  return `${fmtDateShort(ts)}، ${fmtTime12(ts)}`
}

/** کلید و نام ماه هجری شمسی — برای راپور ماه‌به‌ماه */
export function jalaliMonth(ts: number): { key: string; label: string } {
  const { y, m } = jalaliDateParts(ts)
  return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${AF_MONTHS[m - 1] ?? ''} ${faDigits(y)}` }
}

export function fmtDateShort(ts: number): string {
  const { y, m, d } = jalaliDateParts(ts)
  return `${faDigits(d)} ${AF_MONTHS[m - 1] ?? ''} ${faDigits(y)}`
}

/** تبدیل ارقام فارسی/عربی ورودی کاربر به لاتین */
export function toLatinDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

export function parseNum(s: string): number {
  const n = parseFloat(toLatinDigits(s).replace(/[,،]/g, ''))
  return isNaN(n) ? 0 : n
}

/**
 * ترتیبِ صفحهٔ دفترِ فزیکی — «۱۲» و «۱۲/الف» و «۲» باید مثل ورق زدنِ دفتر بیایند.
 * پس اول عددِ صفحه می‌سنجد (نه حرف‌به‌حرف، وگرنه «۱۰» پیش از «۲» می‌آمد)،
 * و بی‌صفحه‌ها آخر می‌مانند.
 */
export function pageOrder(page?: string): { num: number; rest: string } {
  const s = toLatinDigits((page ?? '').trim())
  const m = s.match(/\d+/)
  return { num: m ? parseInt(m[0], 10) : Number.MAX_SAFE_INTEGER, rest: s }
}

/**
 * صفحه‌های دفترِ یک خانواده — اعضای یک خانواده گاهی هر کدام صفحهٔ خود را دارند،
 * گاهی همه در یک صفحه‌اند و گاهی بعضی هیچ صفحه‌ای ندارند.
 * پس هم صفحه‌های موجود را می‌گوید و هم اینکه چند نفر هنوز بی‌صفحه‌اند.
 */
export function familyPages(members: { bookPage?: string }[]): { pages: string[]; missing: number } {
  const pages: string[] = []
  let missing = 0
  for (const m of members) {
    const p = m.bookPage?.trim()
    if (!p) missing++
    else if (!pages.includes(p)) pages.push(p)
  }
  pages.sort((a, b) => {
    const x = pageOrder(a)
    const y = pageOrder(b)
    return x.num - y.num || x.rest.localeCompare(y.rest)
  })
  return { pages, missing }
}

export function startOfDay(ts = Date.now()): number {
  return new Date(ts).setHours(0, 0, 0, 0)
}

export function startOfMonth(ts = Date.now()): number {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function startOfYear(ts = Date.now()): number {
  return new Date(new Date(ts).getFullYear(), 0, 1).getTime()
}

/** برای input[type=date] — تاریخ میلادی به YYYY-MM-DD */
export function toDateInput(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function fromDateInput(s: string): number {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d, 12).getTime()
}

/** سن جنس در گدام — «۳ ماه» یا «۱۲ روز» */
export function ageLabel(since?: number, now = Date.now()): string {
  if (!since) return 'نامعلوم'
  const days = Math.floor((now - since) / 86400000)
  if (days < 1) return 'امروز'
  if (days < 45) return `${fmtNum(days)} روز`
  return `${fmtNum(Math.round(days / 30))} ماه`
}
