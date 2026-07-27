import type { CashMovementType, ExpenseType } from '../../db'

export type ExpenseMode = ExpenseType | 'partner'

export const MOVE_LABELS: Record<CashMovementType, string> = {
  sale: 'فروش',
  purchase: 'خرید',
  expense: 'مصرف تجارت',
  homeExpense: 'مصرف خانه',
  personalExpense: 'مصرف شخصی',
  withdrawal: 'برداشت مالک',
  customerPayment: 'دریافت از مشتری',
  supplierPayment: 'پرداخت به تأمین‌کننده',
  refund: 'مرجوعی',
  openingSet: 'تصفیه صندوق',
  capitalIn: 'سرمایه‌گذاری شریک',
  landing: 'مصارف رسیدن جنس',
  loanIn: 'قرض گرفته‌شده',
  loanRepay: 'پرداخت قرض',
  transfer: 'انتقال بین جاهای پول'
}

export const TYPE_LABELS: Record<ExpenseType, string> = {
  business: 'تجارت',
  home: 'خانه',
  personal: 'شخصی',
  withdrawal: 'برداشت مالک'
}

export const TYPE_COLORS: Record<ExpenseType, string> = {
  business: 'text-red-600',
  home: 'text-amber-600',
  personal: 'text-purple-600',
  withdrawal: 'text-amber-700'
}
