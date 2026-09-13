# Task 5a report — generic one-sided mutation guards

## Result

Generic sale, purchase and payment operations now reject marked direct-trade documents before changing stock, cash, accounts, or synced documents. Linked customer/supplier returns load their referenced base document inside the write transaction. Exchange rollback is covered through the same customer-return guard. `addSaleShipping` is unchanged so the valid direct-trade freight bundle remains available.

The rejection text deliberately states that correction is unavailable in this version; it does not point users to a correction screen that is not part of this release.

## TDD evidence

- RED: after adding the direct guard integration case, `node tests/direct-trade.mjs` exited nonzero on the required direct-specific error because the generic boundaries still accepted or incidentally rejected marked records.
- GREEN: `node tests/direct-trade.mjs` passes all 20 cases, including preservation of ordinary unlinked historical returns.
- Each rejected public operation compares the exact `SYNC_TABLES` snapshot before and after the call, including stock, cash movements, customer/supplier balances, and all synced documents.
- The case covers generic `addSale`, `addPurchase`, `addPayment`; sale deletion and impact; purchase landing, receipt, corrections, cancellation and impact; customer/supplier payment correction previews and commits; opening/lender correction paths; payment deletion and impact; ledger cancellation; referenced customer/supplier returns; and exchange rollback.

## Verification

- Focused direct suite: `node tests/direct-trade.mjs` — PASS, 20 cases.
- Build: `npm.cmd run build` — exit 0 (`tsc -b && vite build`).
- `git diff --check` — no whitespace errors; only Git's existing LF-to-CRLF notices.

## Files

- `src/lib/ops.ts`: private marker guards at generic operation boundaries; transactional referenced-base checks for returns.
- `src/lib/ledgerSaleCancellation.ts`: direct-sale rejection in the ledger shortcut preview and transactional recheck.
- `tests/direct-trade-checks.ts`: direct-specific rejection and exact snapshot regression coverage.

## Deferred boundary / concerns

- This is Task 5a only. Coordinated direct correction and cancellation remain unavailable and are not implemented here.
- The feature flag and publication state are unchanged.
- Full repository and sync suites are left for the controller's integrated run per the updated task instruction.
