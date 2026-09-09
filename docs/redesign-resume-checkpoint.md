# Redesign resume checkpoint — 2026-09-09

Owner priority: complete direct supplier-to-customer resale first, then resume the approved redesign without losing features.

- Branch: feature/ios-redesign, shared foundation reviewed through 113e7eb.
- Shared controls/styles: 51 focused checks, full 1130 checks/111 scenarios, build passed. Chromium-only; broad app parity still pending.
- Next: task2 navigation/dashboard. Incomplete uncommitted local-app/navigation test files are retained in this worktree. No task2 production changes yet.
- Remaining UI plan: tasks/plan.md; feature contract: docs/ios-redesign-feature-coverage.md; detailed local ledger: .superpowers/sdd/plan/progress.md.
- Before resuming: integrate completed direct-sale branch, extend feature contract to its implemented routes/readers/guards, preserve all accounting behavior. Never replace direct-sale changes with older redesign versions.
- No redesign deployment, production data change or APK update has occurred.
