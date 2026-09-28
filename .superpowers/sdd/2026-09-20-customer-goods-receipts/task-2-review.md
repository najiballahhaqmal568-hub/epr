# Task 2 review at 3f3da8f

Reviewer: /root/receipt_task2_review (gpt-6-astra high), read-only. Spec: NEEDS FIXES. No Critical, two Important. Focused final-tree sync/backup and build evidence accepted; legacy suite final-tree verification was pending local startup recovery.

1. **Important: backup round-trip discards retained receipt conflict evidence.** ops.ts2991 exports TABLES, excluding syncState; import3034 clears syncState; customerGoodsReceiptBackup.ts59 validates document rows alone. A structurally valid receipt blocked solely by goodsReceiptConflict:* can round-trip into ready/cancelled. Preserve receipt-specific evidence or reject unresolved exports; regression must prove round-trip cannot unblock. Controller selected a narrow validated optional backup envelope to preserve backup utility, not whole syncState export.
2. **Important: predecessor conflict does not block active correction successor.** customerGoodsReceiptState.ts77 loads markers only for requested UUID; predecessor97 verifies reverse link/deleted only. If cancelled predecessor A retains competing-correction evidence while selected successor B stays linked correctly, B still reports ready with no conflict write block. Propagate unresolved predecessor/branch conflicts to affected successors, and test B status, disallowed preview and mutation rejection. Existing test checked A only.

Strengths: strict UUID before effects, cancelled deleted-master audit, monotonic cancellation, adjustment reverse/apply cost rebuild, backup aggregate/mapping/chain preflight before clear. Minor: acknowledged existing mixed-import/chunk-size build warnings, not new receipt defects.

Reviewer named checks: ops.ts2967-3085 backup boundary; completed shared state/validator context; costing.ts184-273 fallback semantics; customerGoodsReceiptOps.ts159-198 mutation gating. No suites rerun or live production access.
