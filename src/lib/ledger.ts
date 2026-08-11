/**
 * «این عدد از کجا آمد» — ساختن دفتر حساب با بیلانس در هر سطر.
 *
 * این فایل هیچ کاری با دیتابیس ندارد: سند می‌گیرد و سطر پس می‌دهد،
 * تا بشود دقیقاً همان را آزمایش کرد که کاربر در صفحه می‌بیند.
 */
import type { CashMovement, Payment, ReturnDoc, Sale } from '../db'
import { fmtNum, pageOrder } from './format'

export interface LedgerRow {
  key: string
  date: number
  label: string
  note?: string
  /** کدام بوت — «کوهستان ۴۲ سیاه ×۲» */
  items?: string
  /** صفحهٔ دفترِ فزیکی که این سند در آن نوشته شد */
  page?: string
  /** سندی که این سطر از آن آمده — برای حذف اشتباه */
  source?: { table: 'sales' | 'payments' | 'returns'; id: number }
  /** اثر این سند بر عدد نهایی */
  delta: number
  /** عدد بعد از این سند */
  balance: number
  /** جای پول (فقط برای دفتر پول) */
  box?: string
}

/** دفتر صندوق: هر حرکت با موجودی بعد از آن */
export function buildCashLedger(movements: CashMovement[], labelOf: (t: CashMovement['type']) => string): LedgerRow[] {
  const rows = [...movements].sort((a, b) => a.date - b.date || (a.id ?? 0) - (b.id ?? 0))
  let bal = 0
  return rows.map((m) => {
    bal += m.amount
    return {
      key: `m${m.id}`,
      date: m.date,
      label: labelOf(m.type),
      note: m.note,
      box: m.box?.trim() || 'دکان',
      delta: m.amount,
      balance: bal
    }
  })
}

/**
 * نامِ اجناس یک سند — «کوهستان ۴۲ سیاه ×۲، بامیان ۴۰ خاکی ×۱».
 * یک تعریف، تا دفتر شخص و دفتر خانواده هرگز فرق نکنند.
 */
export function itemsLabel(lines: { productName: string; size: string; color: string; qty: number }[]): string {
  return lines
    .map((l) => `${l.productName} ${l.size} ${l.color} ×${fmtNum(l.qty)}`.replace(/\s+/g, ' ').trim())
    .join('، ')
}

/**
 * دفتر حساب یک مشتری: قرض بعد از هر سند.
 * مثبت = مشتری به ما قرضدار است.
 */
export function buildCustomerLedger(sales: Sale[], payments: Payment[], returns: ReturnDoc[]): LedgerRow[] {
  type Ev = LedgerRow extends never ? never : Omit<LedgerRow, 'balance'>
  const events: Ev[] = []

  for (const s of sales) {
    const credit = s.total - s.paid
    if (credit === 0) continue // فروش نقدی بر قرض اثر ندارد
    events.push({
      key: `s${s.id}`,
      date: s.date,
      label: credit > 0 ? 'فروش قرضی' : 'پرداخت اضافی در فروش',
      note: `فاکتور ${fmtNum(s.total)} — نقد ${fmtNum(s.paid)}`,
      items: itemsLabel(s.lines),
      page: s.bookPage?.trim() || undefined,
      source: { table: 'sales', id: s.id! },
      delta: credit
    })
  }

  for (const p of payments) {
    // مبلغ منفی = قرض قبلی یا کسر صندوق که به حساب شخص رفته: قرض را بالا می‌برد
    events.push({
      key: `p${p.id}`,
      date: p.date,
      label: p.amount < 0 ? (p.note?.trim() || 'قرض قبلی') : 'دریافت پول',
      note: p.amount < 0 ? undefined : p.note,
      page: p.bookPage?.trim() || undefined,
      source: { table: 'payments', id: p.id! },
      // دریافت پول قرض را کم می‌کند، قرض قبلی (مبلغ منفی) آن را زیاد
      delta: -p.amount
    })
  }

  for (const r of returns) {
    if (r.settlement !== 'reduceDebt' || r.amount <= 0) continue
    events.push({
      key: `r${r.id}`,
      date: r.date,
      label: 'مرجوعی — کم شدن از قرض',
      note: r.reason,
      items: itemsLabel(r.lines),
      // مرجوعی صفحهٔ خودش را ندارد — به همان صفحه‌ای می‌نشیند که فروشش نوشته شده بود
      page: sales.find((s) => s.id === r.refId)?.bookPage?.trim() || undefined,
      source: { table: 'returns', id: r.id! },
      delta: -r.amount
    })
  }

  events.sort((a, b) => a.date - b.date || a.key.localeCompare(b.key))
  let bal = 0
  return events.map((e) => {
    bal += e.delta
    return { ...e, balance: bal }
  })
}

export interface LenderAccountSummary {
  openingLoan: number
  cashReceived: number
  directSupplier: number
  cashRepaid: number
  cashLoaned: number
  goodsSettlement: number
  goodsCredit: number
  previousCashRepaid: number
  previousCashLoaned: number
  previousGoodsSettlement: number
  previousGoodsCredit: number
  net: number
}

/** جمع دسته‌ها جدا می‌ماند؛ net همان عدد نهایی حساب قرض‌دهنده است. */
export function summarizeLenderAccount(payments: Payment[], lenderId: number): LenderAccountSummary {
  const out: LenderAccountSummary = {
    openingLoan: 0,
    cashReceived: 0,
    directSupplier: 0,
    cashRepaid: 0,
    cashLoaned: 0,
    goodsSettlement: 0,
    goodsCredit: 0,
    previousCashRepaid: 0,
    previousCashLoaned: 0,
    previousGoodsSettlement: 0,
    previousGoodsCredit: 0,
    net: 0
  }
  for (const p of payments) {
    if (p.deleted || p.partyType !== 'supplier') continue
    if (p.partyId === lenderId) {
      if (p.amount < 0) {
        if (p.via === 'opening') out.openingLoan += -p.amount
        else out.cashReceived += -p.amount
      } else if (p.lenderOpening && p.lenderAction === 'cashRepayment') out.previousCashRepaid += p.amount
      else if (p.lenderOpening && p.lenderAction === 'cashLoan') out.previousCashLoaned += p.amount
      else if (p.lenderOpening && p.lenderAction === 'goodsSettlement') out.previousGoodsSettlement += p.amount
      else if (p.lenderOpening && p.lenderAction === 'goodsCredit') out.previousGoodsCredit += p.amount
      else if (p.lenderAction === 'cashLoan') out.cashLoaned += p.amount
      else if (p.lenderAction === 'goodsSettlement') out.goodsSettlement += p.amount
      else if (p.lenderAction === 'goodsCredit') out.goodsCredit += p.amount
      else out.cashRepaid += p.amount
    } else if (p.via === 'lender' && p.lenderId === lenderId) {
      out.directSupplier += p.amount
    }
  }
  out.net =
    out.openingLoan +
    out.cashReceived +
    out.directSupplier -
    out.cashRepaid -
    out.cashLoaned -
    out.goodsSettlement -
    out.goodsCredit -
    out.previousCashRepaid -
    out.previousCashLoaned -
    out.previousGoodsSettlement -
    out.previousGoodsCredit
  return out
}

/** دفتر قرض‌دهنده: قرض‌های دریافتی و هر پول/کفشی که خودش برده است. */
export function buildLenderLedger(payments: Payment[], lenderId: number, sales: Sale[] = []): LedgerRow[] {
  const saleByGroup = new Map(sales.filter((s) => !s.deleted && s.groupUuid).map((s) => [s.groupUuid!, s]))
  const events = payments.flatMap((p): Omit<LedgerRow, 'balance'>[] => {
    if (p.deleted) return []
    if (p.partyType !== 'supplier') return []
    if (p.partyId === lenderId) {
      const baseLabel =
        p.amount < 0
          ? p.via === 'opening'
            ? 'قرض قبلی'
            : 'دریافت نقدی قرض'
          : p.lenderAction === 'cashLoan'
            ? 'قرض نقدی به قرض‌دهنده'
            : p.lenderAction === 'goodsSettlement'
              ? 'کفش بابت تسویه'
              : p.lenderAction === 'goodsCredit'
                ? 'کفش قرضی به قرض‌دهنده'
                : 'پرداخت نقدی قرض'
      const label = p.lenderOpening && p.amount > 0 ? `قبلی — ${baseLabel}` : baseLabel
      const linkedSale = p.groupUuid ? saleByGroup.get(p.groupUuid) : undefined
      return [{
        key: `p${p.id}`,
        date: p.date,
        label,
        note: p.note,
        items: linkedSale ? itemsLabel(linkedSale.lines) : p.goodsLines ? itemsLabel(p.goodsLines) : undefined,
        source: { table: 'payments', id: p.id! },
        delta: -p.amount
      }]
    }
    if (p.via === 'lender' && p.lenderId === lenderId) {
      return [{
        key: `p${p.id}`,
        date: p.date,
        label: `پرداخت مستقیم به ${p.partyName}`,
        note: p.note,
        source: { table: 'payments', id: p.id! },
        delta: p.amount
      }]
    }
    return []
  })
  events.sort((a, b) => a.date - b.date || a.key.localeCompare(b.key))
  let balance = 0
  return events.map((event) => {
    balance += event.delta
    return { ...event, balance }
  })
}

/**
 * قرضِ هر صفحهٔ دفتر — «صفحهٔ ۱۲ چقدر است».
 *
 * از روی همان سندهای دفتر حساب می‌شود، نه از عددی که جایی ذخیره شده باشد.
 * برای همین جمعِ صفحه‌ها همیشه دقیقاً برابر قرض کل همان مشتری است.
 * سندهایی که صفحه ندارند در یک قطیِ «بی‌صفحه» جمع می‌شوند و آخر می‌آیند.
 */
export function pageTotals(rows: LedgerRow[]): { page?: string; total: number }[] {
  const m = new Map<string, number>()
  for (const r of rows) m.set(r.page ?? '', (m.get(r.page ?? '') ?? 0) + r.delta)
  return [...m.entries()]
    .map(([page, total]) => ({ page: page || undefined, total }))
    .sort((a, b) => {
      if (!a.page) return 1
      if (!b.page) return -1
      const x = pageOrder(a.page)
      const y = pageOrder(b.page)
      return x.num - y.num || x.rest.localeCompare(y.rest)
    })
}
