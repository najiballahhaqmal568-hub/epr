# Sync safety review — 2026-09-07

## Fixed: equal-timestamp page boundaries

`syncNow` used to read at most 1,000 records per table, persist only the final
`updated_at`, and request strictly newer timestamps next time. A backup batch
can share one timestamp: the local reproduction received 1,000 of 1,001
customers, and repeated sync never received the last customer.

The download now orders by `(updated_at, uuid)`, drains pages until empty, and
persists both cursor fields together after each applied row. UUID ordering
breaks timestamp ties. Offset pagination was avoided because concurrent row
updates can shift offsets. The filter uses the existing Supabase client;
see [PostgREST filter syntax](https://supabase.com/docs/reference/javascript/using-filters).

The original `pull:<table>` timestamp remains. A legacy cursor without
`pullUuid:<table>` replays its timestamp boundary once through the existing
idempotent row application. No schema migration, database reset, financial-rule
change, or new dependency is required.

## Verification

Run `node tests/sync-safety.mjs` from the repository root. It starts local Vite
on port 5192 and isolated Chrome (override with `CHROMIUM_PATH`). External
requests are blocked; only the transport is faked, while sync and IndexedDB
are real. It verifies:

- 1,001 equal-timestamp records received in one sync;
- repeated sync without duplicate records;
- legacy timestamp-boundary recovery;
- failure at the second page reports an error, preserves the first page, and
  resumes without losing or duplicating records;
- a pending cloud restore blocks ordinary sync without changing local records.

Also run `npm test` for accounting/correction regressions and `npm run build`
for TypeScript and production bundling. There is no configured lint command.

## Added: truthful sync status

The header, dashboard, and settings share status wording. Settings now show
the last successful cycle for this device, local records awaiting upload or
confirmation, an offline explanation, and a retry action. Server configuration
alone is no longer described as a successful connection. A pending restore
has a distinct warning and does not offer an ordinary sync retry.

`lastSuccessfulSync` is local sync metadata, written only after all table
uploads and downloads finish. It survives reload and is cleared with the
existing sync state during restore/shop changes. It is not proof that a
second device has received the data.

Pending count uses the existing local timestamp/upload-cursor protocol and
indexed counts, including deleted records and excluding remote-applied rows
(timestamp zero). It counts records, not business transactions. The upload
scan's millisecond is included conservatively; an already sent boundary row
may remain counted until the next successful cycle. This is not a per-record
server receipt ledger and does not fix clock rollback or other limitations
of the existing timestamp protocol. Unknown/loading is never displayed as zero.

`syncNow(true)` rejects offline, signed-out, unconfigured, and busy attempts.
The run lock is acquired before async authentication; automatic callers still
use the non-throwing mode. Named event handlers are removed by `stopSync`.
`importBackup` returns `{ cloudSynced }`: local/merge imports remain usable
offline but the UI distinguishes local import from completed cloud sync.
Authoritative replacement failures still reject.

Run `node tests/sync-status.mjs` for local-only status and UI verification:
offline/signed-out rejection, pending creation and deletion, exclusion of
remote changes, successful upload, preserved success time on error and reload,
retry, keyboard disclosure, responsive widths, busy rejection, event cleanup,
and navigation from the actual app header. `tests/checks.ts` also guards the
local-import/cloud-success distinction. No production account is used.

## Limits and next work

This is not verification against the owner's production account. The local
test does not validate production RLS, RPC deployment, or real phone networking.
Records missed at timestamps *older* than a legacy cursor are not automatically
recovered by boundary replay. Investigate any existing discrepancy read-only
before choosing recovery; preserve backups from both devices first.

Next increments, not implemented in this change:

1. Audit correction UI consistency using the existing preview/correction
   operations in `src/lib/ops.ts`; preserve the shared accounting definitions
   in `src/lib/effects.ts` and the terminology in `CONTEXT.md`.
2. Improve busy-store sales and shared payment forms in separate tested slices.

## Release and recovery

Fixed: bulk downloads no longer silently stop at the first 1,000 records or
skip the remaining records with the same timestamp. This is a web-only change.

Refresh both devices after deployment; do not reset or re-import production
data just to install the update. If regressions appear, revert only this
release's commit and redeploy. Existing business records remain in place;
the extra cursor key is ignored by the previous code. Rolling back also
reintroduces the pagination defect, so stop recovery attempts and investigate.

## Direct-sale reader and compatibility gate — 2026-09-09

Direct-sale base documents and payments now resolve every required customer,
supplier and funded sarraf through UUID before applying effects. Sender-local
numeric IDs are not accepted as a fallback. An unresolved or deleted party raises
a recoverable sync error, and the pull cursor remains on the last applied row.
A base sale or purchase may still arrive before its counterpart; it is retained,
shown by the read model as incomplete, and cannot authorize financial changes.

`loadDirectTrade` validates reciprocal document UUIDs, revision/status, identical
commercial snapshots, dates, totals, empty physical-stock lines, zero legacy
payment/discount/landing fields, live parties, exact cash-route equations and
over-allocation. Its canonical token covers both bases, active direct payments,
linked freight records and current affected balances using UUIDs rather than local
IDs. Replays therefore keep the same token on devices whose local row IDs differ.
Sibling revision evidence is retained in local sync state and blocks writes;
predecessor replay cannot roll a successor back. Reader/effect support remains
active, including for cancelled records.

Creation remains disabled unless the local `directTrades.enabled` setting is
explicitly true, and state-loaded eligibility plus the current read-only flag are
checked by the synchronous write guard. Future correction/cancellation operations
must first await `syncNow(true)`, then load their preview, and inside their Dexie
write transaction re-load state and the `settings` row before comparing the token.
No network call belongs inside that transaction.

The local setting is not compatibility proof. The existing cloud tables store generic JSON with per-row last-writer-wins;
they provide neither an active-client-version fence nor an atomic cross-document
revision fence. An older client can omit or overwrite direct fields, and a device
that sees only the server's final same-row winner cannot reconstruct every sibling
revision. For the owner-approved first web release (September 10 scope), code may
be published with writes disabled. Before enabling writes, the owner must refresh
every active device and explicitly acknowledge this in the local enable dialog.
The owner confirmed this requirement; the acknowledgement is excluded from backup
export/import. It is a manual operational requirement, not server enforcement or
proof that another device has upgraded. Do not use old clients after activation.
No schema, RLS, authentication,
production account or live backup was changed for this work.

After direct records exist, do not roll back to a pre-direct-sale build: it cannot
interpret those records safely. If a release problem appears, stop direct entry
and ship a compatible fix retaining readers/effects/guards; preserve all records.
Advanced direct correction/cancellation remains unavailable in this first release.

Local verification uses `node tests/direct-trade-sync.mjs` on port 5200 with two
isolated browser contexts, different local party IDs, real `encodeRefs`,
`applyRemoteRow`, `syncNow`, IndexedDB and a fake transport. External requests are
blocked. It covers repeated replay, UUID resolution, missing counterparts and
parties, cursor preservation, mismatched revisions, stable tokens,
feature/read-only/stale guards and exact customer/supplier/cash balances. Existing
sync regressions remain `node tests/sync-safety.mjs` and
`node tests/sync-status.mjs`.

## Customer goods receipt aggregate safety — 2026-09-21

Customer goods receipts use the existing row-wise cloud tables. The anchor,
warehouse adjustment or onward sale, and optional cash row therefore do not arrive
atomically. A child may be stored and have its ordinary accounting effect before
the anchor arrives; `loadCustomerGoodsReceipt` reports that group as incomplete
and blocks edits until the deterministic manifest is complete. Conflicting
cancellation/correction evidence is retained under
`goodsReceiptConflict:<receiptUuid>:<table>:<rowUuid>` in local sync state and also
blocks edits. An unresolved conflict on a cancelled predecessor also blocks its
linked active correction successor (and the affected correction family), including
previews and mutations; correction links are traversed with cycle protection. A
delayed active row cannot roll a cancelled member back, and an old
client that removes an existing receipt marker cannot silently replace that row.

Receipt source customers, onward buyers and warehouse variants are encoded by
UUID. Sender-local numeric IDs are removed and are never accepted as a fallback.
Active rows require live matching masters. Cancelled audit rows may resolve an
existing deleted master so retained history remains readable, but a missing UUID
master is still a recoverable sync error and the pull cursor does not advance.
Receipt adjustment insertion, replacement and cancellation use reverse/apply
effects and rebuild acquisition cost; the anchor's saved prior cost restores the
fallback basis after cancellation.

Backup import validates every receipt aggregate, total, deterministic member,
local ID-to-UUID master mapping, and reciprocal correction chain before sync is
paused or any table is cleared. Partial groups, stripped markers, broken links and
foreign numeric references are rejected with the current local data unchanged.
Cancelled tombstones and audit links are preserved. The per-device
`goodsReceiptCompatibilityAcknowledged` setting is neither exported nor imported.
Export reads receipt rows and receipt-specific conflict evidence in one local
snapshot and includes that evidence in the optional
`customerGoodsReceiptConflicts` backup field. Import checks its exact key namespace,
referenced rows and value shape before clearing anything, then restores only these
receipt conflict keys. Older backups without the field remain accepted; unrelated
sync state, cursors and device identity are never restored from this field.

Local verification is `node tests/customer-goods-receipt-sync.mjs` on port 5204.
It uses isolated real Dexie contexts and real sync/backup operations with an
in-memory fake transport; all non-localhost requests and service workers are
blocked. It compares stock, customer debts, cash, current acquisition costs and
frozen onward-sale cost/profit across devices with different local IDs, including
shuffled and repeated replay, correction, cancellation and rejected restore.

This adds no backend schema, transaction fence, active-client version fence or
atomic multi-device receipt guarantee. Before enabling receipt writes, refresh
every client and acknowledge compatibility separately on each device. Edit a
given receipt on only one device at a time and wait for sync before correcting or
cancelling it. After receipt records exist, do not use an older client that does
not understand their markers.
