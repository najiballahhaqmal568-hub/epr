# ADR-001: Keep wholesale freight separate from shoe sales

## Status

Accepted for the accounting layer, 2026-09-07. UI and deployment are pending.

## Context

The shop pays freight, but the customer, shop, or both may bear its cost.
Immediate freight reimbursement must not be confused with payment for shoes.
Active business data must remain intact; introducing a new remote table would
require a coordinated Supabase migration and new restore/sync handling.

## Decision

Reuse existing sync-supported documents and `effectsOf('payments', ...)`:

- `Payment.shipping` is the freight master. Its `amount` is the negative unpaid
  customer share. `cashDelta` is reimbursement minus gross freight paid.
- A linked business `Expense` contains only the shop share, never the full cost
  charged to the customer. Its `cashPaid` describes that share; do not call
  `addExpense` or independently create an expense cash movement for it.
- Two linked cash entries record gross freight paid and reimbursement received.
  Immediate reimbursement is available to fund the freight in that transaction.
- Sale and child links use UUIDs; numeric `CashMovement.refId` is not a portable
  relationship and must not be used to identify freight on another device.
- Zero shop-share and receipt rows are intentional. Keeping a deterministic set
  of child UUIDs lets a winning concurrent correction replace a nonzero value
  with zero without leaving the losing value behind.

The operations live with the existing accounting orchestrators in `ops.ts` so
they reuse its cash validation, UUID derivation and sale transaction. The pure
amount calculation stays in `shipping.ts`; no new dependency or schema is added.

## Operation contract

- `addSaleShipping(saleId, input)` returns the freight payment ID. Requires an
  active ordinary wholesale sale and an active named customer.
- `addSaleWithShipping(sale, input)` returns the sale ID. Use at checkout instead
  of sequential UI calls; a freight failure rolls back the sale and stock too.
- `correctSaleShipping(paymentId, {...input, reason})` returns the replacement
  payment ID. It reverses the old bundle and creates the new bundle atomically.
- `cancelSaleShipping(paymentId, reason)` reverses an erroneous registration.
  It is **not** a carrier refund or automatic cancellation after a shoe return.

Corrections retain tombstoned originals, UUID links, reason, previous freight
amounts and cash history. Later independent customer payments are untouched;
removing an erroneous charge may therefore leave a legitimate customer credit.
Repeating cancellation is a no-op. Generic payment/expense deletion and deletion
of a sale with active freight are blocked to avoid reversing half a transaction.

## Alternatives considered

- Increasing shoe prices: rejected because it invents shoe revenue/profit.
- Recording the whole freight as an expense: rejected because the customer's
  portion is a receivable, not the shop's cost.
- Dedicated remote freight table: more explicit but adds migration/restore risk;
  the existing document effects already represent the required accounting.

## Consequences and release gate

Local writes are atomic; existing server synchronization is per record, **not**
an atomic transaction across all devices. Mutation rejects visibly incomplete
or inconsistent bundles and detects a replacement arriving before its original
tombstone. Same-source correction/replay is tested with different local IDs.
This does not provide global locking or resolve every conflicting offline intent
(for example cancellation on one device versus correction on another). Avoid
editing the same freight on multiple offline devices; inspect conflicts without
resetting or re-importing real data. Production RLS/networking is not tested here.

Before exposing the feature, checkpoint 3 must supply freight-specific labels,
details, correction/cancellation confirmation and before/after previews. Zero
receipt/shop-share storage rows should not become confusing standalone UI items.
Preserve held drafts and existing sales workflows. Refresh all devices for the
release; old clients do not have the new mutation guards. No APK update.

## Verification

`npm test`: 1124 checks / 110 scenarios passed. Covers split/customer/shop shares,
full reimbursement, selected cash box, invalid dates/shares/customer, rollback,
stock preservation, later receipts, audit, cancellation, duplicate correction
protection and real local `applyRemoteRow` replay. The concurrent shop-share test
failed (old expense remained) before the freight-specific sync update branch.

`node tests/sync-safety.mjs`: passed local pagination, retry and restore guards.
`npm run build`: passed; existing large-bundle/mixed-import warnings remain.
No production account, backup or business records were used.

Checkout and existing-sale UI verification (2026-09-07): 1130 checks / 111
scenarios pass. The isolated browser test covers create/correct/cancel, invalid
reimbursement, Dari input, responsive layout, held-draft restoration, atomic
double-click checkout, history and a read-only permission change while editing.
Production build passes with the existing bundle/import warnings.

## Release and recovery

No schema migration or data reset is required. Refresh all clients before using
freight. Only synthetic local data was tested; live Supabase permissions and
multi-device networking were not exercised. Keep the existing sync error UI.
If a financial inconsistency appears, stop freight mutations and preserve all
records for diagnosis; do not reset or restore devices as a repair shortcut.
Before freight records exist, the previous deployed version is `6a87241`.
After records exist, prefer a forward fix retaining freight labels and mutation
guards; a blind downgrade would expose old generic deletion paths. Do not delete
freight records to roll back a release.
