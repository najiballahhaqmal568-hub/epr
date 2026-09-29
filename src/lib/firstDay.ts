/**
 * «روز اول» — the three things a new shop needs before its numbers mean anything. Each step is
 * checked from the data itself, so a shop that already runs never sees the guide.
 */
export interface FirstDayInput { cashMoves: number; products: number; productsWithPhoto: number; parties: number; sales: number }
export interface FirstDayStep { id: 'cash' | 'products' | 'debts'; done: boolean }

export function firstDaySteps(input: FirstDayInput): FirstDayStep[] {
  return [
    { id: 'cash', done: input.cashMoves > 0 },
    { id: 'products', done: input.products > 0 },
    // a shop with sales but no customers or suppliers is simply a cash shop: nothing left to write
    { id: 'debts', done: input.parties > 0 || input.sales > 0 }
  ]
}

export const firstDayDone = (steps: FirstDayStep[]) => steps.every((s) => s.done)
