# Direct Supplier-to-Customer Resale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record completed direct resale, payments and corrections without changing warehouse stock, costs or unrelated records.

**Architecture:** Mark linked existing Sale/Purchase records with a trade UUID and store non-stock commercial snapshots separately. Post settlements as explicit Payment events through shared effects, with one dual-party event for customer-to-supplier payments. Keep creation disabled until replay, report, correction and device-compatibility gates pass.

**Tech Stack:** React 18, TypeScript, Dexie 4, Vite 6, existing Supabase JSON transport, Playwright Core with isolated Chromium profiles; no new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-08-direct-sales-design.md` (owner approved 2026-09-08).

## Global Constraints

- "No APK."
- "No live data rewriting/reset or schema change is authorized by this design."
- "Older clients do not understand direct payments or commercial lines. Feature must remain disabled until all active business devices use the compatible release."
- "Fresh sync is required before corrections/cancellation."
- "Customer receipts never reveal purchase costs or margin."
- "Do not consume an unrelated account credit or allocate an unlinked old receipt automatically."
- "Closed/cancelled trade accepts no new allocations."
- "Never use production accounts, customer transactions or backups as test fixtures; no APK."
- "Release only after all gates pass."
- One customer, one supplier, completed delivery, whole-AFN amounts, positive integer quantities; no partial returns or pending shipments in this release.
- Preserve dirty `tests/two-device.mjs` and unrelated untracked QA files. Never run that test or `tests/restore-two-device.mjs`.
- Ordinary sales/purchases and warehouse pricing retain their existing behavior. Do not reuse `groupUuid`.
- Local transaction atomicity is not server atomicity. Never claim cross-device locking from a local preview or a recent sync timestamp.
- All new steps below are unexecuted. This document records a plan, not test evidence.

## Execution and source map

Work from repository root. Read `AGENTS.md`, `CONTEXT.md`, the spec, `docs/sync-safety-review.md`, and `docs/decisions/0001-wholesale-freight.md` before execution. Use `apply_patch`. Inspect status before every commit; stage only named files. On this workstation use `git -c safe.directory='C:/Users/D-E-L-L/Documents/ChatGPT/shoe app/epr' ...` when needed. No push until Task 10's release gate.

Existing integration points verified during planning:

| File | Responsibility / necessary change |
|---|---|
| `src/db.ts` | Optional typed metadata on existing documents; retain stock line types |
| `src/lib/effects.ts` | Both debt effects of one direct settlement; explicitly exclude direct stock |
| `src/lib/integrity.ts` | Supplier calculation currently filters out customer-primary payments; include dual-party payments |
| `src/lib/costing.ts` | Keep direct documents outside stock and historical-cost streams |
| `src/lib/ops.ts` | Guard generic mutations; reuse checked cash writing and freight, not ordinary stock operations |
| `src/lib/sync.ts` | Secondary supplier UUID mapping, deferred references, revision safety |
| `src/lib/ledger.ts` | Customer commercial descriptions and direct-event navigation |
| `src/lib/analytics.ts`, `src/components/AnalyticsCards.tsx`, `src/components/SoldListCard.tsx` | Commercial totals, lines, margins and non-stock identities |
| `src/pages/Reports.tsx`, `src/pages/Dashboard.tsx`, `src/pages/sales/SalesStats.tsx` | Period totals, payment-route distinction and incomplete-data warnings |
| `src/pages/sales/SaleHistory.tsx`, `src/pages/sales/Receipt.tsx`, `src/pages/Purchases.tsx` | Direct detail routing; no fake stock or misleading paid fields |
| `src/pages/customers/CustomerDetail.tsx`, `src/pages/purchases/SupplierDetailModal.tsx` | Both account ledgers and linked direct-detail navigation |
| `src/lib/ledgerSaleCancellation.ts` | Reject one-sided direct sale cancellation |

New focused modules:

- `src/lib/directTradeTypes.ts`: shared serializable data and operation input/output types; type-only imports of db types.
- `src/lib/directTradeMath.ts`: validation, totals, per-trade allocation and conflict calculation, no database writes.
- `src/lib/commercialLines.ts`: read-only line accessors for reports/display; never used in stock writes.
- `src/lib/directTradeState.ts`: load linked documents/events, completeness, stale-preview token, access gate.
- `src/lib/directTradeOps.ts`: atomic creation and later payment operations.
- `src/lib/directTradeCorrections.ts`: coordinated correction, payment reversal, cancellation/audit.
- `src/lib/financialPosting.ts`: narrowly extract checked cash writer from ops to avoid circular imports; no rule rewrite.
- `src/lib/directTradeReports.ts`: direct status and payment attribution for readers.
- `src/pages/sales/direct/DirectTradeForm.tsx`, `DirectTradeDetail.tsx`, `DirectPaymentForm.tsx`, `DirectTradeCorrection.tsx`: focused UI components.
- `tests/direct-trade.mjs`, `tests/direct-trade-checks.ts`, `tests/direct-trade-fixtures.ts`: local-only accounting suite.
- `tests/direct-trade-sync.mjs`, `tests/direct-trade-ui.mjs`: independent isolated replay and browser tests.

Ten tasks below form one dependent feature; intermediate commits are review points, not independent production releases.

## Task 1: Document contract and pure accounting tests

**Files:** Create `directTradeTypes.ts`, `directTradeMath.ts`, `commercialLines.ts` and the three local accounting test files above; modify `src/db.ts`.

**Interfaces:** Define these shared types (all consumers use these names):

```ts
export interface DirectLine {
  lineUuid: string
  productName: string
  size: string
  color: string
  qty: number
  unitCost: number
  unitPrice: number
}
export interface DirectTradeMeta {
  uuid: string
  revision: string
  previousRevision?: string
  counterpartUuid: string
  status: 'active' | 'cancelled'
}
export type DirectPaymentRoute = 'customerCash' | 'supplierPayment' | 'customerToSupplier'
export interface DirectPaymentRef {
  tradeUuid: string
  route: DirectPaymentRoute
  supplierId?: number
  supplierUuid?: string
  supplierName?: string
}
export interface DirectPaymentInput {
  eventUuid: string
  route: DirectPaymentRoute
  date: number
  amount: number
  box?: string
  sarrafId?: number
  sarrafAmount?: number
  note?: string
}
export interface DirectTotals { cost: number; sale: number; profit: number; pairs: number }
export interface DirectBalances {
  customerRemaining: number
  supplierRemaining: number
  customerCash: number
  supplierPaid: number
  customerToSupplier: number
  cashDelta: number
  overallocated: boolean
}
```

Add `directTrade?: DirectTradeMeta`, `directLines?: DirectLine[]` to Sale and Purchase; add `directPayment?: DirectPaymentRef` to Payment. Direct events must not pretend to be `via:'opening'` or goods. Their explicit route plus `cashDelta` is authoritative. Direct base records have `lines: []`, `paid: 0`; do not relax ordinary `variantId` requirements.

Produce `directTotals(lines: readonly DirectLine[]): DirectTotals`, `directBalances(totals: DirectTotals, payments: readonly Payment[]): DirectBalances`, and `validateDirectPayments(totals: DirectTotals, existing: readonly Payment[], next: readonly DirectPaymentInput[]): void`. These operate only on the supplied trade's events; reject mismatched route/party metadata at the state boundary.

Produce `commercialSaleLines(sale: Sale): ReadonlyArray<Omit<SaleLine, 'variantId'> & { variantId?: number; lineUuid?: string }>` and a purchase equivalent returning cost lines. Direct costs always come from snapshots.

- [ ] Create the isolated runner using `tests/sync-safety.mjs`'s localhost-only routing and cleanup pattern on port 5199. Serve a blank page instead of booting the app; dynamically import `/tests/direct-trade-checks.ts`. No production session, persistent browser profile, or remote request is allowed.

```js
await page.route('**/*', route => {
  const u = new URL(route.request().url())
  if (!['localhost', '127.0.0.1'].includes(u.hostname)) return route.abort()
  if (u.pathname === '/direct-trade-checks') return route.fulfill({
    contentType: 'text/html', body: '<html><body><div id="root"></div></body></html>'
  })
  return route.continue()
})
await page.goto('http://localhost:5199/direct-trade-checks')
await page.evaluate(async () => {
  const { cases } = await import('/tests/direct-trade-checks.ts')
  for (const test of cases) await test.run()
})
```

- [ ] Add test helpers `equal(actual: unknown, expected: unknown): void` (JSON structural equality throws with both values), `rejects(action: () => Promise<unknown>): Promise<void>` (fails if action resolves), and `line` fixture. Export `cases: Array<{ name: string; run: () => Promise<void> }>`; each database case later calls `seed()` independently.

```ts
export const line: DirectLine = {
  lineUuid: '10000000-0000-4000-8000-000000000001',
  productName: 'بوت آزمایشی', size: '40', color: 'سیاه',
  qty: 10, unitCost: 1000, unitPrice: 1200
}
cases.push({ name: 'commercial totals and invalid quantity', run: async () => {
  equal(directTotals([line]), { cost: 10000, sale: 12000, profit: 2000, pairs: 10 })
  await rejects(async () => directTotals([{ ...line, qty: 1.5 }]))
  await rejects(async () => directTotals([{ ...line, unitCost: Number.NaN }]))
}})
```

- [ ] Run `node tests/direct-trade.mjs`: first failure must be missing direct implementation, not network/browser setup. Implement types/accessors and pure validation: nonempty items/names, unique line UUIDs, safe integer positive qty, nonnegative whole costs/prices, safe multiplied totals, nonzero sale total; below-cost sale returns negative profit for explicit UI warning, not silent rejection.

```ts
const cost = lines.reduce((sum, l) => sum + l.qty * l.unitCost, 0)
const sale = lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0)
return { cost, sale, profit: sale - cost, pairs: lines.reduce((n, l) => n + l.qty, 0) }
```

- [ ] Add cases for empty list, duplicate line UUID, infinity, negative money, unsafe sums, zero/negative qty, permitted loss and unchanged ordinary accessors; rerun suite and `npm run build`.
- [ ] Commit only Task 1 files with `feat: define non-stock direct resale contract`.

## Task 2: Shared effects, replay integrity and stock exclusion

**Files:** Modify `src/lib/effects.ts`, `src/lib/integrity.ts`, `src/lib/costing.ts`, `tests/direct-trade-checks.ts`.

**Interfaces:** Existing `effectsOf`, `computeCustomerBalances`, `computeSupplierBalances`, `computeStock` signatures stay unchanged. A direct customer-to-supplier Payment produces two balance effects and zero stock/cash effects.

- [ ] Write failing exact-effect and integrity tests, with a well-formed direct reference and customer/supplier IDs deliberately different:

```ts
const payment: Payment = {
  date: 1, partyType: 'customer', partyId: 11, partyName: 'آزمایشی',
  amount: 7000, cashDelta: 0,
  directPayment: { tradeUuid: 'trade-test', route: 'customerToSupplier', supplierId: 22 }
}
equal(effectsOf('payments', payment), [
  { table: 'customers', id: 11, field: 'balance', delta: -7000 },
  { table: 'suppliers', id: 22, field: 'balance', delta: -7000 }
])
equal(computeSupplierBalances([], [payment], []).get(22), -7000)
```

- [ ] Run `node tests/direct-trade.mjs` and confirm the absent supplier effect/filter causes failure.
- [ ] Branch on explicit direct metadata before stock effects, and include dual-party payments in supplier integrity. Preserve legacy effects unchanged.

```ts
if (p.directPayment?.route === 'customerToSupplier') {
  out.push(owed(p.directPayment.supplierId, p.amount * -1))
}
// Supplier integrity input, not a new duplicate arithmetic definition:
payments.filter(p => p.partyType === 'supplier' || p.directPayment?.route === 'customerToSupplier')
```

- [ ] Explicitly skip direct documents in `computeCosts` and `historicalCostRevision`, including malformed records containing stock lines; reject malformed direct records before posting/import instead of treating them as physical goods. Test ordinary variants' qty/cost and old sale unitCost before/after adding direct documents, using existing costing fixtures/signatures from `tests/checks.ts`.
- [ ] Run direct suite, `npm test`, `npm run build`; commit `feat: share direct trade debt effects without warehouse movement`.

## Task 3: Read state, UUID replay and compatibility feasibility gate

**Files:** Create `src/lib/directTradeState.ts`, `tests/direct-trade-sync.mjs`; modify `src/lib/sync.ts`, test fixtures and `docs/sync-safety-review.md`.

**Interfaces:** `loadDirectTrade(tradeUuid: string): Promise<DirectTradeState>`; state contains `sale?: Sale`, `purchase?: Purchase`, `payments: Payment[]`, `totals: DirectTotals`, `balances: DirectBalances`, `status: 'ready'|'incomplete'|'conflict'|'cancelled'`, `token: string`, `issues: string[]`. Missing base documents use zero totals with a blocking status, never an actionable zero debt. Token is stable canonical serialization of revision, relevant documents, payment UUIDs/content, freight state and current affected party balances; never a timestamp alone.

`assertDirectWriteReady(state: DirectTradeState, expectedToken?: string): void` rejects readonly, disabled feature, incomplete/conflict, cancelled allocation, and stale token. Corrections additionally require a successfully awaited `syncNow(true)` before loading the preview and revalidation inside the write transaction; do not run network inside Dexie transactions.

`directFeatureEnabled(): Promise<boolean>` defaults false; local setting `directTrades.enabled` may be set only after the release checklist. A UI toggle alone is NOT proof that all devices are upgraded. Reader/effects support remains enabled regardless of the creation gate.

- [ ] Write red two-context tests using the fake transport in `tests/sync-safety.mjs` on port 5200. Seed the same UUID parties with different local numeric IDs; send direct records via actual `encodeRefs`/`applyRemoteRow` and later `syncNow`. Use literal JSON synthetic rows until operations exist.

```js
// In device B, after actual encode/decode and application:
assert.deepEqual(result.effects, { customer: 5000, supplier: 3000, cash: 0 })
assert.equal(result.sameNumericPartyIds, false)
assert.equal(result.afterReplay, result.beforeReplay)
assert.equal(result.missingSupplierRejected, true)
assert.equal(result.cursorAdvancedPastMissingSupplier, false)
assert.equal(result.partialTradeStatus, 'incomplete')
```

- [ ] Encode `directPayment.supplierId` to supplier UUID; decode only a resolved receiver ID. Missing/deleted required parties fail with a distinct recoverable error; `pullTable` must not advance its cursor for unapplied rows. Missing counterpart does NOT prevent storing a resolvable sale/purchase, or sales-first pull would deadlock; it makes the trade incomplete and blocks actions/report finality until both sides arrive.

```ts
const supplier = await db.suppliers.where('uuid').equals(ref.supplierUuid!).first()
if (!supplier || supplier.deleted) throw new Error('حساب فروشنده هنوز همگام نشده است؛ دوباره همگام کنید.')
rec.directPayment = { ...ref, supplierId: supplier.id }
```

- [ ] Pair validation requires same trade UUID/revision/status, reciprocal counterpart UUIDs, identical commercial snapshots/date and expected party references/totals. Distinct revision strings distinguish competing edits even when both increment from the same version. Retain evidence of mismatched revisions; do not fabricate a matched pair from half of each edit. Stable token includes active payments to detect later allocations after preview.
- [ ] Add repeated pull, reversed row order, missing counterpart, missing party, mismatched revision, concurrent distinct payments, cancellation versus later payment, and divergent correction ordering cases. Financial fields must converge when all compatible records arrive; unresolved conflicts must remain visible and block edits. Test mutations while readOnly changes and failed sync.
- [ ] Run `node tests/direct-trade-sync.mjs`, `node tests/sync-safety.mjs`, `node tests/sync-status.mjs`, and `npm test`.
- [ ] Document evidence and limits. **Stop publication** if old-client mutation, same-record last-writer behavior or unresolved-reference scheduling cannot meet the spec. Ask for narrowly scoped server/version enforcement authority if needed. Do not implement schema changes or silently relax the gate. Local implementation of remaining tasks may continue disabled, but must not be described as ready to use.
- [ ] Commit `feat: validate direct trade pairing and cross-device references` with only these files.

## Task 4: Atomic creation and explicit settlement events

**Files:** Create `src/lib/directTradeOps.ts`, `src/lib/financialPosting.ts`; modify `src/lib/ops.ts`, `tests/direct-trade-fixtures.ts`, `tests/direct-trade-checks.ts`. Add only optional `CashMovement.directPaymentUuid?: string` in `src/db.ts` for stable direct-event linkage; this is additive JSON metadata, not a database schema migration.

**Source-verified integration notes:** The cash writer depends on `afn`, `boxOf` and `SHOP_BOX`; move those helpers with it and preserve their public exports from `ops.ts` to avoid a runtime import cycle. Include `db.settings` and `db.syncState` in the parent write transaction because fresh state/eligibility reads use those stores. Keep these integration changes behavior-preserving for ordinary operations.

**Durable creation retry metadata:** Also allow optional `DirectTradeMeta.creationFingerprint?: string` in `directTradeTypes.ts`, stored identically on both newly created bases. Canonicalize the immutable creation request, including initial payments/freight and UUID party references (not numeric local IDs). Preserve it through later corrections. Comparing current live payments cannot distinguish an original retry after later settlements; local-only syncState storage is insufficient for backup/replay. Missing or mismatching fingerprints on an existing trade fail closed, never create another bundle. Tests cover retry after later events and equivalent requests with reordered object keys.

**Interfaces:**

```ts
export interface CreateDirectTradeInput {
  tradeUuid: string
  date: number
  customerId: number
  supplierId: number
  lines: DirectLine[]
  payments: DirectPaymentInput[]
  shipping?: SaleShippingInput
}
export interface DirectTradeResult { tradeUuid: string; saleId: number; purchaseId: number }
export function createDirectTrade(input: CreateDirectTradeInput): Promise<DirectTradeResult>
export function addDirectPayment(tradeUuid: string, input: DirectPaymentInput, expectedToken: string): Promise<number>
```

`SaleShippingInput` remains the existing export from `ops.ts`; import its type only. `financialPosting.ts` exports the existing `movement` implementation renamed `postCashMovement`, with identical input, insufficient-cash validation and readOnly behavior. `ops.ts` imports it under the old local name so ordinary callers do not change. Shared local effects are applied from `effectsOf`, not duplicated per route.

- [ ] Implement fixture `seed(): Promise<{ customerId:number; supplierId:number; variantId:number; sarrafId:number }>` using real `setOpeningStock`, `addOpeningDebt`, and a synthetic customer cash receipt. Clear tables only in this isolated test page. Seed stock 30 at cost 500, customer old debt 1000, supplier old debt 2000, sarraf balance -4000. Seed cash from an independent synthetic customer's receipt so the target customer's old debt remains exactly 1000. Export `snapshot(): Promise<unknown>` capturing all table rows and `warehouseSnapshot(): Promise<unknown>` capturing variants plus existing ordinary sale cost snapshots. Tests compare exact rows for unrelated records, not only aggregate totals.
- [ ] In isolated fixtures only, set `directTrades.enabled=true` in local settings and provide the fake authenticated transport used in Task 3 so actual `syncNow(true)` can complete for correction tests. Gate-rejection tests explicitly set it false. Do not add a production test bypass or reuse the owner's credentials. Test fixture setup must restore `accessFlags.readOnly=false` between cases.

```ts
await db.settings.put({ key: 'directTrades.enabled', value: true })
```
- [ ] Write red golden test; initial creation is allowed with no cash receipt if fully credit:

```ts
const f = await seed()
const before = await warehouseSnapshot()
const trade = await createDirectTrade({
  tradeUuid: newUuid(), date: Date.UTC(2026, 8, 8, 8),
  customerId: f.customerId, supplierId: f.supplierId, lines: [line],
  payments: [
    { eventUuid: newUuid(), route: 'customerCash', date: Date.UTC(2026, 8, 8, 8), amount: 3000 },
    { eventUuid: newUuid(), route: 'customerToSupplier', date: Date.UTC(2026, 8, 8, 8), amount: 7000 }
  ]
})
const state = await loadDirectTrade(trade.tradeUuid)
equal([state.balances.customerRemaining, state.balances.supplierRemaining], [2000, 3000])
equal(state.totals.profit, 2000)
equal(await warehouseSnapshot(), before)
```

- [ ] Run direct suite red; implement one `db.transaction('rw', [...SYNC_TABLES.map(t => db.table(t))], ...)` for both bases, initial payments and freight. Generate stable document IDs once from retained creation input, never once per render. Retry same trade UUID with identical content returns existing result; different content rejects. Each event UUID similarly rejects changed retry payload.
- [ ] Post customerCash as customer payment + positive cash; supplierPayment as supplier payment plus optional sarraf split; customerToSupplier as a single dual-effect payment with `cashDelta:0`. Do not call `addPayment` for the latter: current code forcibly makes every customer payment cash. Direct transaction validates all route sums jointly before writing and posts receipts before outflows in the same box when both occur together.

```ts
// Batch caps use goods balances, excluding independent freight and old debts.
if (R + D > S || P + D > C) throw new Error('پرداخت از باقی‌ماندهٔ همین معامله بیشتر است.')
// sarraf amount increases its balance: -4000 + 3000 = -1000 credit remains.
```

- [ ] Add later D=1000, then R=1000 and P=2000 tests; both goods balances zero, original profit unchanged. Test all-credit, all cash, all-direct up to minimum remaining, mixed cash/sarraf, sarraf credit first, payment over either cap, date invalid, deleted parties, supplier kind mismatch, unrelated old receipts, insufficient cash rollback, readonly and duplicate clicks/retries. Assert cash movements use stable UUID links for transport and no direct payment has a phantom cash movement.
- [ ] Run direct suite, `npm test`, `npm run build`; commit `feat: post direct resale and split settlements atomically`.

## Task 5: Guard generic actions and implement audited corrections

**Cancellation ordering boundary (Task3 review):** Business `payment.date` is user-editable and cannot prove whether an event was created before cancellation. Record a stable cancellation payment-set snapshot (with correction lineage) in the optional direct audit metadata and include it in pairing/tokens. Detect a concurrent new event absent from that snapshot even when backdated; retain its actual cash/effects and show conflict. Explicitly allow audited correction/cancellation of payments already present at cancellation, without treating legitimate replacement lineage as a new allocation. Test exact customer/supplier credits after both principal reversals, not just a `cancelled` label. This needs no server schema change, but does not remove the publication compatibility gate.

**Files:** Create `src/lib/directTradeCorrections.ts`; modify `directTradeTypes.ts`, `directTradeState.ts`, `src/lib/ops.ts`, `src/lib/ledgerSaleCancellation.ts`, direct tests.

**Interfaces:**

```ts
export interface CorrectDirectTradeInput {
  date: number; customerId: number; supplierId: number; lines: DirectLine[]; reason: string
}
export interface DirectMutationPreview {
  token: string; customerBefore: number; customerAfter: number
  supplierBefore: number; supplierAfter: number; cashDelta: number; profitDelta: number
}
export function previewDirectTradeCorrection(uuid: string, input: CorrectDirectTradeInput): Promise<DirectMutationPreview>
export function correctDirectTrade(uuid: string, input: CorrectDirectTradeInput, token: string): Promise<void>
export function previewDirectTradeCancellation(uuid: string): Promise<DirectMutationPreview>
export function cancelDirectTrade(uuid: string, reason: string, token: string): Promise<void>
export function correctDirectPayment(uuid: string, paymentUuid: string, input: DirectPaymentInput, reason: string, token: string): Promise<number>
export function cancelDirectPayment(uuid: string, paymentUuid: string, reason: string, token: string): Promise<void>
```

Add `directHistory` on bases as serializable prior snapshots with previous revision, reason/time, date, party UUID/name, lines and totals. Never store recursively nested prior histories. Payment audit uses existing `correctionOfUuid`, `correctedByUuid`, reason/time and `correctionPrevious` extended with direct route/party snapshot names/UUIDs. Preserve cash reversals and stable original/replacement links.

- [ ] Write red tests calling normal `deleteSale`, purchase corrections/cancel/receive/landing, customer/supplier returns, exchange, normal payment correction/delete and ledger shortcut against direct records; every call rejects and exact full snapshot stays unchanged. Guards must live at operation boundaries, not only hidden UI buttons.
- [ ] Add guard clauses to generic mutation paths. New direct operations reverse/apply shared effects directly inside their own checked transaction; never bypass guards with a public boolean flag.

```ts
if (sale.directTrade) throw new Error('این سند فروش مستقیم است؛ از جزئیات معامله اصلاح کنید.')
if (payment.directPayment) throw new Error('این پرداخت مربوط به فروش مستقیم است؛ از همان معامله اصلاح کنید.')
```

- [ ] Write and run failing correction/cancellation tests. Preserve R=3000 and D=7000 after cancellation of golden trade: customer overall becomes old debt minus 10000, supplier overall becomes old debt minus 7000, cash stays +3000 relative to baseline, goods profit becomes zero; stock/cost unchanged.

```ts
const beforeCash = await cashBalance()
const preview = await previewDirectTradeCancellation(trade.tradeUuid)
await cancelDirectTrade(trade.tradeUuid, 'معامله اشتباه ثبت شده', preview.token)
equal(await cashBalance(), beforeCash)
equal((await loadDirectTrade(trade.tradeUuid)).status, 'cancelled')
equal((await db.payments.toArray()).filter(p => p.directPayment?.tradeUuid === trade.tradeUuid && !p.deleted).length, 2)
```

- [ ] Implement matching revision changes for both bases, reverse old/apply new effects once, validate current allocations against corrected totals, forbid party change if any financial event/history/freight exists, preserve old snapshots. Reason required, fresh sync and stale token checked again before transaction commit. Keep cancelled documents accessible as audit records (soft deletion plus matching cancelled metadata); cancelled bases have no active profit/debt contribution.
- [ ] Implement payment replacement/tombstone and explicit cash reversal using existing checked rules; customerToSupplier reversal affects both parties and never cash. Disallow replacement route/amount that reintroduces allocation on a cancelled trade; allow cancelling erroneous retained payments there. Require freight to be independently reviewed/resolved before goods cancellation; no automatic carrier refund.
- [ ] Test correction after payments, decreasing total below allocation, changed party rejection, concurrent token invalidation, readOnly, failed sync, empty reason, retained audit after double invocation and payment correction after cancellation. Run direct suite, local sync suite, `npm test`, `npm run build`; commit `feat: audit direct trade corrections and block one-sided edits`.

## Task 6: Reports, ledgers and customer-safe receipts

**Files:** Create `src/lib/directTradeReports.ts`; modify `commercialLines.ts` and the existing report/history/ledger/receipt files in the source map, plus `src/components/SoldListCard.tsx` and `src/components/AnalyticsCards.tsx`.

**Interfaces:** `directReceiptModel(state: DirectTradeState)` returns only `{ date, customerName, lines: Array<{productName,size,color,qty,unitPrice}>, total, settled, remaining }`; no spread of a Sale or DirectLine into this customer-facing model. `directPeriodSummary(states: readonly DirectTradeState[], from: number, to: number)` returns `{ sales, purchases, profit, pairs, customerCash, customerDirect, supplierCash, incomplete }`; dates for base profit and payment cash are evaluated separately. Freight continues through existing expense/payment reporting, not subtracted twice.

- [ ] Write red pure tests for golden trade on Sep 8 with a later payment Sep 9. Sep 8 goods profit=2000; Sep 9 goods profit=0 and receipt cash only on payment date. Test day/month/year bounds using actual `periodBounds`; ordinary sales remain present once. A cancelled state's original totals remain readable for audit but contribute zero base totals/profit to period summaries; its retained payment events still contribute on their own dates.

```ts
const receipt = directReceiptModel(state)
equal(receipt.lines[0], { productName: line.productName, size:'40', color:'سیاه', qty:10, unitPrice:1200 })
equal('unitCost' in receipt.lines[0], false)
equal('profit' in receipt, false)
equal([receipt.total, receipt.settled, receipt.remaining], [12000, 10000, 2000])
```

- [ ] Run tests red; use commercial accessors for all display/item/profit loops, including trend/chart components. Keep stock-age/dead-stock loops on physical stock lines. Do not change `saleCreditAmount` into a payment-adjusted value: effects need original debt while UI per-trade remaining comes from state. Replace misleading direct receipt use of `sale.paid` with explicit settlement view.
- [ ] Include dual-party direct payments in supplier ledger queries even though primary type is customer; show each event once in each relevant account, zero cash explicitly labeled. Both ledgers show the same trade UUID navigation and distinguish total account debt from this trade's remaining goods amount. Unlinked old receipts remain account-level only.

```ts
const belongsToSupplier = p.partyType === 'supplier' && p.partyId === supplierId
  || p.directPayment?.route === 'customerToSupplier' && p.directPayment.supplierId === supplierId
```

- [ ] Keep reports explanatory: cash received and debt settled directly at supplier are distinct rows. Incomplete/conflict state produces visible warning and blocks final export/print of affected totals; do not silently exclude it and label the remainder complete. Staff views and customer receipt canvas/print must not leak cost/margin.
- [ ] Test cancelled and corrected trade totals, sarraf credit, net worth via existing account/cash/stock calculations, no duplicate freight expense, and report base-versus-payment date separation. Run direct suite, `npm test`, build; commit `feat: report direct resale across ledgers and receipts`.

## Task 7: Backup and full event replay regression

**Files:** Modify `src/lib/ops.ts` only in backup validation paths, `tests/direct-trade-sync.mjs`, `tests/direct-trade-checks.ts`, `docs/sync-safety-review.md`.

**Interfaces:** Existing `exportBackup` / `importBackup` signatures unchanged. Validate new direct data before the restore transaction clears any tables. Preserve UUID references, direct audit histories and all event routes. Reset the local creation-enable setting on restore; do not import device-upgrade confirmation from a backup.

- [ ] Write red isolated backup test, explicitly blocking remote transport, using both valid and malformed direct backups:

```ts
const saved = await exportBackup()
const before = await snapshot()
const malformed = JSON.parse(saved)
malformed.data.sales.find((s: Sale) => s.directTrade).directLines[0].qty = -1
await rejects(() => importBackup(JSON.stringify(malformed), 'merge'))
equal(await snapshot(), before)
```

- [ ] Implement preflight checks for types, totals, UUID/reference completeness and forbidden physical lines. Partial/conflicted valid snapshots must restore with visible blocked status rather than discard records; financially invalid values reject before mutation. Verify cloud identity preservation unchanged. Mock replacement transport locally for authoritative restore tests; never call live replacement RPC.
- [ ] Extend two-device suite to create via Task 4, replay every table with different IDs, then settle/correct/cancel via Task 5. Compare stocks/costs, party balances, cash, audits and report summaries, not just document counts.

```js
assert.deepEqual(deviceA.warehouse, deviceB.warehouse)
assert.deepEqual(deviceA.partyBalancesByUuid, deviceB.partyBalancesByUuid)
assert.deepEqual(deviceA.cashByBox, deviceB.cashByBox)
assert.deepEqual(deviceA.tradeSummary, deviceB.tradeSummary)
assert.equal(deviceB.integrityMismatchCount, 0)
```

- [ ] Inject interruption after each base/payment/cash row, repeated downloads, opposing correction orders, cancelled base followed by stale payment, and two distinct concurrent payments whose sum exceeds a cap. Require visible conflict without deleting real payment events; no mutation while conflict remains. Test old-client behavior on synthetic records from prefeature code in an isolated read-only test setup. If compatibility cannot be safely established, preserve the gate and report blocker.
- [ ] Run `node tests/direct-trade-sync.mjs`, `node tests/sync-safety.mjs`, `node tests/sync-status.mjs`, `node tests/direct-trade.mjs`, `npm test`; commit `test: cover direct trade restore and interrupted replay`.

## Task 8: Creation, payment and detail UI

**Files:** Create the four `src/pages/sales/direct/` components listed above; modify `src/pages/Sales.tsx`, both account detail pages, sales/purchase history routing, `src/pages/sales/SaleShipping.tsx`; create `tests/direct-trade-ui.mjs`.

**Interfaces:** `DirectTradeForm({onClose,onSaved}:{onClose:()=>void;onSaved:(tradeUuid:string)=>void})`; `DirectTradeDetail({tradeUuid,onClose}:{tradeUuid:string;onClose:()=>void})`; `DirectPaymentForm({state,onSaved}:{state:DirectTradeState;onSaved:()=>void})`; `DirectTradeCorrection({state,onSaved}:{state:DirectTradeState;onSaved:()=>void})`. Use existing Modal/Field/button/date/number components, readOnly permissions and RTL conventions; no new design system.

- [ ] Write red browser tests on port 5201 using synthetic accounts and actual rendered components. Accessible controls must include `فروش مستقیم`, `مشتری`, `فروشنده`, `قیمت خرید فی جوره`, `قیمت فروش فی جوره`, `دریافت از مشتری`, `پرداخت به فروشنده`, `مشتری مستقیم به فروشنده داده`, `ثبت معامله`. Numeric parsing supports Dari/Arabic numerals via existing helpers and rejects non-finite values before preview.

```js
await page.getByRole('button', {name:'فروش مستقیم', exact:true}).click()
await page.getByLabel('دریافت از مشتری', {exact:true}).fill('۳۰۰۰')
await page.getByLabel('مشتری مستقیم به فروشنده داده', {exact:true}).fill('۷۰۰۰')
await page.getByRole('button', {name:'ثبت معامله', exact:true}).click()
await page.getByText('باقی‌ماندهٔ این معامله').first().waitFor()
assert.deepEqual(await page.evaluate(() => window.directTestBalances()), [2000, 3000])
```

The test page defines `window.directTestBalances` by calling `loadDirectTrade` with the UUID returned by `onSaved`; this is test-page-only, never a production global.

- [ ] Implement compact creation form: parties/date, manual items, optional read-only catalog copy, common-price edit across selected sizes, collapsed payments, optional existing ShippingEditor. No stock availability limit for direct manual goods. Preview purchase/sale totals, profit or loss warning, both remainders, cash movement before submit. Busy ref and stable trade/event UUIDs prevent double submit and allow retry after uncertain response.
- [ ] Detail page loads live state; show delivery as direct/completed, payments and audit, ordinary account totals separately. Later mixed payments use Task 4. Correct/cancel uses Task 5 preview/token/reason, displays preserved payments and resulting credits. Show sync/incomplete/conflict status with actionable retry, not generic success. Direct-return controls explain unsupported real returns instead of offering stock return.
- [ ] Route history and both account links to the same trade detail. Retain existing normal-sale checkout behavior and navigation. On creation gate false, no active posting button; readers remain available for existing direct records.
- [ ] Test widths 320/390/768/1024/1440, keyboard/focus, mobile scroll, long product names, Dari inputs, below-cost confirmation, insufficient cash recovery, double click, cancelled trade, readonly role and no margin in customer receipt/export. Save isolated screenshots and inspect them visually.
- [ ] Run UI suite, `node tests/shipping-ui.mjs`, `node tests/ledger-sale-cancel.mjs`, `node tests/bulk-sale-price.mjs`, full direct suite and build; commit `feat: add direct resale workflow and linked account details`.

## Task 9: Integrated acceptance and regression review

**Files:** Extend direct test files with any missing coverage; update `tasks/todo.md` and `CONTEXT.md` with terminology and verified behavior only.

**Interfaces:** No new business behavior. Assemble acceptance evidence using existing test commands and recorded results.

- [ ] Compare every spec requirement to Tasks 1–8; add concrete missing assertions before fixes. Minimum nonnegotiable golden state:

```ts
equal([state.totals.cost, state.totals.sale, state.totals.profit], [10000,12000,2000])
equal([state.balances.customerRemaining, state.balances.supplierRemaining, state.balances.cashDelta], [2000,3000,3000])
equal(await warehouseSnapshot(), beforeWarehouse)
```

- [ ] Run and record exit codes of `npm test`, `npm run build`, `npm audit --audit-level=high`, direct accounting/replay/UI tests and existing sync/shipping/ledger/bulk tests. Inspect the actual scripts first; no live test accounts. No linter is configured, so do not claim lint passed.
- [ ] Review the diff for duplicate account/cash effects, references falling back to sender IDs, direct events in stock loops, mismatched report date semantics, audit loss, old receipts incorrectly allocated, uncontrolled generic edits, and double freight deduction. Resolve failures with test-first fixes.
- [ ] Record web-only build revision, test evidence, known sync limitations and screenshot paths. Check `git diff --check`. Commit scoped evidence/docs with `docs: document verified direct resale behavior and release gates`.

## Task 10: Controlled web release and owner handoff

**Files:** Update `docs/sync-safety-review.md`, `tasks/todo.md`; only release configuration already authorized by the repo workflow may be changed.

**Interfaces:** Keep mutation-enable separate from read/effects support. No server schema or access-policy mutation under this plan.

- [ ] Recheck all gates, including Task 3/7 compatibility evidence. If a gate fails, stop and tell owner exactly what remains. Never enable merely because unit tests/build pass.
- [ ] Publish only the reviewed complete compatible web build using the established repo deployment workflow, if release remains authorized. Do not include unrelated files. Verify actual deployment success/revision and HTTP asset availability; do not run production trades to test it.
- [ ] Ask owner to preserve a fresh backup and refresh every active phone/computer to the verified release. Do not ask them to reset or re-import data for an upgrade. Without evidence/owner confirmation that all active clients are compatible, feature stays disabled. Explain that manually confirmed refresh is not server-enforced version protection; if that protection is necessary, request authority before it is added.
- [ ] Enable creation only after the compatibility check and owner confirmation; verify existing data read-only. Provide a short Dari usage guide: direct sale, three payment routes, later payments, direct versus overall balance, corrections and cancellation retaining real payments.
- [ ] Record completion truthfully: implemented, tested locally, deployed, enabled are separate statuses. Rollback before any direct records may revert feature code. After records exist, retain readers/effects/guards and disable new mutations or forward-fix; never roll back to a client that cannot read those financial records.

## Plan self-review

- Spec coverage: contract/stock Tasks 1–2; state and mixed clients Task 3; payments/freight Task 4; audits/guards Task 5; ledgers/reports/receipt privacy Task 6; backups/concurrent replay Task 7; UX Task 8; regressions/release Tasks 9–10.
- Verified extra risk captured: supplier integrity currently filters out customer-primary payments (Task 2); addPayment currently forces customer cash (Task 4); direct receipt `.paid=0` cannot represent later settlement (Task 6).
- Reader support precedes activation; no intermediate commit is a safe standalone release. Compatibility remains an evidence gate, not an unverified guarantee.
- No implemented functionality or passing test is claimed by this plan. Execute each checkbox in order and record actual results.
