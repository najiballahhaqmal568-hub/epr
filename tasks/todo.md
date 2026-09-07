# Wholesale freight progress

- [x] Checkpoint 1: pure calculations and validation, red/green tests.
- [x] Checkpoint 2: atomic accounting, correction/cancel, sync replay tests.
- [ ] Checkpoint 3: forms, ledger display, browser verification and release.

Checkpoint 1 verified 2026-09-07: `npm test` passed 1040 checks across 105
scenarios; `npm run build` passed with existing bundle/import warnings.
Checkpoint 2 verified 2026-09-07: `npm test` passed 1124 checks / 110 scenarios;
`node tests/sync-safety.mjs` and `npm run build` passed. See
`docs/decisions/0001-wholesale-freight.md` for the operation contract and limitations.
The accounting operations are not called from the production UI yet.
No live data changes, push or deployment performed.

Checkpoint 3 must add freight labels and details (including zero-debt freight),
hide zero-value storage artifacts, preserve drafts, show effect previews, and
use `addSaleWithShipping` for atomic checkout. Test correction/cancellation,
busy/double-click handling and responsive RTL before release.
