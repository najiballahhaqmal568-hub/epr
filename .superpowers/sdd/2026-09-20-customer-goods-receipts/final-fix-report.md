# Final whole-branch review fix report — 2026-09-28

Base: `2466432f3c56a2e492b83ff1dc09c174aec0216a`

Status: implementation and local verification complete; scoped re-review remains pending.

## Changes

- Correction preview now retains and renders the authoritative `previewCustomerGoodsReceiptCorrection` result. The UI separates replacement-document totals from signed net changes to source debt, warehouse stock, cash, buyer debt and profit. Warehouse quantity `2 → 3` renders `+1` rather than `+3`; an unchanged onward cash amount renders `0`.
- Draft validation is strict and visible only after the operator asks for preview. Invalid quantity, acquisition cost, onward selling price, paid amount, buyer, correction reason and date are linked to their fields with `aria-invalid`/`aria-describedby`, while one actionable summary lists the corrections needed. Numeric prefixes such as `1000abc`, fractions, non-positive values and an over-debt total are rejected.
- Source-customer ledger rows preserve item/note text and now identify either `ورود به گدام` or `فروش مستقیم به مشتری دیگر — بدون گدام` as the destination.
- Receipt detail exposes labeled original/replacement audit links using the dedicated receipt-detail view. The existing owner, read-only, stale-preview, idempotency and double-submit protections are unchanged.

## Regression evidence

- `node tests/customer-goods-receipt-ui.mjs` — exit `0`, `PASS 41 checks`. Real forms and actual IndexedDB postings cover strict field-linked validation/actionable summary; warehouse replacement total `3` versus net stock `+1`; onward net source debt `−1000`, stock `0`, cash `0`, buyer debt `+1300`, profit `+300`; actual onward result source `7000`, buyer `3400`, cash `500`, sale `3900`, quantity `3`; both destination ledger labels; and original ↔ replacement navigation.
- `node tests/customer-goods-receipts.mjs` — exit `0`, `PASS 120 checks`.
- `npx tsc -b --pretty false` — exit `0`.
- `npm test` — exit `0`, `1130` checks in `111` scenarios.
- `npm run build` — exit `0`, `209` modules transformed; service worker generated with `15` precache entries.
- `git diff --check` — exit `0`; only the repository's standard LF/CRLF conversion notices were emitted.

All browser/accounting checks used disposable local IndexedDB and localhost-only request blocking with process-local `NODE_OPTIONS=--dns-result-order=ipv4first` and `TEMP`/`TMP=D:/CodexTemp/customer-goods-receipts`.

## Remaining limits

- Verification is local and synthetic. No live Supabase/business data, cloud two-device script, production deployment, push, merge or publish was used.
- The pre-existing Vite mixed static/dynamic import notices and large-chunk warning remain; this wave does not change bundling.
- The previously documented absence of a server-side version fence/atomic multi-row cloud transaction remains an architectural limit; client-side readiness/conflict/stale-token guards are preserved.
- A scoped read-only re-review of this final wave is still required before the branch is considered ready to land.
