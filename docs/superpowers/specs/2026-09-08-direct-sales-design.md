# فروش مستقیم — طرح برای تأیید نهایی

Status: business behavior and this technical design approved by the owner in chat
on 2026-09-08. Implementation planning is authorized.
No implementation, production changes, migration or publication in this document.

## خلاصه برای مالک

- یک معامله با مشتری و فروشندهٔ مشخص؛ جنس مستقیم به مشتری می‌رسد.
- مشخصات جنس، تعداد، قیمت خرید و فروش ثبت می‌شود؛ گدام تغییر نمی‌کند.
- دریافت از مشتری، پرداخت به فروشنده و پرداخت مستقیم مشتری به فروشنده،
  هنگام ثبت یا بعداً، جدا یا ترکیبی ثبت می‌شوند.
- پرداخت مستقیم مشتری، هر دو قرض را کم می‌کند و صندوق را تغییر نمی‌دهد.
- مفاد در راپورهای همان تاریخ معامله حساب می‌شود؛ پرداخت بعدی مفاد تازه نیست.
- کرایه جدا ثبت می‌شود؛ فقط سهم دکان از مفاد کم می‌شود.
- اصلاح سند با دلیل و سابقه است. ابطال معامله، پول واقعی پرداخت‌شده را
  خودکار برگشت نمی‌دهد؛ ابتدا اثر باقی‌ماندن پرداخت‌ها نمایش داده می‌شود.
- مبلغ بیشتر از باقی‌ماندهٔ معامله رد می‌شود؛ اضافه به قرض قبلی نسبت داده نمی‌شود.
- نسخهٔ اول برای معاملهٔ انجام‌شده است، نه سفارشِ هنوز تحویل‌نشده یا مرجوعی واقعی.
  ابطال اشتباه با مرجوعی جنس فرق دارد.

## Outcome and acceptance evidence

Record a purchase/resale fulfilled supplier-to-customer without stock transit,
with one identifiable trade, two party balances, explicit payment routes and
explainable profit. Success means stock quantity, weighted costs and unrelated
documents stay identical before/after create, settle, correct, cancel and replay.

Confirmed: this is resale for profit, not commission; customer and supplier are
existing account parties; payments can be mixed and can occur later. No APK.
Proposed boundaries: one supplier and one customer per trade, completed delivery
only, manual item snapshots or copying catalog descriptions without stock writes.
One trade may include multiple models/sizes/colors. Purchase and sale share the
same quantities. Separate trades handle separate suppliers.

## Verified source constraints

- `src/lib/ops.ts:addSale/addPurchase` directly change warehouse quantities;
  purchasing also changes weighted cost. Calling them consecutively is not safe
  for this requirement even when the final stock delta would be zero.
- `src/lib/effects.ts` is shared by replay/integrity; stock and balances must not
  have a separate contradictory definition in the new flow.
- `src/lib/costing.ts` traverses purchase/sale lines to reconstruct warehouse
  costs. Direct goods must never enter that event stream.
- `src/pages/Reports.tsx` reads sales, costs and payments independently; its
  current collected amount sums customer payments, not necessarily actual cash.
  A direct-to-supplier receipt cannot be labeled shop cash.
- `src/lib/sync.ts` translates local IDs to UUIDs and applies documents per row;
  it does not atomically commit a multi-document trade on all devices.
- `docs/sync-safety-review.md` and ADR-001 document replay/restore and concurrency
  limits. Existing `groupUuid` has lender settlement deletion semantics; do not
  reuse it for direct trades.

## Alternatives and chosen approach

1. Recommended: dedicated operations and UI, backed by marked, UUID-linked
   purchase/sale/payment documents in existing synced tables. Reuse account
   effects, reports, backups and cash rules while keeping physical stock separate.
2. Ordinary purchase followed by ordinary sale: less code, but changes weighted
   cost, needs stock availability and can leave a half-posted trade. Rejected.
3. New remote trade and settlement tables: clean isolation, but needs coordinated
   backend migration and duplicate integrations for reports/restore/accounts.
   Not justified unless tests disprove safe reuse of existing document transport.

## Document contract

- Add explicit `directTrade` metadata to the linked Sale and Purchase. It holds
  a stable trade UUID, matching revision and counterpart document UUID. Do not
  infer direct fulfillment from `received`, zero stock, names or old notes.
- Store goods in `directLines` snapshots: line UUID, model, size, color, positive
  integer quantity, purchase unit cost and sale unit price. Ordinary warehouse
  `lines` remain empty on these documents; no fake variant IDs and no implicit
  product/variant creation. Copying catalog data is read-only.
- A shared commercial-lines accessor supplies direct snapshots to display,
  reporting, receipts and item counts. Warehouse costing/effects continue to
  consume only stock lines. Direct unit cost is its own purchase price snapshot,
  never a lookup of today's warehouse cost.
- Purchase total is C and sale total is S; both initial `paid` values are zero.
  All payments, including those entered at creation, are separate event documents.
  Account and detail UI derive settlement from linked events, not `sale.paid`.
- Ordinary payment events use a distinct direct-trade reference and event kind.
  Supplier payments reuse box/sarraf split semantics, including consuming credit
  at the sarraf before showing debt. Never create a second posting of the same cash.
- Customer-to-supplier payment is ONE Payment with the customer as primary party,
  explicit supplier reference, positive amount and cashDelta zero. Extend shared
  effects to reduce both party balances from that document. A supplier ledger
  includes this event despite its primary party being the customer. Encode/decode
  the second party by UUID; unresolved references cannot use the sender's local ID.
- Generic edit/delete/return/exchange/receive-purchase actions reject marked
  direct documents and point to direct-trade management. No one-sided mutation.

## Accounting rules (application contract)

Let C = goods purchase total, S = goods sale total; R = customer paid to shop;
D = customer paid supplier directly; P = shop/sarraf paid supplier for this trade.

| Event | Customer debt | Supplier debt | Shop cash | Goods profit |
|---|---:|---:|---:|---:|
| Create completed trade | +S | +C | 0 | S-C |
| Customer cash to shop R | -R | 0 | +R to chosen box | 0 |
| Customer direct to supplier D | -D | -D | 0 | 0 |
| Shop cash to supplier P | 0 | -P | -P from chosen box | 0 |
| Shop via sarraf P | 0 | -P | only cash split | 0 |

Remaining goods customer debt = S-R-D; supplier debt = C-P-D. Customer freight
share and reimbursements remain separately labeled under the existing freight
contract, not folded into shoe prices. Per-trade balances are separate from the
parties' overall balances, which may also contain opening debt and other trades.

Example: C=10000, S=12000, R=3000, D=7000, P=0 => customer remaining 2000,
supplier remaining 3000, cash +3000, goods profit 2000, stock/cost unchanged.
Later customer pays supplier 1000 => remaining 1000 and 2000 respectively;
cash and profit unchanged. Cash receipt 1000 and shop payment 2000 settle both.

Money uses existing whole-AFN validation; quantities must be positive integers,
dates valid, sums finite and safe. A below-cost sale is permitted with an explicit
loss warning, consistent with normal sales. Validate each payment against the
corresponding trade remainder; D cannot exceed either remainder. Validate mixed
payments as one batch inside the transaction. Do not consume an unrelated account
credit or allocate an unlinked old receipt automatically. Such receipts remain in
the party ledger and are labeled unallocated to this trade.

## Operations, corrections and cancellation

- Create both commercial documents and optional initial payment/freight bundle
  in one local transaction with a retry/idempotency key. Preview never writes.
- Append a later payment with its own UUID/date/route and affected-balance preview.
  Payments do not edit historical base sale/purchase totals or profit.
- Correct goods/date/prices as a coordinated revision of both documents, with
  previous snapshots/reason/time preserved and effects reversed/reapplied once.
  Customer/supplier cannot change after financial events exist. Reject new totals
  below already allocated payments; direct the user to correct erroneous payments
  first. Ordinary warehouse prices are not rebuilt from these lines.
- Correct/cancel an erroneous payment as one financial event, reversing its full
  effects, retaining reason and original/replacement links. A direct-to-supplier
  correction reverses both parties with no cash. Cash correction preserves the
  original cash history and appends its explicit reversal, using existing rules.
- Cancel an erroneous trade reverses C and S and its reported profit, retaining
  all actual payment events and their cash effects. Preview resultant customer
  credit/supplier credit where relevant; never silently refund real money or erase
  later payments. Closed/cancelled trade accepts no new allocations. Erroneous
  payments can still be corrected/cancelled from its retained audit detail.
- Active freight must be reviewed separately before cancellation, consistent with
  existing freight safeguards; cancelling goods is not a carrier refund.
- Real partial returns, pending delivery and commission transactions are not
  disguised as corrections. The first release disables ordinary stock-return
  actions for direct trades and explains the unsupported flow.

## User flow

Sales offers `فروش مستقیم` without crowding normal cart checkout. One form selects
customer/supplier, date and items (one shared price across sizes supported). A
collapsed payments area has separate shop receipt, shop supplier payment and
customer direct payment. Optional freight uses the existing allocation choices.
Summary shows goods profit, both remaining debts, and actual cash movement before
`ثبت معامله`. Details have later payment, correction and cancellation controls.
Customer/supplier ledgers, purchase/sales history and receipts link back to the
same trade and use a visible direct-sale label. Customer receipts never reveal
purchase costs or margin. Existing normal-sale flows remain unchanged.

## Sync, compatibility and release gates

Use stable trade/event UUIDs, never local refId for cross-device identity.
Missing counterpart or mismatched revisions show an incomplete/conflict state;
block financial mutations and avoid presenting partial reports as final. After
complete replay, shared effects and integrity must converge independent of local
IDs and replay repetitions. Unresolved references must defer application without
advancing their cursor past unapplied data.

Existing per-row sync is not global locking. Distinct later payment UUIDs preserve
separate events; concurrent offline allocations can collectively exceed balances.
Detect and show that conflict after sync; never drop events or claim global caps.
Same-document corrections use stale-revision checks and stable revision identity;
test conflict orders, cancellation versus payment and partial downloads explicitly.

Older clients do not understand direct payments or commercial lines. Feature must
remain disabled until all active business devices use the compatible release.
Fresh sync is required before corrections/cancellation. Mixed-client behavior and
backup roundtrips are release gates, not an assumption that additive fields suffice.
No live data rewriting/reset or schema change is authorized by this design. If
server-enforced compatibility is required by testing, propose that change and get
approval before deploying it; do not weaken sync security to bypass the gate.

## Verification before implementation is declared complete

1. Golden example above, mixed cash/sarraf, all-credit and all-cash scenarios.
2. Snapshot stock quantities, weighted costs and previous sale margins; exact
   equality after all trade/payment/correction/cancellation operations and replay.
3. Single source effects: operations, ledgers, integrity, net worth and day/month/
   year reports agree. Profit posted once; later receipts are not new revenue.
4. Later direct payment reduces both parties once with zero cash; other customer
   accounts, opening debts and independent receipts remain untouched.
5. Local rollback on insufficient cash, bad numbers, missing parties, stale
   preview, read-only permissions, missing counterpart and double clicks.
6. Backup import/export, two isolated device databases with different local IDs,
   repeated/out-of-order/partial replay, corrections and conflicting payments.
7. Actual direct-sale UI in isolated browser, mobile/desktop layouts, receipt
   privacy, cancel confirmation and distinction of trade versus overall balance.
8. Full existing tests/build/audit before publication. Never use production
   accounts, customer transactions or backups as test fixtures; no APK.

Release only after all gates pass. Rollback before any direct records exist may
revert the feature; after records exist, retain readers/effects/guards and disable
new direct mutations or deliver a forward fix. Do not downgrade clients blindly.

## Review and next step

Self-review: no implementation placeholders; scope, event ownership, stock
separation, correction/cancellation behavior and compatibility risks are explicit.
This document is a design, not evidence that new behavior has passed tests.
After owner review, create an implementation plan with test-first checkpoints:
document/effects contract, local operations, replay/restore, ledgers/reports, then
UI and release. No partially compatible financial feature may be published.
