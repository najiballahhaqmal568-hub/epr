# SDD ledger — plan: docs/superpowers/plans/2026-09-20-customer-goods-receipts.md

Base: 023681be036566630aa3f7fcb34f7652c7b116b4. Branch feature/customer-goods-receipts; existing direct-sales worktree. Redesign worktree is unrelated and preserved.

## Preflight

| Tasks | Shared surface / self-consistency check | Finding |
|---|---|---|
| 1 / 2 | Receipt metadata, state loader, ops import/export | Task 1 defines shapes; Task 2 consumes unchanged, strict UUID transport and validation. No conflict. |
| 1 / 3 | Exported operations, state, commercialSaleLines, guards | UI calls dedicated ops, no direct database construction. Financial tests precede UI tests. No conflict. |
| 2 / 3 | Activation setting, conflict/incomplete state, reports after replay | Activation excluded from backup; UI not available before transport readiness. No conflict. |
| 1 | Types, core operations, test expectations | Valid whole amounts, receipt cap, distinct buyer; no fake purchase; state transitions/audit tested. No conflict. |
| 2 | Receipt-aware adjustment replay and backup preflight | Tests require actual effects, strict identity and rollback before clearing. No conflict. |
| 3 | UX, commercial reads, noncash collection display | Uses shared line reader, explicit receipt routing; no unrelated redesign. No conflict. |

Coverage: every spec section assigned to Task 1 (accounting/audit), Task 2 (portable safety), Task 3 (user flow/report visibility). Plan scanned for placeholders: none intentional. No task mandates mock-only tests or duplicated implementation logic.

Decision: one destination per receipt, cap value at current receivable, restrict correction after dependent activity. Announced to user. These are conservative safeguards; relaxing them later requires explicit credit/return modeling.

Baseline: first npm test timed out with C temp nearly full (~200MB free). Retried with TEMP/TMP D:/CodexTemp/customer-goods-receipts, no user files moved/deleted: PASS 1130 checks / 111 scenarios. Do not change runner solely because initial timeout occurred. Task 1 may fix timeout argument only if needed and evidenced.

Task 1: running agent /root/goods_receipt_core; base 5048fe97e5d60576c9ae68e2cf263361e176a1e2 (spec/plan committed).

## Consumer evidence for Task 3

- src/pages/Sales.tsx owns sale-history details/return/exchange/delete routing; receipt child sale must route to its dedicated detail. src/pages/sales/SaleHistory.tsx only groups rows.
- src/pages/sales/Receipt.tsx image rendering uses sale.lines directly (height and iteration); change to shared commercial lines for no-stock resale.
- src/lib/analytics.ts and sold.ts already use commercialSaleLines for commercial totals. soldVariantIds using physical lines is intentionally stock-only.
- src/pages/Reports.tsx and Dashboard.tsx gate direct-trade totals using ready UUIDs; provide an equivalent receipt-ready filter/warning for incomplete/conflict onward sales. Physical soldRecently variant iteration in Reports is intentionally stock-only.
- ordinaryCustomerCollections currently sums customer payments; exclude receipt noncash value and show it separately rather than changing cash posting.

Tooling note: no existing graphify graph in this worktree. A fresh whole-project graph/install is unnecessary for the bounded consumer scan and risks disk pressure; direct rg/source inspection used instead.

UI skills: main read frontend-ui-engineering; ui-skills-root CLI categories/accessibility selected ibelick/fixing-accessibility and fully read it. Task3 must use native labeled inputs, field-linked errors, focus-trapped existing Modal, keyboard-visible focus, explicit disabled reason and busy status. No broad redesign now. Existing ProductPhotoPicker already supplies camera/gallery/resize/preview and should be reused.

Task 1 milestone (not completion): implementer reports GREEN 35 focused checks, build/adversarial tests pending. Pure validator validateCustomerGoodsReceiptRows(receiptUuid,{payments,adjustments,sales,cashMovements}) is in customerGoodsReceiptState.ts. Snapshot line selectedVariantUuid is portable; warehouse manifest member has variantUuid and priorUnitCost. Full task review still required.

Task 1: implemented 2deab7d; report read in full. Focused95/baseline1130 in111 scenarios/build pass. Existing Vite mixed-import/chunk-size warnings only. Task review /root/goods_receipt_core_review running against review-5048fe9..2deab7d.diff; not marked complete yet.

Task 2 handoff: receipt revision is deterministic initial identity (validator enforces goods-revision seed), cancellation mutates status/audit and does not change this revision. Transport must treat active->cancelled as monotonic, reject delayed active predecessor, and flag differing cancellation/correction successor identities; do not assume previousRevision exists or repurpose revision without coordinating validator/tests. UUID identity and supplied-row validator are in Task1 report. Token compactness fixed; it fingerprints all financial/master tables, so unrelated edits conservatively invalidate previews (deferred performance tradeoff, not stale-safety gap).

## Resumed 2026-09-20

Prior review agent hit a usage limit before verdict. No task was marked complete. Fresh read-only reviewer /root/receipt_core_review_resumed is completing the full Task1 gate plus the named fallback-cost reweighting risk. Worktree still at 2deab7d and clean except the preserved QA PNGs.

Permissions changed to workspace-write. Do not assume D:/CodexTemp is writable now; use normal allowed TEMP or a gitignored temporary directory inside this plan workspace for browser tests. C currently has about 6GB free. No files were deleted to free space.

Task2 notes: ops transaction table set already includes db.syncState. SYNC_TABLES pull order is masters, sales, purchases, payments, categories, expenses, cash, reconciliations, adjustments, returns; therefore a receipt sale can arrive before its anchor and must remain incomplete, not rejected solely for missing anchor. Master UUID references must be resolved before applying row effects. Deleted audit masters and active transaction masters need deliberately distinct validation rules.

Task1 resumed review: spec/quality NEEDS CHANGES, 0 Critical/1 Important/0 Minor. Quantity-only legacy opening stock seeds computeCosts from mutable variant.purchasePrice, so old2@500 plus receipt2@1000 drifts750->875->937.5 on rebuild. Existing95 checks seed explicit old unitCost and miss this. Evidence: costing.ts229-259, db.ts640-650, ops.ts2900-2910. No tests rerun by reviewer.

Ruling: block warehouse receipt into selected existing variants whose cost basis cannot be deterministically reconstructed without mutable purchasePrice fallback, with a clear Dari error and atomic no-write behavior. Do not blindly reset cost before every receipt from priorUnitCost: doing that can mask later corrections to earlier real purchases and changes shared costing semantics. New manual goods and reliably costed existing variants remain supported. This is the simplest sufficient safeguard for the user's primary case (previously absent goods). Cost if wrong: some legacy selected variants require a documented cost correction first, or separate new-goods entry; this restriction can later be replaced by a dedicated legacy cost-basis migration. Announced to user. Add this restriction to spec/operator docs and UI handling. Task1 fix round1 pending.

Task1 fix round1 implemented 57ee786e020cf1e48a3df253596218a41b7364cf. Valid RED captured only after resolving sandbox Vite/esbuild ancestor-read denial with approved local-only escalation; earlier import failures were infrastructure failures, not valid feature RED. GREEN104 focusedchecks/build pass. Reporter says guard uses existing computeCosts twice with distinct fallback and shared insert path; no shared costing semantics changed. Test harness exposes real import errors. Scoped re-review /root/receipt_core_review_resumed running against review-fix1-2deab7d-57ee786.diff. Bash review-package utility failed because dirname was unavailable in resumed sandbox; equivalent git log/stat/diff output captured through tools and file generated with apply_patch. No review skipped.

## Resumed 2026-09-21

Previous scoped reviewer hit usage limit without verdict. Fresh reviewer /root/receipt_fix_review_final completed scoped review: Important ADDRESSED; no new Critical/Important; PASS WITH MINOR. Evidence ops.ts16-34,107 covers fallback guard in shared insertion transaction; tests exercise rollback and replay stability.

Task 1: fix round 1/5 (1 addressed, 0 Important open; commits 2deab7d..57ee786).
Task 1: minor (deferred to Task3 preview/UI): correction preview may return allowed:true for selected fallback-dependent legacy stock; submit correctly rejects atomically. Reuse read-only cost-basis validation at preview and assert allowed:false/Dari reason. Locations customerGoodsReceiptOps.ts184-199,236-240; tests/customer-goods-receipts.mjs195-200.
Task 1: complete (commits 5048fe9..57ee786, review clean of Critical/Important, 1 minor deferred).

Task 2: running /root/receipt_sync_backup; base 57ee786e020cf1e48a3df253596218a41b7364cf. Resumed controller verified agent remains active. Valid RED: receipt encode retained partyId; decode accepted missing UUID via numeric fallback. Prior sandbox Vite failure was infrastructure, not feature RED. Agent working on strict refs; no production traffic.

Task3 additional consumer evidence: SalesStats.tsx also needs receipt readiness filtering (current/previous periods) and warning, not only Reports/Dashboard. InvoiceModal.tsx maps sale.lines and must use commercialSaleLines for receipt onward invoices. ProductPhotoPicker is src/pages/inventory/ProductPhotoPicker.tsx. CustomerModal supports onCreated(customer), reusable for onward buyer creation. CustomerDetail already has live debt via useLiveQuery but filters deleted payments, so a separate audit route/list is needed to keep cancelled receipt access. Existing Sales direct detail hides cost/profit for staff; receipt detail must preserve that UI visibility convention. No unrelated authorization redesign.

Task2 interruption: implementer reached usage limit before report/commit. Last milestone reported strict UUID refs, two-context lifecycle, backup rejection-before-clear, valid cancelled-audit restore, core104 and sync-safety passing; build needed rerun after final strict-ref edit. These are milestones, not completion evidence. User asked continue; /root/receipt_sync_backup resumed to finish verification/report/commit without redoing implementation. Current HEAD57ee786; Task2 edits are uncommitted. New files customerGoodsReceiptSync.ts, customerGoodsReceiptBackup.ts and customer-goods-receipt-sync.mjs present. Conflict key contract reported: goodsReceiptConflict:<receiptUuid>:<table>:<rowUuid>, consumed by state loader. Task3 has not begun.

Task2 implemented3f3da8f; full report read. Final-tree focused receipt sync/backup PASS and build exit0; fresh core/sync-safety stalled/failed before assertions, so verification caveat remains. C now ~246MiB free. Controller scoped escalated retry with D temp still stalled (Chrome then Edge), both interrupted; fresh 127.0.0.1 diagnostic Vite on5206 served /, /src/db.ts, /src/lib/customerGoodsReceiptOps.ts with200. No stale5192/5193 listeners found by elevated process/port check. Disk pressure is a hypothesis, not proven root cause; no files deleted. Diagnostic5206 stopped. Continuing bounded startup diagnosis, not modifying production accounting for infra failures.

Task2 review /root/receipt_task2_review: 0Critical/2Important; NEEDS FIXES. (1) Backup omits syncState conflict evidence and import clears it, allowing blocked valid rows to become ready. (2) Conflict markers on cancelled predecessor do not block its active correction successor. Fix round1 dispatched to original implementer against3f3da8f; browser test runs temporarily coordinated with controller diagnostics.

Ruling: preserve receipt-specific conflict evidence in a narrowly scoped optional backup envelope field, validate before clearing and restore only those keys, instead of refusing all backups while conflicts exist. Do not copy ordinary sync cursors/identity. Why: backups must preserve recoverable business records and unresolved safety warnings together. Cost if wrong: a new optional backup field requires validation and tests; older pre-receipt clients still cannot safely interpret these records and remain prohibited. No server schema or general sync-state restore is added.

## Resumed 2026-09-22

Task2 fix round1 was interrupted by implementer quota after adding test-first assertions only. HEAD remains3f3da8f; sole tracked dirty file is tests/customer-goods-receipt-sync.mjs. No production fix committed, no RED/GREEN for these new assertions yet. Original implementer resumed with followup_task; do not restart Task2 or mark complete.

Controller established local startup workaround Sep21: default Vite on5206 listened at ::1 and Node fetch (localhost/127/[::1]) plus isolated Edge module import failed despite ready. Restart same port/source with process-local NODE_OPTIONS='--dns-result-order=ipv4first' -> Vite127.0.0.1; Node localhost+127 /src/db.ts both200 length56127; isolated Edge imported /src/lib/customerGoodsReceiptOps.ts and returned 'function', diagnostic exit0. Both diagnostic servers stopped. No code/machine DNS config changed. For subsequent test launches use this process-local NODE_OPTIONS plus TEMP/TMP='D:/CodexTemp/customer-goods-receipts' with scoped require_escalated as required for D writes and sandbox ancestor reads. C-space pressure remains a separate issue, not established cause of the module-loading failure. No user files were deleted.

Task2 fix round1 implemented7f6cf5612fd4d57d7baaf07e8af8a501b7174a85 against3f3da8f. Appended report read in full. Valid REDs: active B incorrectly ready/allowed and exported backup lacked conflict evidence. Final GREEN focused sync/backup, core104, sync-safety (1001 pagination/retry/restore guard), build203modules/PWA exit0. C now ~5GiB free; prior infra caveat closed for these suites using process-local IPv4-first/Dtemp. Full npm test remains Task3/final gate. Scoped reviewer /root/receipt_task2_fix1_review running on review-task2-fix1-3f3da8f-7f6cf56.diff. Two findings pending verdict, do not mark Task2 complete yet.

Task 2: fix round 1/5 (2 addressed, 0 open; commits3f3da8f..7f6cf56). Scoped reviewer /root/receipt_task2_fix1_review: both Important ADDRESSED; no new Critical/Important/Minor or out-of-scope observations. Evidence ops.ts2992-3006/3011-3016/3029-3042 and backup.ts16-43 preserve validated receipt-only conflict envelope coherently; state.ts102-127/144-151 propagates predecessor/family conflict and guards B. Covering report accepted; no suites rerun by reviewer.
Task 2: complete (commits57ee786..7f6cf56, review clean).

Task 3: running /root/receipt_ui_reports (gpt-5.6-sol high, fresh context); base7f6cf5612fd4d57d7baaf07e8af8a501b7174a85. Task1 correction-preview Minor remains assigned to this task. See enriched task-3-brief.md for verified UI consumer map and local test startup environment. No publish/merge; three unrelated QA PNGs preserved.

Task3 supplemental consumer audit: FamilyDetail builds its own events and labels all positive payments as cash, so brief/agent now include a receipt-specific label/items plus commercial sale lines there. CashView CashLedger exposes reversal only for type=transfer, not receipt sale movements; no extra receipt mutation path found or cash semantics changed. Accounts delegates customer view to CustomerDetail. NewSaleModal/ReturnModal/ExchangeModal physical-line uses are intentional stock-only and receipt sales must not route there. Do not broaden into unrelated family debt/refactor or ordinary cash display changes.

## Task 3 final milestone — 2026-09-26

Task 3 implementation and self-review complete; status `DONE_WITH_CONCERNS`. The concern is limited to existing Vite mixed-import/large-chunk warnings and the documented absence of a server-side version fence/atomic multi-row cloud transaction; no feature assertion remains failing. Full report: `task-3-report.md`.

Self-review fixed five gaps before final gates: stale correction submit now uses the displayed preview token and requires renewed confirmation on change; receipt enable/detail mutation controls fail closed unless cached role is owner; staff/viewer detail hides acquisition cost/profit; zero receivable has a visible disabled reason; optional manual-line photos are available for both destinations. Valid UI RED was the missing visible zero-debt reason. Final focused UI GREEN is 20 checks including staff privacy and stale-preview no-write.

Final local evidence with process-local IPv4-first and D temp: receipt core `PASS 112 checks`; receipt UI `PASS 20 checks`; receipt sync/backup PASS; sync-safety PASS with 1001-row pagination/retry/restore guard; `npm test` PASS 1130 checks / 111 scenarios; `npm run build` exit 0 with 209 modules and PWA output. `git diff --check` exit 0 apart from standard LF/CRLF notices. The first build invocation was not counted because permission review timed out; unchanged retry passed. No cloud two-device scripts, live Supabase/data, publish, push or merge. Three unrelated QA PNGs remain untracked and untouched.
