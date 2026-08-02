# Shoe Shop ERP — working notes

Offline-first Dari/RTL ERP for a real shoe shop in Afghanistan (فروشگاه اتل).
The owner is **not a developer** and does not read English. Every user-facing
string, error message and label is Dari. Explanations back to the user are in
Dari too, with plain shop vocabulary (گدام، صندوق، جوړه، مفاد، قرض) rather than
accounting jargon.

## The one rule that matters most

**This app holds the real money of a real business.** A wrong number is worse
than a missing feature. When in doubt, refuse to write the number rather than
write a guess — and never "fix" a mismatch by overwriting a stored value
without an accompanying document that explains it.

## Architecture

React 18 + Vite 6 + TypeScript (strict, `noUnusedLocals`/`noUnusedParameters`)
· Tailwind 4 · Dexie 4 (IndexedDB) with `useLiveQuery` · vite-plugin-pwa ·
Capacitor 8 for the Android APK · Supabase for optional sync.

- `src/db.ts` — schema and types. Adding an optional field needs no version bump;
  it travels inside the doc's jsonb payload automatically.
- `src/lib/ops.ts` — every transactional write. Business rules live here, not in
  components.
- `src/lib/sync.ts` — `applyDocEffects` replays documents on a remote device.
- `src/lib/integrity.ts` — rebuilds stored numbers from documents to catch drift.
- `src/pages/*` — one folder per tab; modals split into their own files.

### Money

Integer afghani only. `afn()` rounds at **every write boundary**; `allocate()`
splits a total across weights by largest remainder so parts always sum to the
whole. Never store fractional currency.

### Derived values are never synced as absolutes

`variant.stockQty`, `customer.balance`, `supplier.balance` are **rebuilt from
document replay**, never copied device-to-device. Masters (products, names,
prices) are last-write-wins. If you change how a document affects stock or a
balance, you must change it **identically in three places**:

1. `src/lib/ops.ts` (the local write)
2. `src/lib/sync.ts` `applyDocEffects` (the remote replay)
3. `src/lib/integrity.ts` (the rebuild-and-compare check)

Getting this wrong causes silent double-counting that only appears on a second
phone. It has happened once already (in-transit purchases counted both the
purchase and the receive adjustment). The rule that fixed it: a purchase bumps
stock **only when `received === undefined`**.

### Moving stock without breaking the books

Any operation that shifts quantity between variants (e.g. merging duplicate
products) must write **two adjustment documents** — negative at the source,
positive at the destination. Otherwise `runIntegrityCheck()` will flag the
result and a second device will rebuild different numbers.

### Partnership accounting

The identity is `دارایی = سرمایه + مفاد − برداشت‌ها`. On the day the year starts,
profit must be **exactly zero** — so the owner's capital is always computed as
`دارایی خالص − سرمایهٔ شرکا`, never typed by hand. Any place that lets a human
type their own capital is a bug waiting to happen (this caused a false
−۱۰۰,۰۰۰ loss once). Every draw (`withdrawal`, `homeExpense`, `personalExpense`)
must carry a `partnerName`, or it silently comes out of everyone's share.

## Verification — required before anything ships

```bash
npm run build     # tsc -b + vite build, must be clean
npm test          # tests/checks.ts — currently 296 checks in 43 scenarios
```

`npm test` runs the real ops against a real IndexedDB in headless Chromium.
Every change to `src/lib/ops.ts` needs a scenario. When a test disagrees with
the app, **check the arithmetic by hand before assuming the app is wrong** —
several times the test was the thing that was wrong.

For UI work, also drive it in a real browser:

```bash
npx vite preview --port 4173         # base is './' → serves at /, NOT /epr/
node tests/merge-e2e.mjs             # pattern to copy for new e2e tests
```

Playwright: `executablePath: '/opt/pw-browsers/chromium'`, `args: ['--no-sandbox']`.
The IndexedDB name is `shoeErp`. Nav buttons need `nav >> text=فروش` — a bare
`text=فروش` matches the dashboard card instead.

## Traps that have already cost time

- **Never `git clean -fd` in this repo** — it deletes `node_modules`.
- **Never commit `dist/` to `main`.** Use `&&`, not `;`, when chaining a
  `git checkout` with anything destructive — a failed checkout followed by `;`
  once committed a build onto `main`.
- `gh-pages` has its own `.gitignore`; always deploy from a **fresh clone in
  /tmp**, never by switching branches in the working tree.
- Persian/Arabic text does not match `\b` in JavaScript regex. Split on spaces
  and compare tokens instead.
- The test helpers are typed: `eq()` compares **numbers**, `is()` compares
  anything by `===`. Using `eq` on strings silently fails.
- A cash purchase from an empty till is correctly refused. Seed cash first in
  tests rather than "fixing" the guard.

## Deploying

See `.claude/skills/deploy/SKILL.md` — run it with `/deploy`. It covers the full
sequence: build → test → commit → push branch + main → sync/build/sign the APK →
publish web + APK to `gh-pages` from a fresh clone → verify the live bundle hash
→ send the APK to the user.

Branch for development: `claude/shoe-erp-mobile-app-wb82ej` (kept in sync with
`main`). Do not open a pull request unless the user asks.
