# Task 3 report — direct-sale read state, UUID replay and compatibility gate

## Outcome

Implemented `loadDirectTrade`, `assertDirectWriteReady` and
`directFeatureEnabled`. The reader returns blocking incomplete/conflict states,
validates paired commercial documents and exact payment routes, and produces a
stable UUID-based canonical token that includes payments, freight children and
affected party balances. The creation gate defaults off; read/effect support does
not depend on that gate.

Sync now encodes the direct payment receiver UUID and strictly resolves all
required direct customer, supplier and funded-sarraf references. It rejects
missing/deleted references without applying the row or advancing its pull cursor.
Direct base counterparts may arrive later. Same-document stale predecessors cannot
roll successors back, and sibling-revision evidence is retained while a
deterministic local winner makes reverse replay converge.

## TDD and evidence

The first focused run failed because `directTradeState.ts` did not exist. The
implementation then made the initial test green. A cross-device token assertion
subsequently failed because received rows explicitly contain `deleted: false`;
canonicalization was corrected to treat that as equivalent to an omitted flag.

Final checks:

- `node tests/direct-trade-sync.mjs` — PASS. Two isolated contexts, different local
  party IDs, real IndexedDB/encode/apply/sync, fake local transport; covers repeated
  replay, missing counterpart/party, cursor preservation, mismatched revisions,
  stale predecessor, sibling order convergence, concurrent over-allocation,
  cancellation versus later payment, exact balances and write guards.
- `node tests/sync-safety.mjs` — PASS.
- `node tests/sync-status.mjs` — PASS.
- `npm.cmd test` — PASS, 1,130 checks in 111 scenarios.
- `npm.cmd run build` — PASS. Existing Vite dynamic-import and large-chunk warnings
  remain; no TypeScript/build errors.

No production account, production test, live backup, schema, authentication or RLS
was used or changed.

## Compatibility conclusion

Publication is blocked. The current generic JSON/per-row last-writer-wins transport
has no active-client-version enforcement and no atomic cross-record revision fence.
The local feature flag cannot prove that every active device understands direct
commercial lines and dual-party payment effects. A server/version enforcement
change would require separate authority. Remaining implementation can safely
continue with creation disabled.

Future direct correction/cancellation operations must await `syncNow(true)` before
preview, then re-load state and `directTrades.enabled` inside their Dexie write
transaction (including `db.settings`) and compare the fresh token. They must not run
network work inside that transaction.
