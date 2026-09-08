# Wholesale freight progress

- [x] Checkpoint 1: pure calculations and validation, red/green tests.
- [x] Checkpoint 2: atomic accounting, correction/cancel, sync replay tests.
- [x] Checkpoint 3: forms, ledger display, browser verification and release.

Checkpoint 1 verified 2026-09-07: `npm test` passed 1040 checks across 105
scenarios; `npm run build` passed with existing bundle/import warnings.
Checkpoint 2 verified 2026-09-07: `npm test` passed 1124 checks / 110 scenarios;
`node tests/sync-safety.mjs` and `npm run build` passed. See
`docs/decisions/0001-wholesale-freight.md` for the operation contract and limitations.
Existing-sale details now call the accounting operations through `SaleShipping`.
No live data changes, push or deployment performed.

Checkpoint 3 must add freight labels and details (including zero-debt freight),
hide zero-value storage artifacts, preserve drafts, show effect previews, and
use `addSaleWithShipping` for atomic checkout. Test correction/cancellation,
busy/double-click handling and responsive RTL before release.

Checkpoint 3a complete locally: existing-sale freight form with customer/shop/
split allocation, immediate receipt, box/date/note, correction reason and cancel
confirmation. Ledger labels distinguish freight from opening debt; zero expense
and cash artifacts are hidden. `node tests/shipping-ui.mjs` passed create/correct/
cancel, invalid reimbursement, Dari inputs and 320/768/1024/1440 widths. Screenshot
`qa-shipping-form.png` inspected. `npm test`: 1126 checks / 110 scenarios passed;
`npm run build` passed with existing warnings.

Checkpoint 3b complete locally: optional freight in checkout, working/held-draft
preservation and atomic sale-plus-freight save. Full Sales-page browser test
passed held/resumed checkout, double-click protection, history and read-only
guard. Mobile sale-details screenshot inspected. `npm test`: 1130 checks / 111
scenarios passed; `npm run build` passed with existing warnings.

Still pending: final release. No production data used or changed by these tests.
Release gate 2026-09-07: local sync-safety test passed and GitHub authentication
works; remote main is still 6a87241. `npm audit --omit=dev --audit-level=high`
reports five high-severity groups: brace-expansion, browserslist, fast-uri,
nanoid and postcss. `npm ls` traces them to the existing vite-plugin-pwa build
toolchain. Browser-runtime exploitability has not been established. Review and
patch compatible build dependencies, rerun tests/build/audit, then publish;
do not describe this freight feature as live yet.

Release gate cleared 2026-09-07: compatible updates to the five build packages,
plus tar and @xmldom/xmldom in development tooling, are confined to the lockfile.
Full `npm audit --audit-level=moderate`: zero vulnerabilities. With patched
dependencies, 1130 checks / 111 scenarios, freight UI, local sync-safety and
production build pass. Existing bundle/import warnings remain. No APK built.
Publishing is pending confirmation of the GitHub Pages workflow and live assets.

Published 2026-09-07: bcb219d, GitHub Pages run 34139856638 succeeded.
Public index and index-BMpd1tua.js return HTTP 200; the live bundle includes
freight checkout and existing-sale controls. Historical pending notes above
describe earlier gates, now resolved. No production account/data used for QA.
Users must refresh both devices before using freight; do not reset local data.

Post-deploy browser smoke check: isolated Chrome loaded the public login page
at 320/390/768/1440 widths with no horizontal overflow, console warnings/errors
or failed HTTP responses. Mobile screenshot qa-release-login.png inspected.
Requests outside the app host were blocked; no account login, password reset,
business writes or live authenticated sync was tested. Public service worker
also returns HTTP 200 and references the deployed index-BMpd1tua.js bundle.

## Customer ledger: cancel only the selected sale (2026-09-08)

Implemented a ledger-row button and reason-required preview. Reuses deleteSale
inside a guarded transaction; preserves the tombstone with cancellation reason
and time. Opening debt and independent later payments remain. Rejects a changed
preview, wrong customer, read-only access, missing stock records, linked returns,
freight and special settlement sales rather than cascading from this shortcut.
No live sale was cancelled. No schema migration or APK update.

`node tests/ledger-sale-cancel.mjs` reproduced the missing button before the fix,
then passed real synthetic ledger UI/accounting, audit, double-click, responsive
widths and rejection guards. `npm test`: 1130 checks / 111 scenarios pass.
`npm run build` passes with existing bundle/import warnings. Mobile confirmation
screenshot inspected. Publication pending. If the shortcut has an issue, revert
its feature commit without restoring/resetting data; tombstones/audit remain.
