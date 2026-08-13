export interface DayFlow {
  day: number
  label: string
  inflow: number
  outflow: number
  /** موجودی در پایان آن روز */
  balance: number
}

/**
 * جریان پول روزانه: آمد و رفت هر روز با موجودی پایان روز.
 * روزهای بدون حرکت هم می‌آیند تا نمودار سوراخ نداشته باشد.
 */
export function dailyFlow(
  movements: { date: number; amount: number; box?: string }[],
  days: number,
  labelOf: (ts: number) => string,
  startOfDayFn: (ts: number) => number,
  now = Date.now()
): DayFlow[] {
  const today = startOfDayFn(now)
  const from = today - (days - 1) * 86400000

  // موجودی پیش از شروع دوره
  let running = movements.filter((m) => m.date < from).reduce((s, m) => s + m.amount, 0)

  const inMap = new Map<number, number>()
  const outMap = new Map<number, number>()
  for (const m of movements) {
    if (m.date < from) continue
    const d = startOfDayFn(m.date)
    if (m.amount >= 0) inMap.set(d, (inMap.get(d) ?? 0) + m.amount)
    else outMap.set(d, (outMap.get(d) ?? 0) - m.amount)
  }

  const rows: DayFlow[] = []
  for (let i = 0; i < days; i++) {
    const day = from + i * 86400000
    const inflow = inMap.get(day) ?? 0
    const outflow = outMap.get(day) ?? 0
    running += inflow - outflow
    rows.push({ day, label: labelOf(day), inflow, outflow, balance: running })
  }
  return rows
}
