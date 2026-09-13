import { db, type CashMovement } from '../db'

export const afn = (n: number): number => Math.round(n)
export const SHOP_BOX = 'دکان'
export const boxOf = (m: { box?: string }): string => m.box?.trim() || SHOP_BOX

export async function postCashMovement(m: Omit<CashMovement, 'id'>, opts?: { allowNegative?: boolean }): Promise<number> {
  m = { ...m, amount: afn(m.amount), box: boxOf(m) }
  if (m.amount === 0) return 0
  if (m.amount < 0 && !opts?.allowNegative) {
    const all = await db.cashMovements.filter(x => !x.deleted && boxOf(x) === m.box).toArray()
    const balance = all.reduce((sum, row) => sum + row.amount, 0)
    if (balance + m.amount < 0) {
      throw new Error(`پیسه در «${m.box}» کافی نیست! موجودی: ${new Intl.NumberFormat('fa-AF').format(balance)} ؋`)
    }
  }
  return db.cashMovements.add(m) as Promise<number>
}
