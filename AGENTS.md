# Working on this ERP

This is an active Dari/RTL shoe-store business. Improve UX, maintainability,
and agent-readable tests together; preserve accounting behavior and records.
The user wants the web/PWA updated, not the Android APK.

- Use synthetic data and isolated browser profiles for tests. Production
  accounts, backups, and devices are not test fixtures. Inspect test scripts
  before running: `tests/two-device.mjs` and `tests/restore-two-device.mjs`
  contact a real Supabase project and create remote accounts.
- Before sync or restore changes, read `docs/sync-safety-review.md` and run its
  local regression. Before financial changes, read `CONTEXT.md`, reuse
  `src/lib/ops.ts` / `src/lib/effects.ts`, and test stock, cash, debt, and audit
  history together. Corrections must retain a trace of the original record.
- Keep changes small and independently reversible. Run the repository tests
  and build before publishing; report limitations rather than claiming an
  untested production flow is safe. Preserve unrelated working-tree changes.
