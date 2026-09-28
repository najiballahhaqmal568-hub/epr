# Task 3 report — customer receipt UI, reports and end-to-end verification

Status: **DONE_WITH_CONCERNS**. Task 3 is implemented and locally verified on branch `feature/customer-goods-receipts` from base `7f6cf5612fd4d57d7baaf07e8af8a501b7174a85`. This is local work only: it has not been published, pushed, merged, or used against live Supabase/business data.

The status concern is limited to the existing production-build warnings and the already documented product boundary: there is no server-side active-client version fence or atomic multi-row cloud transaction. No Task 3 feature assertion remains failing.

## Outcome and implementation

- Added the owner-only **دریافت جنس بابت طلب** entry point in the live customer account. It fails closed while cached role is unavailable, gives a visible reason when current receivable is not positive, and uses a separate per-device compatibility acknowledgement.
- Added labeled, responsive receipt entry for warehouse or onward destination. It supports existing variants, manual goods, optional synthetic/local photo processing through the established `ProductPhotoPicker`, multiple lines, strict Dari numeric normalization, date/note, buyer creation through `CustomerModal`, onward sale prices, paid cash and box.
- The form keeps one stable request UUID, has one preview/confirmation step, locks during save, and prevents double submission. Corrections preserve the exact original timestamp and lock source, destination, buyer and box.
- Correction/cancellation performs `syncNow(true)` before preview. The displayed correction preview token is now submitted unchanged; if state changes after preview, core rejection resets confirmation and requires a new preview instead of silently accepting refreshed effects.
- Added receipt detail/audit UI for active, cancelled, incomplete and conflicted aggregates. It shows retained snapshots, destinations, linked-document identifiers, blocked reasons and correction/cancellation controls. Missing/non-owner profile, staff/viewer and read-only states have no mutation controls. Staff/viewer detail hides acquisition cost and profit.
- Routed receipt source payments and onward sales to dedicated ledger labels/details. Cancelled/corrected anchors remain separately accessible from customer audit without entering the live ledger.
- Added receipt-readiness discovery from payment anchors and adjustment/sale/cash children, including tombstones. Dashboard, Reports and SalesStats exclude incomplete/conflicting onward sales and show a warning; current and previous-period comparisons use the same filter.
- Excluded goods receipts from ordinary cash collections and added separate **تصفیهٔ طلب با جنس (غیرنقدی)** reporting. Onward sales remain normal commercial revenue/cost/profit; warehouse acquisition does not count as a sale, return or profit reversal.
- Updated buyer/customer/family ledger labels and commercial-line consumers. Sales history routes receipt children to dedicated detail. Invoice and image receipt printing use `commercialSaleLines` and do not expose acquisition cost/profit to the buyer.
- Added the deferred Task 1 correction-preview safeguard: selected legacy stock with a non-deterministic fallback cost basis now returns `allowed:false` and the Dari documented-cost-reset reason before submit.
- Added localhost-only request blocking to the full browser test runner. No cloud two-device runner was invoked.
- Added `docs/customer-goods-receipts.md` covering activation, operator flow, correction/cancellation, legacy cost restriction, reporting, backup and multi-device limits.

## Focused RED/GREEN and self-review

The resumed implementation already passed an initial 15-check real-form UI suite. Final self-review then found and fixed five bounded gaps:

1. correction submit silently obtained a fresh preview token after sync rather than requiring renewed confirmation;
2. missing cached profile was not fail-closed in receipt enable/detail mutation controls;
3. staff detail still displayed acquisition unit cost/value;
4. the disabled zero-receivable reason relied on a `title`, which is weak on touch/mobile;
5. optional manual-line photo input was unnecessarily restricted to warehouse destination.

Regression assertions were added before production fixes. Valid RED:

- `node tests/customer-goods-receipt-ui.mjs`: exit 1, Playwright timed out waiting for the visible zero-debt reason `برای دریافت جنس، طلب فعلی مشتری باید مثبت باشد.`

Final GREEN:

- `node tests/customer-goods-receipt-ui.mjs`: exit 0, `PASS 20 checks: compatibility, disabled reason, photo, warehouse, staff privacy, stale-preview rejection, correction, cancellation audit, onward, double-submit, backup replay, conflict, responsive and read-only UI`.
- The stale-preview scenario changes a master record after confirmation, asserts correction is rejected with `اطلاعات تغییر کرده است؛ پیش‌نمایش تازه بگیرید`, asserts source debt remains 8,000, then takes a fresh preview and completes the correction.

## Exact final verification evidence

All browser/build commands used process-local `NODE_OPTIONS=--dns-result-order=ipv4first` and `TEMP`/`TMP=D:/CodexTemp/customer-goods-receipts`, with scoped escalation for the exact worktree/browser/temp access. Receipt runners use disposable IndexedDB and block non-localhost requests.

- `node tests/customer-goods-receipts.mjs`: exit 0, `PASS 112 checks`. This includes warehouse/onward accounting, idempotence, audit chronology, generic-mutation guards, strict validation/rollback, dependencies, selected existing stock, legacy cost guard, correction preview `allowed:false` plus Dari reason, overflow and child-collision rollback.
- `node tests/customer-goods-receipt-ui.mjs`: exit 0, `PASS 20 checks` as listed above.
- `node tests/customer-goods-receipt-sync.mjs`: exit 0, `PASS: receipt UUID refs, replay/effects/conflicts and backup preflight`.
- `node tests/sync-safety.mjs`: exit 0 with `{ first:1001, second:1001, legacy:1001, interrupted:true, partial:1000, errorState:'error', resumed:1001, blocked:true, preserved:1001 }`, followed by `PASS: complete paginated pull; retry idempotence; legacy boundary recovery; interrupted-restore guard`.
- `npm test`: exit 0, `✅ همه درست — 1130 بررسی در 111 سناریو`.
- `npm run build`: exit 0; TypeScript passed, Vite `✓ 209 modules transformed`, `✓ built in 10.76s`, PWA generated `dist/sw.js` and `dist/workbox-9c191d2f.js` with 15 precache entries. The first build invocation returned no result because the permission reviewer timed out and is not counted; the unchanged retry produced this successful evidence.
- `git diff --check`: exit 0. Git emitted only the repository's standard Windows LF→CRLF notices.

## Files and scope

Production/reporting: `src/lib/customerGoodsReceiptOps.ts`, `src/lib/directTradeReports.ts`, `src/lib/ledger.ts`, `src/components/CustomerGoodsReceiptWarning.tsx`, `src/pages/Dashboard.tsx`, `src/pages/Reports.tsx`, `src/pages/Sales.tsx`, `src/pages/customers/CustomerDetail.tsx`, new customer receipt components, `src/pages/customers/FamilyDetail.tsx`, `src/pages/sales/InvoiceModal.tsx`, `src/pages/sales/Receipt.tsx`, `src/pages/sales/SalesStats.tsx`.

Tests/docs: `tests/customer-goods-receipts.mjs`, `tests/customer-goods-receipt-ui.mjs`, `tests/run.mjs`, `docs/customer-goods-receipts.md`, this report and `progress.md`.

The unrelated `qa-direct-trade-form.png`, `qa-sync-status-in-app.png` and `qa-sync-status-offline.png` remain untracked and untouched. `tests/two-device.mjs` and `tests/restore-two-device.mjs` were never run. No live Supabase access, publication, push or merge occurred.

## Remaining known concerns

- Vite retains the pre-existing mixed static/dynamic import warnings for `db.ts`/`sync.ts` and the >500 kB chunk-size warning. TypeScript/build output is otherwise successful.
- Compatibility acknowledgement is deliberately per-device and excluded from backup. Operators must update all active devices first, sync before mutation, and edit a receipt on one device at a time.
- Row-wise cloud sync is not an atomic server transaction. The implemented incomplete/conflict states prevent unconfirmed onward sales from entering totals and block edits, but they do not claim a server-side version fence.

## Review fix round 1 — 2026-09-26

Read-only review reported three Important findings. Source tracing verified all three before edits:

1. Sales history routed `goodsReceiptChild` rows to receipt detail, while only the ordinary sale detail exposed the existing receipt/invoice renderers. Receipt detail had no buyer print/share action.
2. `customerGoodsReceiptSettlements` accepted every undeleted customer payment with active receipt metadata; it did not require the aggregate UUID to be in the validated ready set used by report sales.
3. Owner role was checked when opening the form/detail, but dedicated transaction eligibility checked only read-only mode and compatibility acknowledgement. An already-open form could therefore submit after cached role became staff or disappeared.

TDD RED evidence, all using isolated localhost/Dexie with process-local IPv4-first and D temp:

- Authorization RED: `node tests/customer-goods-receipts.mjs`, exit 1: `staff role loss blocks submit: expected rejection`.
- Report RED after test-only reorder: same command, exit 1: `incomplete receipt excluded from noncash settlement: expected 0, got 700`.
- Print-route RED: `node tests/customer-goods-receipt-ui.mjs`, exit 1 after following the actual Sales history row: timed out waiting for `رسید خریدار`.

Fixes:

- Receipt detail now exposes **رسید خریدار** and **فاکتور خریدار** only when the aggregate is ready, onward, and has its linked sale. These actions reuse `ReceiptModal`/`InvoiceModal`, whose commercial-line output contains selling quantities/prices and omits acquisition cost/profit. Warehouse, cancelled, incomplete and conflicted receipts expose no buyer print action.
- `customerGoodsReceiptSettlements(payments, readyReceiptUuids)` now requires membership in the validated ready UUID set; Reports passes the same receipt review set used for confirmed onward sales.
- Dedicated create/correct/cancel transaction eligibility now reads `cachedProfile` from the included settings table and requires `role === 'owner'`. The open modal observes cached role, disables its fieldset/save while owner identity is loading or absent, and shows an explicit owner-access alert. Core rejection remains the race-safe boundary.

Final GREEN evidence:

- `node tests/customer-goods-receipts.mjs`: exit 0, `PASS 120 checks`. New checks cover incomplete/conflicted exclusion, ready inclusion, staff and unknown role rejection, owner-specific reason, and complete no-write state comparison.
- `node tests/customer-goods-receipt-ui.mjs`: exit 0, `PASS 29 checks: compatibility, disabled reason, photo, warehouse, staff privacy, stale-preview rejection, authorization loss, correction, cancellation audit, onward, history printing, double-submit, backup replay, conflict, responsive and read-only UI`. It traverses Sales → History → receipt detail → receipt image and invoice print iframe, asserts buyer output excludes acquisition/profit labels, asserts warehouse/conflict lack print actions, and covers owner→staff plus owner→unknown while the confirmed form is open with no-write checks.
- `node tests/customer-goods-receipt-sync.mjs`: exit 0, `PASS: receipt UUID refs, replay/effects/conflicts and backup preflight`; synthetic devices now explicitly seed owner profile under the new contract.
- `npm run build`: exit 0; TypeScript passed, Vite transformed 209 modules and built in 5.29s, PWA generated 15 precache entries. Existing mixed-import and >500 kB warnings remain.
- `npm test`: exit 0, `✅ همه درست — 1130 بررسی در 111 سناریو`.
- `git diff --check`: exit 0, with only standard LF→CRLF notices.

No live/cloud two-device script, Supabase/business data, publication, push or merge was used. The three unrelated QA PNGs remain untracked and untouched.
