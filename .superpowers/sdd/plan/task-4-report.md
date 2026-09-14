# Task 4 — checkout and held sales

Base: e9b7acb. Implemented bounded presentation changes in three production files: NewSaleModal.tsx, Sales.tsx, index.css. SaleShipping.tsx was fully inspected and deliberately unchanged. No accounting, schema, transport, role, durable-draft or direct-trade code changed. Controller's tasks/plan.md and docs/ios-redesign-verification.md remain untouched/uncommitted by this task.

## Outcome and action inventory

- Selection contains retail/wholesale switching, product/SKU search, tiles, size/color modal, whole/half cartons and counts, row quantities/removal, remaining-stock guards, individual prices and product-scoped common price. Compact total/hold/continue action leads to payment.
- Payment contains selected customer identity and total, cash/credit/mixed, actual received cash, remaining debt/overpayment, conditional customer search/create/remove/current debt, physical book page and optional promise date. Existing validation and formulas retained verbatim. A stock-change warning points back to selection.
- Discount has open/edit, non-destructive close and explicit remove. Freight's add/edit/remove and shop/customer/split/reimbursement/box/date/note/preview semantics remain. Prepared freight still posts only with the sale. Existing shipping correction reason/cancellation and read-only checks are unchanged.
- Back returns to selection without clearing any state. Mounted field groups retain commercial details; durable format is unchanged. Pending ref, disabled fieldset, beforeunload guard, save transaction, post-commit cleanup warnings, discard confirmation and held identity remain.
- Sales history/held/statistics and real owner-only Direct Sale remain outside active payment. Global navigation remains available under existing pending/draft protection. Held resume/replacement/delete confirmations are unchanged. Post-save confirmation keeps receipt/invoice/undo/next-sale; no automatic receipt.
- S01–S06 exercised via targeted suites below; S07 history/detail and receipt exercised by freight/direct/ordinary flow. S08 return/exchange controls unchanged, accounting covered by full suite, not freshly click-tested. D01–D04 actual Sales direct UI smoke and exact account/stock invariants passed; D05 unchanged, not re-run in this slice. No disabled direct correction/cancellation enabled.

## Verification

Commands run from this worktree with `CHROMIUM_PATH=C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe`:

| Command | Result / evidence |
| --- | --- |
| node tests/sale-flow-e2e.mjs | Actual App, disposable loopback-only browser: cash, mixed and full credit; missing-customer rejection; page/date; discount close/remove/back; held/resume; duplicate synchronous submit; explicit receipt image, no automatic dialog; reduced motion and 20px font at 320/390/768/1440. |
| node tests/shipping-ui.mjs | PASS: split creation, correction, cancellation, exact cash/debt, invalid reimbursement, prepared/held freight, atomic double-submit, history details, read-only guard. |
| node tests/sale-availability.mjs | PASS: selected/remaining, integer/max limits, half/full/stale/repeated cartons, incoming stock, search shortcuts and final stock/cash only on registration. |
| node tests/bulk-sale-price.mjs | PASS: product-ID scoped prices, per-row override, historical/catalog prices, discount and draft unchanged until posting. |
| node tests/sale-workspace.mjs | PASS: working recovery, empty/discard/commit clearing, held identity, corrupt/quota storage. |
| node tests/session-e2e.mjs | PASS: expired server session stays usable; Home/Sales preserves all draft commercial fields; local sale posts; re-login escape. Page errors now asserted. |
| node tests/direct-trade-ui.mjs | PASS: actual Sales direct entry, manual goods, Dari/invalid quantities, double-submit exact accounts, no warehouse effects, customer-safe receipt, later cash/sarraf payment and staff privacy. |
| npm test | PASS, 1130 checks across 111 scenarios. Run once at end. |
| npm run build | PASS, TypeScript + 199 Vite modules + PWA. Run once at end. Existing db/sync mixed-import and >500kB chunk warnings remain (main JS 1093.45kB). |
| git diff --check | PASS (only repository CRLF conversion notices). |

Ordinary flow literal outcomes: starting stock 20; cash sale 900 → stock19/cash900/debt0/one sale. Second sale 900−50 discount, paid300 → stock18/cash1200/debt550/two sales. Full credit900 → stock17/cash1200/debt1450/three sales. Holding never changed accounts. Freight suite: split500/share300/received100 with cash2000 → cash1600/debt200; correction →1500/500; cancellation →2000/0. Held wholesale shoe sale160 plus freight50 → cash2110/debt50/stock8.

## Screenshots and observed fixes

Viewed populated `.superpowers/sdd/plan/task-4-selection-390.png`, `task-4-selection-1440.png`, `task-4-payment-390.png`, `task-4-payment-1440.png`. Payment shots use 20px root font and reduced motion. No horizontal overflow on final 320/390/768/1440 run. Payment footer is in normal flow (no fixed bar hiding date/customer); mobile app navigation still uses its existing fixed area and page bottom clearance. Standard selection retains Task3 fixed compact bar. Shipping/direct/bulk/availability suites also generated their existing root qa-*.png evidence; not staged.

Initial red test correctly failed because selection still exposed payment input. Intermediate fixture failures: receipt is an image rather than DOM product text; two existing Close buttons required explicit first match; discount input lacked an accessible name (fixed). One intermediate 320px overflow assertion failed during footer/style iteration; final run with diagnostic geometry passed. No unresolved targeted test failures.

## Limits and review notes

- No live account, backup, production writes, publish, install or subagent used. Inspected UI suites abort external requests and use new browser profiles. The unchanged npm accounting harness runs local synthetic checks; it does not have the UI harness's explicit route-abort hook.
- UI skill routing CLI not used because task prohibits network/install; existing approved tokens/controls used. Test-driven and incremental skills informed the first failing user-visible stage check and bounded changes.
- Held delete/discard, invoice/undo, statistical filters and every ordinary return/exchange click path were source-preserved, not all re-exercised here. Direct enable acknowledgement/backup/sync replay were not re-run; direct implementation untouched.
- Fonts tested via existing root-size behavior at 20px, not by operating the Settings preference UI in this task. No real iOS keyboard/device testing or receipt sharing/printing external side effects.
- Independent controller review remains required. This report does not claim all redesign coverage groups are complete.
