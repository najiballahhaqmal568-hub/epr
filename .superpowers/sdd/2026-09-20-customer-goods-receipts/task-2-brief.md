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
