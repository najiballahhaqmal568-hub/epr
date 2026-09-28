# Customer Goods Receipts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Receive newly described goods against one customer's debt, into warehouse or onward sale, with auditable correction and safe cross-device readers.

**Architecture:** A goods Payment owns a UUID/revision manifest of costed Adjustments or a no-stock Sale and actual resale CashMovement. Dedicated operations validate and mutate the aggregate atomically, while existing effects/costing and shared commercial-line readers supply accounting. Sync/backup validate the same contract; UI exposes one dedicated workflow.

**Tech Stack:** React 18, TypeScript, Dexie, Vite, Playwright-core, existing Supabase JSON sync.

**Spec:** docs/superpowers/specs/2026-09-20-customer-goods-receipts.md

## Global Constraints

- Web/PWA only; no APK work, no live business data edits, no new database table or remote migration.
- Existing ordinary sales, purchases, direct trades, cash, debts and backups retain their meanings.
- One destination per receipt: warehouse or onward sale. Separate receipts can cover mixed destinations.
- Receipt quantity is a positive whole number; agreed unit cost is a positive whole AFN amount; line and document totals must be safe integers. Product/model, size and color are required, photo optional.
- Receipt value cannot exceed the source customer's current positive receivable. An onward buyer must be a different active customer. Onward cash is between zero and resale total; the rest becomes that buyer's receivable. No fictional supplier or purchase is created.
- All tests use isolated synthetic data and block external network. Never run tests/two-device.mjs or tests/restore-two-device.mjs.

### Task 1: Receipt contract, operations, guards and financial regression

**Files:** Create src/lib/customerGoodsReceiptTypes.ts, customerGoodsReceiptState.ts, customerGoodsReceiptOps.ts; modify src/db.ts, src/lib/ops.ts, src/lib/ledgerSaleCancellation.ts, src/lib/commercialLines.ts and shared guards as needed. Add tests/customer-goods-receipts.mjs. Extend effects/costing only if actual existing empty-physical-lines behavior needs it; do not refactor unrelated code.

**Interfaces:** Export CreateCustomerGoodsReceiptInput and CustomerGoodsReceiptState; export createCustomerGoodsReceipt(input), loadCustomerGoodsReceipt(receiptUuid), previewCustomerGoodsReceiptCorrection(receiptUuid,input), correctCustomerGoodsReceipt(receiptUuid,input,expectedToken,reason), previewCustomerGoodsReceiptCancellation(receiptUuid), cancelCustomerGoodsReceipt(receiptUuid,expectedToken,reason), customerGoodsReceiptFeatureEnabled(). Inputs include receiptUuid, date, customerId, destination warehouse/onward, note, lines of lineUuid/productName/size/color/qty/unitCost/photo?/variantId?; onward includes buyerId, per-line unitPrice and paid/box. State exposes payment, adjustments, sale, cash movements, status ready/incomplete/conflict/cancelled, token, issues, totals, featureEnabled, and write-block reasons. Use additive fields Payment.goodsReceipt, Adjustment/Sale/CashMovement.goodsReceiptChild and Sale.goodsReceiptLines. Exact member schema is defined in this task and consumed unchanged later.

- [ ] Write an isolated browser harness, local network only, that imports real Dexie/ops modules. Use TEMP/TMP D:/CodexTemp/customer-goods-receipts for browser profiles (C is nearly full). Record a failing run against missing exports.
- [ ] Implement typed manifest/revision validation and canonical fingerprint. Add a device-only setting goodsReceiptCompatibilityAcknowledged, false by default. Reload eligibility and role inside transaction; keep feature unreachable in UI until Task 3.
- [ ] Implement create: customer +10000 baseline, receipt 2*1000 -> debt8000, stock2, cash0. Existing active variant can be selected or absent item created at zero stock. Onward path adds no stock/masters/purchases; sale 2*1300, paid500 -> buyer2100, cash500, cost2000, profit600. All normal downstream report access uses commercialSaleLines().
- [ ] Implement previews with token and net effects; correction cancels original and creates a linked replacement transactionally, retaining audit. Use stable child UUIDs and fingerprints for exact retries. Block stale tokens, changed repeat requests, duplicate active successors, missing/deleted parties, read-only, non-integers, zero/negative costs, overflow, self-buyer, over-debt and invalid paid values without any partial write.
- [ ] Correction/cancellation warehouse dependency guard checks later affected-variant activity (sales/returns/purchases/adjustments), not just current quantity; reject consumed-then-replenished stock. Onward correction/cancellation must not silently alter later buyer collections; conservatively block when dependent subsequent buyer transactions exist. Keep dates/identities stable for safe comparison and explain restrictions.
- [ ] Generic add/delete/correct payment, ordinary sale add/delete/cancel, ordinary returns/exchange and sale shipping APIs reject receipt markers. Receipt operations apply effects directly rather than bypassing these public guards. Normal unrelated financial paths remain unchanged.
- [ ] Assert actual DB balances, stock, costs, cash movements, audit links, no supplier changes, no phantom income, complete rollback on failure and retry idempotency. Sample test assertions:
```js
assert.equal(source.balance, 8000)
assert.equal(await cashBalance(), 500)
assert.equal(buyer.balance, 2100)
assert.equal(commercialSaleLines(sale)[0].unitCost, 1000)
assert.equal(sale.lines.length, 0)
```
- [ ] Run focused tests and npm run build. Investigate existing npm test baseline timeout (current runner accidentally supplies timeout as waitForFunction arg rather than third parameter); fix only confirmed harness issue if necessary, rerun full npm test once. Report unrelated failures clearly. Commit explicit task files.

### Task 2: Receipt-aware synchronization and backup integrity

**Files:** src/lib/sync.ts, src/lib/ops.ts backup entrypoints, new src/lib/customerGoodsReceiptBackup.ts, src/lib/customerGoodsReceiptState.ts only contract integration; tests/customer-goods-receipt-sync.mjs, tests/customer-goods-receipts.mjs and docs/sync-safety-review.md.

**Interfaces:** Consume Task 1 types/manifest/state loader unchanged, plus existing encodeRefs/decodeRefs/applyRemoteRow, exportBackup/importBackup. Export validateCustomerGoodsReceiptBackup(data) for import preflight. Use receipt conflict keys in syncState consumed by loadCustomerGoodsReceipt.

- [ ] Read docs/sync-safety-review.md fully. Write failing isolated two-context replay tests modeled on tests/direct-trade-sync.mjs; inspect every runner before execution.
- [ ] Encode receipt nested master references as UUIDs and decode strictly. Missing/deleted references throw recoverable errors without writing; never trust foreign numeric IDs. Snapshots and manifest child UUIDs remain portable.
- [ ] Implement receipt revision predecessor protection, retained competing revision/successor evidence and blocked conflict state. Handle adjustment insertion/update/deletion with reverse/apply effects and rebuilt acquisition costs. Repeated rows apply once. Mixed revisions/partial manifest remain visible as incomplete/conflict and are never editable. Include existing fallback behavior for non-receipt adjustments.
- [ ] Before destructive import operations, validate active/cancelled aggregate shapes, totals, member existence/reciprocity/revision, IDs, links, distinct onward buyer and correction chains. Reject malformed/partial receipt data without clearing any existing data. Export/import preserves original cancelled audit. Exclude goodsReceiptCompatibilityAcknowledged from import/export.
- [ ] Test shuffled members, repeated replay, cancellation, correction, missing UUID reference, different local IDs, conflicting correction successors and delayed predecessor replay. Assertions compare actual stock/debts/cash/current costs and frozen sale cost/profit, not only metadata:
```js
assert.deepEqual(deviceBAccounting, deviceAAccounting)
assert.notEqual(incompleteState.status, 'ready')
assert.equal(afterRejectedImport, beforeRejectedImport)
```
- [ ] Run node tests/customer-goods-receipt-sync.mjs, node tests/customer-goods-receipts.mjs and node tests/sync-safety.mjs; npm run build. Document no server atomicity/version fence, update-all-device requirement and single-device receipt editing. Commit explicit files.

### Task 3: Customer UI, reports, audit and end-to-end verification

**Files:** src/pages/customers/CustomerDetail.tsx; new src/pages/customers/CustomerGoodsReceiptModal.tsx and CustomerGoodsReceiptDetail.tsx; src/lib/ledger.ts, src/lib/directTradeReports.ts; actual src/lib/analytics.ts, src/lib/sold.ts, src/pages/Reports.tsx, src/pages/Dashboard.tsx and sale-history/receipt readers as required by a targeted consumer audit. Add tests/customer-goods-receipt-ui.mjs and docs/customer-goods-receipts.md.

**Interfaces:** Consume Task 1 dedicated exported operations/state, Task 2 safe sync and restore contract. Never construct financial docs inside components. Use commercialSaleLines for all sale line displays/revenue/profit paths. Ledger source identifiers route receipt payment or linked sale to dedicated detail.

- [ ] Add action دریافت جنس بابت طلب in active customer detail, hide/disable appropriately for read-only. A dedicated compatibility gate explains update all devices first; store local acknowledgement only after explicit check. Existing direct-trade acknowledgement is separate.
- [ ] Form: source customer/current debt, warehouse/onward choice, current variant picker OR manual model/size/color/quantity/agreed cost/photo optional, line add/remove, date/note. Onward buyer select with creation via established customer UX if available, per-line selling price, actual paid amount and box. One receipt has one destination. Required fields have explicit labels and validation. Native Dari number normalization uses existing helpers. Busy shop UX: clear totals and single preview/confirm, locked while saving and stable request UUID on retry.
- [ ] Preview states source receivable before/after, stock increase OR no-stock destination, acquisition value, resale cash/buyer receivable/profit; never imply old owners' payables change. Detail exposes retained line snapshots, links, status/issues, correction/cancellation with reason and confirmation. Blocked dependency and incomplete/conflict states explain why action is unavailable; generic delete/edit/return/shipping controls cannot mutate members.
- [ ] Correct receipt ledger label is دریافت جنس بابت طلب with items and destination. Onward buyer ledger shows sale with commercial lines. Noncash receipts are excluded from ordinaryCustomerCollections and cash collection totals; display their value separately in relevant reports. Acquisition itself does not reduce sales/pairs/profit like a return. Onward resale appears in daily/monthly/yearly totals, sales history and receipt printing with proper cost/qty. No unrelated report redesign.
- [ ] Isolated UI tests submit real forms for warehouse and onward, assert financial state, actual rendered labels/remaining amounts, correction/cancellation audit, disabled/read-only/blocked cases, no duplicate double-submit and narrow/wide modal visibility. Photos use synthetic local data, not user files. Cover UI after portable replay/import as well as fresh data.
- [ ] Run focused UI/financial/sync tests; npm test and npm run build once after completed changes. Record results and any warnings. Document operator flow and restrictions. Commit explicit files; no publish or merge.

### Completion gate

Read-only per-task review checks compliance and correctness against its brief/diff. Resolve important findings before proceeding. Then one whole-branch review from 023681b, focused fix/re-review if needed. Preserve unrelated QA images and the redesign worktree. Final response distinguishes tested local implementation from live deployment.
