# Wholesale freight

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
