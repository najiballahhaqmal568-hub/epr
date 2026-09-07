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
