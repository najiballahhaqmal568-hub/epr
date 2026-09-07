# Expense review and deletion

## User-facing change

Expense list and calendar rows now open the same **جزئیات** sheet. Existing
business-expense correction remains available there. Deleting a mistaken expense
requires a separate confirmation explaining cash returned, debt reduced, and
preservation of prior settlements. Cancel is the first confirmation action.

No schema migration, new accounting rules, stock changes, or backup import is
needed for this UI update. Home/personal correction is still unsupported by the
existing operation and is intentionally not exposed. Partner cash-withdrawal rows
are not expense records and keep their existing behavior.

## Implementation boundary

- `ExpenseDetails.tsx` reads the selected expense with a live IndexedDB query.
  A changed record exits confirmation; a deleted record has no action controls.
- Amounts use `expenseCashPaid` / `expenseCreditAmount`, including legacy defaults.
- The final action uses existing transactional `deleteExpense`: tombstone the
  original, reverse its cash and creditor effects, keep earlier settlements.
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
dialog widths. Screenshot output is local QA only, not a production data fixture.

Also run `npm test` and `npm run build` before publishing. No production account
or backup is used in these checks.
