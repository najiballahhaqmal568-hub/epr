# MVP readers and financial display report

## Outcome

Direct-sale commercial lines now participate in sales, purchase, profit, pair, sold-item, search, and customer/supplier account displays without entering physical stock maps. Ready direct trades are included once; cancelled, incomplete, and conflicting base documents are excluded from confirmed commercial totals. Direct cash receipts, ordinary-sale cash, ordinary customer-debt receipts, and customer-to-supplier payments are labelled separately.

## Files

- `src/lib/directTradeReports.ts`: customer-safe receipt allowlist, date-separated period summary, ordinary customer collection helper.
- `src/components/DirectTradeWarning.tsx`: reusable live ready/incomplete/conflict review and truthful loading/error warning.
- `src/lib/analytics.ts`, `src/lib/sold.ts`, `src/lib/saleHistory.ts`, `src/lib/ledger.ts`: commercial lines, stable non-stock sold keys, search, and direct customer-ledger semantics.
- `src/components/SoldListCard.tsx`: optional direct variant IDs and stable row keys.
- `src/pages/Reports.tsx`, `src/pages/Dashboard.tsx`, `src/pages/sales/SalesStats.tsx`: ready-state gating, commercial totals/lines, warning, and explicit cash labels.
- `src/pages/purchases/SupplierDetailModal.tsx`: customer-primary D route shown once for its supplier with no cash or generic correction/delete action.
- `tests/direct-trade-report-checks.ts`, `tests/direct-trade.mjs`: focused golden, date split, allowlist, cash exclusion, analytics/sold/search/ledger integration checks.

## Evidence

- `node tests/direct-trade.mjs` — PASS: 24 direct-trade cases.
- `npm run build` — exit 0; TypeScript and Vite production build completed. Existing Vite dynamic/static import and large-chunk warnings remain.
- `git diff --check` — no whitespace errors (line-ending notices only).

## Remaining UI hook

Direct document detail/navigation remains intentionally unwired because `DirectTradeDetail` is the next bounded task. These reader pages expose no nonfunctional navigation or export button. The warning/state hook is reusable by that detail UI.

## Concerns

The warning review validates all local direct trades so purchase-only orphans are visible even when no sale exists. Until that async review completes, direct base documents are omitted from confirmed totals and a loading warning is shown; ordinary records remain available. No live data, server, publish, feature-flag enablement, or backup/operation code was touched by this task.
