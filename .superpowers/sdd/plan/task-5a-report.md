# Task 5a — sale history, detail and customer documents

Base: a2f31cf. Five production files only: Sales.tsx, SaleHistory.tsx, Receipt.tsx, InvoiceModal.tsx and index.css. No accounting operation, source query, schema, sync, durable draft or direct-trade implementation changed. Controller-owned tasks/plan.md and docs/ios-redesign-verification.md are preserved and excluded from this commit.

## Outcome and action inventory

- History has a separate labeled filter surface and date groups with opaque totals, compact customer/amount/status rows, full commercial goods text and a clear detail affordance. Today defaults open; previous groups remain accessible. Search, inclusive date range, reset, invalid range, loading and empty states remain. No row limit; deleted/lender exclusions and commercialSaleLines reader remain unchanged.
- Ordinary detail separates customer/date, goods, stored totals, customer documents, existing freight management, and return/exchange/delete actions. Receipt and invoice remain available read-only; mutation actions retain the existing !accessFlags.readOnly condition. Shipping still owns its existing wholesale/customer/UUID visibility and add/correct/cancel guards. Delete still uses deleteSaleImpact, linked-return/cash warnings, confirmation, busy guard and deleteSale. A cancelled synthetic confirmation leaves every sale unchanged.
- Direct rows retain their own commercial lines, direct label and DirectTradeDetail UUID routing. They do not display false debt from base paid=0; no ordinary correction, return, exchange or delete destination was added. Existing owner acknowledgement/form, staff restrictions, pending locks and direct detail code are untouched.
- Sales new/list/held/statistics routing remains; selected tab uses the existing blue action token. Held resume/delete confirmation, local-only draft behavior, just-saved undo/receipt/invoice/next-sale, pending fieldset and checkout stage visibility are unchanged. ReturnModal and ExchangeModal are untouched for Task5b; their destinations are exercised without submitting.
- Receipt retains PNG generation, native file share, fallback download, close and optional next-sale. Sharing is disabled while the PNG is loading. Image goods names and arithmetic occupy separate lines; names use canvas maxWidth to stay within the image. No cost or profit is included. White/blue customer-document styling uses existing tokens; amounts stay opaque. Mobile invoice presents all five labeled fields without a horizontally clipped table.

## Confirmed customer-display fixes

NewSaleModal computes subtotal minus discount before posting total (lines 201–203 at inspection); addSale rounds/stores that net total. Existing image receipt already used total + discount for goods subtotal and total for payable. Invoice text incorrectly subtracted the discount again. The customer-facing text, printed document and on-screen invoice now consistently display stored subtotal reconstruction, discount, stored net payable, paid and remaining debt. No historical records or business balances are recalculated.

Print HTML previously interpolated customer and goods names directly. They, and the document title, now escape HTML characters at the string-generation boundary. React and canvas remain text renderers. The fixture uses literal `<b>` and `<i>` text and verifies the printed DOM contains the literal names, not injected elements. No generalized document-generation abstraction was introduced.

## Verification and RED/GREEN

All browser work used disposable Playwright contexts and installed Edge via CHROMIUM_PATH. External transport is aborted in the UI runners; synthetic records never enter a production account. Print is intercepted on the local iframe and native share is intercepted at navigator.share, never sent.

| Command | Result |
| --- | --- |
| node tests/sale-history-e2e.mjs — initial discounted fixture | RED: expected payable 900 but observed 800, with stored total900/discount100/paid400. |
| node tests/sale-history-e2e.mjs — final | PASS: 150 previous-day rows and exact1500 total, today open/past collapsed, toggles/search/inclusive range/reset/empty/invalid range, actual ordinary receipt/invoice/return/exchange destinations, cancelled delete unchanged, real direct history routing and no false base debt, all sync-table snapshot unchanged by direct navigation, read-only detail retains documents but no mutation buttons or cost, responsive history/detail/invoice, customer-safe discounted text/print and literal HTML-like names, real canvas net/paid/debt and no cost, PNG share/download and optional next-sale/close. No page errors. |
| node tests/sale-history.mjs | PASS: date boundaries, newest-first, inclusive range, Persian-digit/name/goods search, >100 complete totals, lender/deleted exclusion, no mutation. Repaired pre-existing data-URL runner dependency wiring for commercialLines; assertions unchanged. |
| node tests/ledger-sale-cancel.mjs | PASS: only selected sale debt/stock reversed; later receipt/opening debt/audit retained; reason/read-only/stale/customer/linked/return/freight guards and double-click behavior. Runner now honors CHROMIUM_PATH. |
| node tests/direct-trade-ui.mjs | PASS: actual direct Sales entry/form, local exact cash/debt/stock effects, receipt privacy, later payment and staff cost privacy. Source unchanged. |
| npm test | PASS: 1130 checks across111 scenarios. Run once at slice end. |
| npm run build | PASS: TypeScript,199 Vite modules, PWA. Run once at slice end. Existing db/sync mixed-import and >500kB chunk warnings remain; main JS1093.72kB. |
| git diff --check | PASS; only repository CRLF conversion notices. |

The history browser runner's initial navigation was adapted to Home → Sales. Its cancelled-delete assertion initially raced the async native confirmation; it now awaits dismissal then closes the detail explicitly. A repeated run exposed an async PNG-blob/share assertion race; the fixture now awaits the captured share payload. These runner issues required no production guard changes. Net-payable regression has observed RED/GREEN evidence; print escaping has direct behavioral GREEN coverage, not a separate observed RED run.

## Visual evidence and limits

Screenshots are local, not staged, in `.superpowers/sdd/plan/task-5a-screenshots/`: history390/1440, history320/768 with20px root font, detail390/1440/320/768, invoice390/1440/320/768, receipt390/1440. Viewed populated history390/1440, enlarged history768, enlarged detail320, enlarged invoice320 and receipt390. Layout overflow assertions pass at320/390/768/1440, including enlarged root font at320/768 for history/detail/invoice. The native date fields remain labeled; at narrow320 they stack. All invoice fields stay visible rather than clipping columns. Ordinary detail shipping visibility uses unchanged source conditions; existing shipping regression coverage runs in npm test.

No live account/device, real printer or external message was used. Native share/print integration on physical phones/printers and arbitrary extreme-length raster text are not claimed as verified. Image receipt remains a fixed-resolution raster as before, with bounded-width text; no new pagination system. S10 statistics and D04/D05 reader/sync/backup code are unchanged, not exhaustively re-tested as separate UI flows in this slice. Return/exchange restyling remains Task5b. No broad new test family, CSS-source assertions, dependency install, network mutation, push or publish.
