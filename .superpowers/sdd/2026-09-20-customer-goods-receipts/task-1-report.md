# Task 1 report — customer goods receipts

Status: DONE_WITH_CONCERNS (core complete; sync/backup/UI intentionally deferred).
Base: 5048fe97e5d60576c9ae68e2cf263361e176a1e2
Branch: feature/customer-goods-receipts
Commit: 2deab7d149a9eb2c4756c9ab9729e9c767f61b8d

## Implemented

- Dedicated aggregate anchored by a customer goods Payment, zero cash delta, portable UUID manifest and revision.
- Warehouse acquisition uses positive costed Adjustments and existing effects/cost reconstruction. Absent masters start at zero stock. Active existing variants can be selected.
- Onward uses Sale.lines=[] and goodsReceiptLines; no supplier, purchase, stock, or product creation. Only actual paid cash is posted.
- Aggregate completeness/conflict validation, financial content and canonical creation fingerprint validation, stable deterministic child UUIDs, collision protection and repeat safety.
- Transactional eligibility/read-only checks, strict integers and safe financial totals, party validation, active customer debt limit, self-buyer/overpaid rejection, rollback after late financial failures.
- Correction/cancellation retain deleted original rows, child statuses, reason, timestamp, compact mutation token, and explicit successor/predecessor UUID links.
- Conservative inventory dependency and buyer-transaction guards, including replenished previously consumed stock. Backdated creation into existing variants is rejected when same/later inventory activity exists.
- Generic sale/payment add/delete/correction, ledger cancellation, return/exchange and shipping reject receipt-owned documents via existing shared guards. Generic adjustment creation also rejects child markers.
- commercialSaleLines() exposes onward commercial snapshots.

## Files changed

- src/db.ts
- src/lib/customerGoodsReceiptTypes.ts (new)
- src/lib/customerGoodsReceiptState.ts (new)
- src/lib/customerGoodsReceiptOps.ts (new)
- src/lib/commercialLines.ts
- src/lib/ops.ts
- src/lib/ledgerSaleCancellation.ts
- tests/customer-goods-receipts.mjs (new)

No effects/costing machinery changes were necessary. No UI, sync, backup, remote schema, production data, or unrelated QA image changes. This report is in the intentionally gitignored orchestration directory.

## Public interfaces for Tasks 2–3

Types are authoritative in customerGoodsReceiptTypes.ts.

CreateCustomerGoodsReceiptInput:

- receiptUuid, date, customerId, destination: 'warehouse' | 'onward', note?
- lines: {lineUuid, productName, size, color, qty, unitCost, photo?, variantId?, unitPrice?}[]
- onward?: {buyerId, paid, box?}; unitPrice lives on each input line, required for onward, forbidden for warehouse. variantId is warehouse-only.

Ops exports createCustomerGoodsReceipt(input), loadCustomerGoodsReceipt(uuid), previewCustomerGoodsReceiptCorrection(uuid,input), correctCustomerGoodsReceipt(uuid,input,expectedToken,reason), previewCustomerGoodsReceiptCancellation(uuid), cancelCustomerGoodsReceipt(uuid,expectedToken,reason), customerGoodsReceiptFeatureEnabled(). Creation/correction/cancellation return CustomerGoodsReceiptState.

State exposes receiptUuid/payment/adjustments/sale/cashMovements/status/token/issues/totals/featureEnabled/writeBlockReasons. Totals: {value,pairs,sale,cost,profit,cash,buyerDebt}. Previews return {state,token,allowed,writeBlockReasons,net:{sourceDebt,stock,cash,buyerDebt,profit}}. Net stock is pair count, not per-variant allocation.

Payment.goodsReceipt: {schema:1,receiptUuid,revision,status:'active'|'cancelled',createdAt,creationFingerprint,snapshot,members,correctionOfUuid?,correctedByUuid?,reason?,cancelledAt?,mutationToken?}.

Portable snapshot uses customerUuid and onward.buyerUuid instead of local IDs; line selectedVariantUuid records the optional selected warehouse variant. Snapshot line order is normalized by lineUuid. creationFingerprint is canonical normalized snapshot JSON. No local IDs enter this fingerprint.

Each manifest member is {table:'adjustments'|'sales'|'cashMovements',uuid,lineUuid?,variantUuid?,priorUnitCost?}. Warehouse members require lineUuid, variantUuid, and finite nonnegative priorUnitCost, which restores fallback cost on reversal. Child markers are {receiptUuid,revision,status}. Sale.goodsReceiptLines has the acquisition/commercial line snapshot with required unitPrice and no variantId.

Deterministic seeds via receiptStableUuid(): goods-revision:receiptUuid, goods-adjustment:receiptUuid:lineUuid, goods-sale:receiptUuid, goods-cash:receiptUuid, goods-product:receiptUuid:lineUuid, goods-variant:receiptUuid:lineUuid. Anchor payment.uuid equals receiptUuid. Cash refId is local convenience only; manifest UUID identity is authoritative.

validateCustomerGoodsReceiptRows(receiptUuid,{payments,adjustments,sales,cashMovements}) is a pure reusable validator over supplied rows including tombstones, returning aggregate fields/status/issues/totals. It checks the manifest and financial consistency; loadCustomerGoodsReceipt additionally validates local master references and correction-chain cardinality. Task 2 should additionally validate backup master UUID mapping and cross-receipt correction links before restore.

Compatibility setting: goodsReceiptCompatibilityAcknowledged, exactly boolean true enables writes, absent/anything else is false. Task 2 MUST exclude it from backup/restore, Task 3 owns device acknowledgement UI. No UI can invoke these operations yet.

## Restrictions / decisions

- Corrections require a new receiptUuid; original date/source customer/destination/onward buyer/box cannot change. For identity changes cancel and create separately, if eligible.
- Preview tokens are compact deterministic 36-character fingerprints of the current financial/master snapshot and eligibility, NOT persisted raw database JSON. Token scope is deliberately conservative: unrelated financial/master changes can require a new preview. This prioritizes safety over reducing false stale warnings; full-table reads may need targeted optimization for very large databases later.
- Dependency guards are conservative for same timestamps and later-edited historical rows. Cancelled/deleted dependent history still blocks reversal where relevant, so replenishment cannot erase evidence of consumption.
- Warehouse cancellation leaves created product/variant masters at zero stock for audit rather than deleting masters.
- Cash reversal tombstones the original receipt cash movement (retained for audit), rather than adding an ordinary payment or fictional income.
- Existing weighted cost remains floating point, while receipt quantities, agreed costs, resale amounts and financial balance changes must remain safe integers.
- No claim of multi-device atomic writes or server version fencing; Task 2 must cover row-order/UUID remapping and Task 3 must communicate version compatibility and one-device-at-a-time editing.

## RED/GREEN evidence

All browser runs use isolated fresh Chromium contexts, real Dexie/ops, block requests outside the localhost test origin, and block service workers. The harness inherits caller TEMP/TMP and accepts CHROMIUM_PATH. On this Windows machine commands set:

    $env:TEMP='D:/CodexTemp/customer-goods-receipts'; $env:TMP=$env:TEMP

RED command: node tests/customer-goods-receipts.mjs

1. Initial exit 1: dedicated creation export exists: expected "function", got "undefined".
2. After creation slice, GREEN 7 checks; next RED exit 1: previewCustomerGoodsReceiptCorrection is not a function.
3. Correction/onward/generic guards GREEN 35 checks, adversarial validation/dependencies GREEN 77 checks.
4. Collision regression RED exit 1: existing deterministic child UUID rejected: expected true, got false. Fixed preflight UUID reservation and transactional final readiness validation; expanded suite GREEN 90 checks.
5. Revision regression RED exit 1: forged matching revision rejected: expected "conflict", got "ready". Fixed stable revision validation; GREEN 92 checks.
6. Final focused command node tests/customer-goods-receipts.mjs: exit 0, PASS 95 checks. Covers exact financial examples, no supplier/purchase effects, correction/cancel/retries, validation/no-partial-writes, compact/stale tokens, missing/conflicting children, late overflow rollback, existing weighted cost/restoration, chronology/dependency restrictions, and public guards.

Final npm test: exit 0, 1130 checks in 111 scenarios. Existing tests/run.mjs was NOT changed: the previously reported timeout did not recur with caller TEMP/TMP set. Its waitForFunction timeout-argument issue remains a separate confirmed code observation, but no harness change was needed for this task.

Final npm run build: exit 0, tsc and Vite successful (200 modules). Existing db/sync mixed static/dynamic import and >500kB chunk warnings remain; no new TypeScript errors.

git diff --check: exit 0; only standard repository LF/CRLF warnings.

## Self-review / remaining work

Reviewed transaction boundaries, late failure rollback, child UUID collisions, metadata financial validation, compact token persistence, generic mutation guard coverage, empty physical lines, weighted cost restoration and conservative date dependencies. No production account or real cloud test was run. No subagent was spawned.

Controller's independent read-only review is still required. UI/sync/backup work is intentionally not implemented here; do not expose the feature until those tasks pass. Existing unrelated qa-direct-trade-form.png, qa-sync-status-in-app.png and qa-sync-status-offline.png remain untouched and untracked.

## Fix round 1 — deterministic legacy cost basis

The review found that positive legacy stock represented only by quantity adjustments used mutable `variant.purchasePrice` as the replay fallback. Adding a receipt changed that fallback, so old 2 @ 500 plus receipt 2 @ 1000 rebuilt as 750, then 875, then 937.5.

RED command: `node tests/customer-goods-receipts.mjs`

- Valid feature RED (isolated localhost-only browser, run outside the filesystem sandbox because Vite/esbuild config resolution was denied there): exit 1 at `quantity-only legacy opening rejected: expected rejection`.
- The regression seeds positive legacy stock with a quantity-only opening adjustment and verifies a clear Dari rejection plus byte-for-byte no-write state.

Fix: before inserting any warehouse receipt adjustment for a selected existing variant, replay the real live chronology plus the proposed receipt twice through `computeCosts`, changing only the fallback price. A received non-direct purchase already removes fallback use under `rebuildCosts`; chronological stock at zero also makes the incoming receipt reset cost independently. If the two no-purchase replays differ, reject with instructions to first record an `اصلاح قیمت خرید` document. The check lives in the shared receipt `insert` path, so creation and correction both enforce it transactionally. No global costing behavior changed and no frozen receipt cost is forced over later documented history.

GREEN command: `node tests/customer-goods-receipts.mjs`

- Exit 0, PASS 104 checks. New coverage includes quantity-only legacy rejection/no writes, existing explicit cost acceptance, two consecutive rebuilds without drift, eligibility after a documented cost reset, and correction-insert rejection with full rollback.

Build command: `npm run build`

- Exit 0, TypeScript and Vite successful (200 modules). Existing mixed static/dynamic import and >500 kB chunk warnings remain.
- Full baseline was not rerun because shared costing semantics were not changed; the guard is confined to the receipt insertion path.
