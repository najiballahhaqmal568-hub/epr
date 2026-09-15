# Current plan: approved iOS-inspired UI, preserve all features

Owner approved the visual samples on 2026-09-08 with the explicit requirement that no feature be omitted. Slices 1–5 (shared UI, navigation/home, sales selection/payment, history/documents, returns/exchanges) are implemented and independently reviewed. Coverage contract: `docs/ios-redesign-feature-coverage.md`. Direct sales first release is published and integrated; preserve its implemented scope from `docs/direct-sales-first-release.md`.

## UI delivery slices

Each slice must preserve existing operations and pass `npm test`, `npm run build`, plus the named inspected local-only browser suite. Read the complete component and enumerate conditional actions before implementation. Each step changes at most five production files; split further when necessary. No production fixtures, APK or migration.

1. **Shared visual primitives** — `src/components/ui.tsx`, `src/components/Icon.tsx`, existing stylesheet. Accept when approved colors/type/spacing have accessible focus, font scaling and reduced motion without altered business state. Verify local component screenshots at 320/390/768/1440px. Dependency: none.
2. **Navigation and dashboard** — `src/App.tsx`, `src/pages/More.tsx`, `src/pages/Dashboard.tsx`. Accept when all prior routes remain reachable, persistent truthful sync status works, and pending/held sale/back guards remain. Add local navigation coverage test and run back-button/session suites. Depends on 1.
3. **Sales product selection** — `NewSaleModal.tsx`, `StockSelectionSummary.tsx`, `QtyControl.tsx`, `BulkSalePrice.tsx`. Preserve retail/wholesale/cartons/half-cartons, prices and remaining-stock guards. Run sale-availability, bulk-sale-price, wizard-switch suites. Depends on 1–2.
4. **Checkout and held sales** — `NewSaleModal.tsx`, `Sales.tsx`, `SaleShipping.tsx`. Preserve every payment/draft/discount/promise/book-page/freight field when separating checkout into steps. Run sale-flow/workspace/shipping suites. Depends on 3.
5. **Sale history and corrections** — `SaleHistory.tsx`, `Sales.tsx`, receipt/invoice components (max five files). Retain history, share/download and correction/return/exchange destinations. Run history and ledger-sale-cancel tests; restyle return/exchange modals in a separate sub-slice if needed. Depends on 4.
6. **Inventory list and product management** — first `Inventory.tsx`, helpers, ProductModal and PhotoPicker; then separate stocktake/merge/carton/adjustment slice. Preserve I01–I05. Run photo/newproduct/stock/merge suites. Depends on 1–2.
7. **Purchases** — separate history/new-purchase slice and detail/correction/landing/returns slice, max five files each. Preserve P01–P05 and original account effects. Run accounting and relevant local purchase tests. Depends on 6.
8. **Accounts** — directory/management first (`Accounts.tsx`, `Customers.tsx`, CustomerModal), then customer/family/ledger, supplier/sarraf, and lender slices separately. Preserve A01–A09 including all corrections. Run customer-sort/debt-detail/bookpage/ledger tests. Depends on 1–2.
9. **Expenses and cash** — expense entry/detail/correction slice, checklist/calendar/category slice, creditor slice, cash ledger/transfer/reconcile slice. Preserve E01–E04 and C01–C03. Run expense-calendar/details and accounting suites. Depends on 8.
10. **Reports and financial management** — Reports/Analytics/SalesStats first, then Partners/YearStart separately. Preserve R01–R03, source calculations and staff privacy. Run sold-list/networth/partnership tests. Depends on 4,7–9.
11. **Account, settings and support** — small slices for sync/account, backup/danger, and PIN/font/reminders/integrity. Preserve U01–U06; no schema/server logic changes. Run sync-status/safety and session tests. Depends on 2.
12. **Full parity gate** — test every coverage ID, role, viewport and relevant synthetic business case; compare numeric/audit fixtures. Report unverified items explicitly. No deployment until this gate passes. Depends on all prior slices.

Checkpoints after slices 2, 5, 9 and 12: inspect screenshots, run full accounting/build, confirm coverage remains complete. The requested simpler UI must not remove supported actions. Changes to feature behavior require a separate decision.

## Historical plan: wholesale freight

Approved behavior: freight paid by the shop may be charged to the customer,
borne by the shop, or split. Immediate customer reimbursement reduces the
unpaid customer share. Keep freight separate from shoe prices and stock.

## Safe delivery checkpoints

1. Calculation contract (`src/lib/shipping.ts`, `tests/checks.ts`). Validate
   finite nonnegative money, positive freight, shares and reimbursement;
   round AFN consistently. Verify exact debt, expense and cash effects with
   failing-then-passing tests. No database/UI behavior changes in this slice.
2. Accounting operations and audit. Reuse existing sync-supported documents;
   atomic local creation/reversal, stable cross-device links, explicit
   correction/cancellation, and guards against deleting only half a record.
   Test cash, customer debt, expense/profit, unchanged stock, rollback and
   replay. Depends on checkpoint 1. Do not deploy before this is verified.
3. Optional wholesale-sale form and existing-sale details. Show total,
   customer/shop shares, cash received, box, date and note, with an effect
   preview. Preserve held drafts. Test an isolated browser, full suite and
   production build before publishing. Depends on checkpoint 2.

## Safety boundaries

- No live business data, production account or backup used for tests.
- No APK, backend schema migration or unrelated refactor.
- Returning shoes must not silently refund freight that was already paid.
- Do not expose partial functionality or claim deployment before verification.
- Existing `tests/two-device.mjs` modification and QA artifacts are unrelated.
