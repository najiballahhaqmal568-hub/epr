# Expense review and deletion

## User-facing change

Expense list and calendar rows now open the same **جزئیات** sheet. Existing
expense correction is available there for business, home, and personal records.
Home/personal correction preserves expense type and the recorded owner/partner;
the amount, date, note, cash/credit split and creditor can be corrected. Its preview
also shows the withdrawal amount for this document before and after. Deleting a mistaken expense
requires a separate confirmation explaining cash returned, debt reduced, and
preservation of prior settlements. Cancel is the first confirmation action.

No schema migration, new accounting rules, stock changes, or backup import is
needed. Home/personal records without a complete document-level `drawAmount`
(legacy records derive withdrawals from cash movements) remain blocked with an
explanation; ownership is never guessed. Partner cash-withdrawal rows
are not expense records and keep their existing behavior.

## Implementation boundary

- `ExpenseDetails.tsx` reads the selected expense with a live IndexedDB query.
  A changed record exits confirmation; a deleted record has no action controls.
- Amounts use `expenseCashPaid` / `expenseCreditAmount`, including legacy defaults.
- The final action uses existing transactional `deleteExpense`: tombstone the
  original, reverse its cash and creditor effects, keep earlier settlements.
- `correctExpense` replaces eligible private expenses atomically. Both reversal
  and replacement cash movements carry `drawAccountedByExpense` so PartnersCard
  counts the active replacement expense once, including its credit portion.
  The original and linked correction reason/snapshot are retained. The operation
  never converts a private expense into a business expense or transfers ownership.
- Read-only accounts have details but no mutation controls. A synchronous busy
  guard prevents duplicate submissions; errors remain visible for retry.
- The explanation is not a locked before/after account balance quote. Existing
  sync/concurrency and deletion semantics are unchanged.

## Verification

Run `node tests/expense-details.mjs` from the repo root (Chrome or CHROMIUM_PATH).
It starts Vite on port 5194, blocks external requests, and uses an isolated browser
with synthetic records. It covers list/calendar entry, correction navigation,
cancel without writes, transaction failure rollback/retry, cash/credit/mixed
deletion, retained original, unchanged stock, read-only access, and responsive
dialog widths, plus home/personal correction through the real form. Screenshot
output is local QA only, not a production data fixture. `npm test` additionally
checks prior settlements, creditor changes, repeated corrections, failed-operation
rollback, the real PartnersCard withdrawal report, and legacy/invalid-input guards.

Also run `npm test` and `npm run build` before publishing. No production account
or backup is used in these checks.
