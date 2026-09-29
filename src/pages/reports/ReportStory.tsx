import { useState, type CSSProperties } from 'react'
import type { Expense, ReturnDoc, Sale, Variant } from '../../db'
import { Modal } from '../../components/ui'
import { fmtDateShort, fmtMoney, fmtNum, jalaliMonth, startOfDay } from '../../lib/format'
import { confirmedSales } from '../../lib/profit'
import { KIND_NAME, kindFigures, per100, salesBuckets, waterfall, type KindFigures, type SaleKind, type WaterfallStep } from '../../lib/reportFigures'

/**
 * بالای راپور: «مفاد کردم؟»، «از کجا آمد؟»، پرچون و عمده کنار هم، و فروش در ستون‌ها.
 * همهٔ عددها از lib/reportFigures (روی همان profitSummary) می‌آید. حرکت فقط transform/opacity است،
 * عددها هیچ‌وقت نمی‌شمارند، و با «کم کردن حرکت» گوشی همه‌چیز ساکن است.
 */
export interface ReportStoryData {
  sales: Sale[]; returns: ReturnDoc[]; expenses: Expense[]
  prevSales: Sale[]; prevReturns: ReturnDoc[]; prevExpenses: Expense[]
  salesForLookup: Sale[]; variants: Variant[]
  readyTradeUuids: ReadonlySet<string>; readyReceiptUuids: ReadonlySet<string>
}

const EXPLAIN: Record<string, string> = {
  goods: 'هر جوړه به همان قیمتی که در رسید نوشته شد، پیش از تخفیف.',
  discount: 'تخفیفی که به مشتری‌ها دادید. از قیمت اجناس کم می‌شود.',
  sales: 'پولی که مشتری‌ها باید بدهند — نقد و قرض با هم. قرض هم فروش است، ولی هنوز به صندوق نیامده.',
  cost: 'پولی که خود شما برای همین جوړه‌ها داده بودید؛ همان قیمت خریدی که روز فروش در رسید ثبت شد.',
  salesProfit: 'مفادی که خود جنس داد، پیش از جنس‌های پس‌آمده و مصارف دکان.',
  returns: 'جوړه‌هایی که مشتری پس آورد؛ مفادی که از آن‌ها حساب شده بود برمی‌گردد.',
  expenses: 'مصارف تجارت دکان در همین مدت (نه خانه و شخصی):',
  net: 'همین است مفاد شما، بعد از همهٔ مصارف دکان.',
  gross: 'مفادی که فروش همین نوع داد، پیش از مصارف دکان. مصارف مال هر دو نوع است و جدا نمی‌شود.'
}

const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` })

export default function ReportStory({ data, from, to, periodKey, periodTitle, prevName, onKindChange }: {
  data: ReportStoryData; from: number; to: number; periodKey: string; periodTitle: string; prevName: string; onKindChange?: (kind: SaleKind) => void
}) {
  const [kind, setKind] = useState<SaleKind>('all')
  const [open, setOpen] = useState<WaterfallStep | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  const input = { sales: data.sales, returns: data.returns, expenses: data.expenses, variants: data.variants, salesForLookup: data.salesForLookup, readyTradeUuids: data.readyTradeUuids, readyReceiptUuids: data.readyReceiptUuids }
  const prevInput = { ...input, sales: data.prevSales, returns: data.prevReturns, expenses: data.prevExpenses }
  const cur = kindFigures(input, kind)
  const prev = kindFigures(prevInput, kind)
  const retail = kindFigures(input, 'retail')
  const wholesale = kindFigures(input, 'wholesale')
  const isAll = kind === 'all'
  const steps = waterfall(cur, kind)
  const sales = cur.summary.goodsValue - cur.summary.discounts
  const margin = per100(cur.profit, sales)
  const diff = cur.profit - prev.profit
  const hasPrev = data.prevSales.length > 0 || data.prevExpenses.length > 0

  const choose = (next: SaleKind) => { setKind(next); setPicked(null); onKindChange?.(next) }

  // waterfall geometry: every bar is drawn on one scale that also fits a loss (values below zero)
  const edges = steps.flatMap((s) => [s.from, s.to])
  const lo = Math.min(0, ...edges), hi = Math.max(1, ...edges)
  const at = (x: number) => ((x - lo) / (hi - lo)) * 100

  const confirmed = confirmedSales(data.sales, data.readyTradeUuids, data.readyReceiptUuids)
  const chartEnd = Math.min(to, Date.now())
  const buckets = confirmed.length ? salesBuckets(confirmed, from, chartEnd, fmtDateShort, (t) => jalaliMonth(t).label, startOfDay) : []
  const valueOf = (b: { retail: number; wholesale: number }) => (kind === 'retail' ? b.retail : kind === 'wholesale' ? b.wholesale : b.retail + b.wholesale)
  const top = Math.max(1, ...buckets.map(valueOf))
  const best = buckets.length ? buckets.reduce((bi, b, i) => (valueOf(b) > valueOf(buckets[bi]) ? i : bi), 0) : -1
  const sel = picked !== null && picked < buckets.length ? picked : best
  const selBucket = sel >= 0 ? buckets[sel] : undefined

  const col = (k: 'retail' | 'wholesale', f: KindFigures) => {
    const s = f.summary.goodsValue - f.summary.discounts
    return { k, name: KIND_NAME[k], sales: s, profit: f.summary.grossProfit, per100: per100(f.summary.grossProfit, s), pairs: f.pairs, perPair: f.pairs ? Math.round(f.summary.grossProfit / f.pairs) : undefined }
  }
  const cols = [col('retail', retail), col('wholesale', wholesale)]
  const bothSold = cols.every((c) => c.sales > 0)
  const shareRetail = bothSold ? Math.round((cols[0].sales / (cols[0].sales + cols[1].sales)) * 100) : 0
  const insight = (() => {
    const [r, w] = cols
    if (!bothSold || r.perPair === undefined || w.perPair === undefined || r.perPair <= 0 || w.perPair <= 0) return null
    const more = r.pairs >= w.pairs ? r : w
    const richer = r.perPair >= w.perPair ? r : w
    const ratio = Math.round((Math.max(r.perPair, w.perPair) / Math.min(r.perPair, w.perPair)) * 10) / 10
    // fmtNum drops decimals; «۱٫۳ برابر» must not become «۱ برابر»
    const [whole, tenth] = ratio.toFixed(1).split('.')
    const times = fmtNum(Number(whole)) + (tenth !== '0' ? '٫' + fmtNum(Number(tenth)) : '')
    return more === richer
      ? `${more.name} هم جوړهٔ بیشتر فروخت و هم هر جوړه‌اش حدود ${times} برابر مفاد داشت.`
      : `${more.name} جوړهٔ بیشتر فروخت؛ ولی هر جوړهٔ ${richer.name} حدود ${times} برابر مفاد داشت.`
  })()

  return (
    <div className="report-story">
      <div role="group" aria-label="نوع فروش" className="report-kinds">
        {(['all', 'retail', 'wholesale'] as SaleKind[]).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => choose(k)} data-kind={k}><span aria-hidden="true" />{KIND_NAME[k]}</button>
        ))}
      </div>

      <div key={`${kind}-${periodKey}`} className="report-story-body">
        <section aria-label="مفاد" className="report-hero">
          <p className="report-hero-period">{periodTitle}</p>
          <div className="report-hero-figure">
            <span>{isAll ? 'مفاد خالص' : `مفاد از جنس · ${KIND_NAME[kind]}`}</span>
            <strong className={cur.profit < 0 ? 'is-loss' : undefined}>{fmtMoney(cur.profit)}</strong>
          </div>
          {hasPrev && <p className="report-hero-delta" data-up={diff >= 0}>
            <span aria-hidden="true">{diff >= 0 ? '▲' : '▼'}</span> {fmtMoney(Math.abs(diff))} {diff >= 0 ? 'بیشتر' : 'کمتر'} از {prevName}
          </p>}
          {margin !== undefined && <p className="report-hero-line">
            {isAll ? `از هر ۱۰۰ افغانی فروش، ${fmtNum(margin)} افغانی مفاد خالص شما شد.` : `از هر ۱۰۰ افغانی فروش ${KIND_NAME[kind]}، ${fmtNum(margin)} افغانی مفاد از جنس ماند — پیش از مصارف دکان.`}
          </p>}
          {!isAll && cur.unknownReturns.count > 0 && <p className="report-hero-note">
            {fmtNum(cur.unknownReturns.count)} مرجوعی نوع فروشش معلوم نیست؛ فقط در «همه» حساب شده است.
          </p>}
        </section>

        {isAll && bothSold && <section aria-label="پرچون و عمده کنار هم" className="report-card">
          <div className="report-card-head"><h2>پرچون و عمده کنار هم</h2><span>لمس = دیدن جدا</span></div>
          <div aria-hidden="true" className="report-split">
            <span style={{ width: `${shareRetail}%` }} />
            <span style={{ width: `${100 - shareRetail}%` }} />
          </div>
          <div className="report-compare">
            {cols.map((c, i) => (
              <button key={c.k} type="button" data-kind={c.k} onClick={() => choose(c.k)} aria-label={`دیدن جدای ${c.name}`}>
                <b><span aria-hidden="true" />{c.name} <small>{fmtNum(i === 0 ? shareRetail : 100 - shareRetail)}٪ فروش</small></b>
                <span><small>فروش</small>{fmtMoney(c.sales)}</span>
                <span><small>مفاد از جنس</small><strong>{fmtMoney(c.profit)}</strong></span>
                <span className="report-compare-foot">
                  {c.per100 !== undefined && <>از هر ۱۰۰: {fmtNum(c.per100)} افغانی<br /></>}
                  {fmtNum(c.pairs)} جوړه{c.perPair !== undefined && <> · هر جوړه ~{fmtMoney(c.perPair)}</>}
                </span>
              </button>
            ))}
          </div>
          {insight && <p className="report-insight">{insight}</p>}
        </section>}

        <section aria-label="مفاد از کجا آمد" className="report-card">
          <div className="report-card-head"><h2>{isAll ? 'این مفاد از کجا آمد؟' : `مفاد ${KIND_NAME[kind]} از کجا آمد؟`}</h2><span>روی هر پله لمس کنید</span></div>
          {steps.map((s, i) => {
            const a = Math.min(s.from, s.to), b = Math.max(s.from, s.to)
            const origin = s.kind === 'cut' ? (s.from > s.to ? 'left' : 'right') : s.to >= 0 ? 'right' : 'left'
            const sign = s.kind === 'cut' ? '−' : ''
            return (
              <button key={s.key} type="button" className="report-step" data-step={s.kind} onClick={() => setOpen(s)} aria-label={`${s.label} ${sign}${fmtMoney(s.amount)} — توضیح`}>
                <span className="report-step-row">
                  <span>{s.kind === 'cut' ? '− ' : s.kind === 'base' ? '' : '= '}{s.label}</span>
                  <b>{sign}{fmtMoney(s.amount)}</b>
                </span>
                <span aria-hidden="true" className="report-step-track">
                  <span style={{ right: `${at(a)}%`, width: `${at(b) - at(a)}%`, transformOrigin: origin, ...delay(150 + i * 70) }} />
                </span>
              </button>
            )
          })}
          {!isAll && <p className="report-note">مصارف دکان (کرایه، معاش، برق…) مال هر دو است و اینجا کم نمی‌شود. برای مفاد خالص «همه» را ببینید.</p>}
        </section>

        {buckets.length > 0 && <section aria-label="فروش در ستون‌ها" className="report-card">
          <div className="report-card-head">
            <h2>فروش{isAll ? '' : ` · ${KIND_NAME[kind]}`}</h2>
            {isAll && <span className="report-legend"><i data-kind="retail" />پرچون <i data-kind="wholesale" />عمده</span>}
          </div>
          {selBucket && <div className="report-readout">
            <button type="button" aria-label="قبلی" disabled={sel <= 0} onClick={() => setPicked(Math.max(0, sel - 1))}>›</button>
            <p role="status"><span>{selBucket.name}{sel === best ? ' · بهترین' : ''}</span><strong>{fmtMoney(valueOf(selBucket))}</strong>
              {isAll && <small>پرچون {fmtMoney(selBucket.retail)} · عمده {fmtMoney(selBucket.wholesale)}</small>}</p>
            <button type="button" aria-label="بعدی" disabled={sel >= buckets.length - 1} onClick={() => setPicked(Math.min(buckets.length - 1, sel + 1))}>‹</button>
          </div>}
          {/* one big button: the column under the finger is picked; ‹ › above do the same for keyboards and screen readers */}
          <button type="button" className="report-chart" data-dense={buckets.length > 14} aria-label="نمودار فروش — برای دیدن عدد روی ستون لمس کنید"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPicked(Math.max(0, Math.min(buckets.length - 1, Math.floor(((r.right - e.clientX) / r.width) * buckets.length)))) }}>
            {buckets.map((b, i) => {
              const v = valueOf(b)
              return (
                <span key={b.name + i} aria-hidden="true" data-on={i === sel} style={delay(120 + i * Math.max(12, 360 / buckets.length))}>
                  <span style={{ height: `${Math.max(v > 0 ? 3 : 0, (v / top) * 100)}%` }}>
                    {isAll && <i style={{ height: v ? `${(b.wholesale / v) * 100}%` : 0 }} />}
                  </span>
                </span>
              )
            })}
          </button>
          <div aria-hidden="true" className="report-axis"><span>{buckets[0].label}</span><span>{buckets[buckets.length - 1].label}</span></div>
        </section>}
      </div>

      {open && <Modal title={open.label} onClose={() => setOpen(null)}>
        <p className="report-explain-amount" data-step={open.kind}>{open.kind === 'cut' ? '−' : ''}{fmtMoney(open.amount)}</p>
        <p className="report-explain-text">{EXPLAIN[open.key] ?? EXPLAIN.gross}</p>
        {open.key === 'expenses' && <div className="report-explain-list">
          {cur.summary.expenseCategories.map((c) => <p key={c.name}><span>{c.name}</span><b>{fmtMoney(c.amount)}</b></p>)}
          {cur.summary.expenseCategories.length === 0 && <p><span>در این مدت مصرفی ثبت نشده.</span></p>}
        </div>}
        {open.key === 'net' && margin !== undefined && <p className="report-explain-text">از هر ۱۰۰ افغانی فروش، {fmtNum(margin)} افغانی برای شما ماند.</p>}
        <button type="button" className="primary-button mt-3 w-full" onClick={() => setOpen(null)}>فهمیدم</button>
      </Modal>}
    </div>
  )
}
