const nf = new Intl.NumberFormat('fa-AF')

export function fmtNum(n: number): string {
  return nf.format(n)
}

export function fmtMoney(n: number): string {
  return `${nf.format(n)} ؋`
}

export function fmtDate(ts: number): string {
  return new Intl.DateTimeFormat('fa-AF', { dateStyle: 'medium', timeStyle: 'short' }).format(ts)
}

export function fmtDateShort(ts: number): string {
  return new Intl.DateTimeFormat('fa-AF', { dateStyle: 'medium' }).format(ts)
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
