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
