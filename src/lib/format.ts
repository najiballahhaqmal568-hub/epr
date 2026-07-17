const nf = new Intl.NumberFormat('fa-AF')

export function fmtNum(n: number): string {
  return nf.format(n)
}

export function fmtMoney(n: number): string {
  return `${nf.format(n)} ؋`
}

/** نام ماه‌های هجری شمسی در افغانستان */
const AF_MONTHS = ['حمل', 'ثور', 'جوزا', 'سرطان', 'اسد', 'سنبله', 'میزان', 'عقرب', 'قوس', 'جدی', 'دلو', 'حوت']

const faDigits = (s: string | number): string => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)])

function jalali(ts: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(ts)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  return { y: get('year'), m: get('month'), d: get('day') }
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

export function fmtDateShort(ts: number): string {
  const { y, m, d } = jalali(ts)
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
