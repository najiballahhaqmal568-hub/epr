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

### Attribution must be stored, never re-derived from a mutable field

If a total accumulates across several calls (`landingCost`) but the field that
says *who it belongs to* holds only the latest call (`landingVia`), then any
rule that reads "the whole total belongs to whoever `via` names" is wrong the
moment a second call uses a different `via`. Store the attributed portion
explicitly (`landingSarrafAmount`) and expose **one shared reader**
(`landingSarrafOwed()` in `src/db.ts`) that all three places import — a shared
reader is the only thing that actually prevents the three from drifting.

### Cost is derived too — never patched incrementally

`variant.purchasePrice` is a weighted average, so it depends on the *order* of
events. Two devices only agree if both compute it the same way, so it is
**rebuilt from documents** (`src/lib/costing.ts` → `applyRebuiltCosts()`) at the
end of every operation that changes the document set: purchase, receive,
landing cost, merge, and sale deletion. Do not hand-adjust it — an incremental
patch and a replay disagree whenever two documents share a timestamp, or when a
document is later deleted.

If an operation moves stock in at a cost that no purchase document explains
(merging duplicates), the adjustment document must carry `unitCost` so the
rebuild can reproduce the same average.

### Derived values are never synced as absolutes

`variant.stockQty`, `customer.balance`, `supplier.balance` are **rebuilt from
document replay**, never copied device-to-device. Masters (products, names,
prices) are last-write-wins.

Every rule about how a document changes those numbers lives in **one place**:
`src/lib/effects.ts` → `effectsOf(table, doc)`. `sync.ts` applies those effects,
`integrity.ts` folds them, and the fuzzer checks that `ops.ts` arrived at the
same answer. Change a rule there and all three follow. Do **not** restate a rule
inside `sync.ts` or `integrity.ts` — that duplication is what caused both money
bugs this project has had (in-transit purchases counted twice, and landing cost
attributed wholly to the last `via`).

`ops.ts` still writes locally (it also does guards, cash movements and
transactions), so it is the one place that can drift. The fuzzer is what holds
it honest — it compares stored numbers against `effectsOf` after every step.

A purchase bumps stock **only when `received === undefined`**. Creating a
purchase already marked `received: true` is refused, because such a row's stock
would come from neither the purchase nor a receive adjustment.

### Creating stock

`ops.addVariant()` and `ops.setOpeningStock()` are the only ways a component may
put stock into a variant. Both write the adjustment document, refuse a negative
quantity, assign the `sku`, and rebuild costs. Never write `stockQty` straight
from a form — three forms used to do that and none of them got the guard.

### Moving stock without breaking the books

Any operation that shifts quantity between variants (e.g. merging duplicate
products) must write **two adjustment documents** — negative at the source,
positive at the destination. Otherwise `runIntegrityCheck()` will flag the
result and a second device will rebuild different numbers.

### Partnership accounting

All of it lives in `src/lib/partnership.ts` — `startYear()`, `addPartner()`,
`setPartnerCapital()`, `settleYear()`. Never write `capital`, `share`, or
`partnershipStart` straight from a component: the guards and the transaction
are in the module, and a UI-only guard is bypassed by every other path.

The identity is `دارایی = سرمایه + مفاد − برداشت‌ها`. On the day the year starts,
profit must be **exactly zero** — so the owner's capital is always computed as
`دارایی خالص − سرمایهٔ شرکا`, never typed by hand. Any place that lets a human
type their own capital is a bug waiting to happen (this caused a false
−۱۰۰,۰۰۰ loss once). Every draw (`withdrawal`, `homeExpense`, `personalExpense`)
must carry a `partnerName`, or it silently comes out of everyone's share.

## Verification — required before anything ships

```bash
npm run build     # tsc -b + vite build, must be clean
npm test          # tests/checks.ts — currently 353 checks in 50 scenarios
```

```bash
npm run fuzz -- 20 200        # 20 random shops × 200 operations each
npm run fuzz -- 5 150 42      # runs, steps, starting seed — seeds are reproducible
```

The fuzzer (`tests/fuzz.ts`) drives random shop operations and after **every
step** asserts: `integrity.ts` agrees with the stored numbers, a full document
replay through `sync.ts` rebuilds the *same* numbers, `purchasePrice` matches
the documents, net worth agrees from two directions, no stock or cash box goes
negative, and every amount is a whole afghani. It found the
landing-cost attribution bug that 43 hand-written scenarios missed. Failures
print the seed, step, and last operations, so they replay exactly.

Before trusting a green fuzz run, prove the loop can still go **red** — break a
rule on purpose (e.g. change the purchase stock rule in `sync.ts`) and confirm
it fails within a few steps.

`runIntegrityCheck()` compares stored stock, balances **and** `purchasePrice`
against the documents. `fixMismatch()` can repair any of them.

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
