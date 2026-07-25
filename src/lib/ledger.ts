/**
 * «این عدد از کجا آمد» — ساختن دفتر حساب با بیلانس در هر سطر.
 *
 * این فایل هیچ کاری با دیتابیس ندارد: سند می‌گیرد و سطر پس می‌دهد،
 * تا بشود دقیقاً همان را آزمایش کرد که کاربر در صفحه می‌بیند.
 */
import type { CashMovement, Payment, ReturnDoc, Sale } from '../db'
import { fmtNum } from './format'

export interface LedgerRow {
  key: string
  date: number
  label: string
  note?: string
  /** اثر این سند بر عدد نهایی */
  delta: number
  /** عدد بعد از این سند */
  balance: number
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
      delta: m.amount,
      balance: bal
    }
  })
}

/**
 * دفتر حساب یک مشتری: قرض بعد از هر سند.
 * مثبت = مشتری به ما قرضدار است.
 */
export function buildCustomerLedger(sales: Sale[], payments: Payment[], returns: ReturnDoc[]): LedgerRow[] {
  type Ev = { key: string; date: number; label: string; note?: string; delta: number }
  const events: Ev[] = []

  for (const s of sales) {
    const credit = s.total - s.paid
    if (credit === 0) continue // فروش نقدی بر قرض اثر ندارد
    events.push({
      key: `s${s.id}`,
      date: s.date,
      label: credit > 0 ? 'فروش قرضی' : 'پرداخت اضافی در فروش',
      note: `فاکتور ${fmtNum(s.total)} — نقد ${fmtNum(s.paid)}`,
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
