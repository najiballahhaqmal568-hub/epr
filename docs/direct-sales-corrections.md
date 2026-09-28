# Direct sales — correction and cancellation

Approved in the 2026-09-08 design (§ Operations, corrections and cancellation) and
re-confirmed by the owner on 2026-09-28. Code: `src/lib/directTradeCorrections.ts`.

## Owner workflow (جزئیات فروش مستقیم)

- **اصلاح معامله** — change goods, quantity, cost, price or date with a reason.
  Preview shows the change to customer debt, supplier debt and profit; confirm, then save.
  Customer and supplier never change. A total below money already received/paid is refused:
  correct the wrong payment first.
- **اصلاح یا لغو این پرداخت** — change amount/date/note (and the sarraf share of a
  supplier payment) or cancel it, with a reason. The route never changes.
- **لغو معامله** — only for a mistaken entry, not a real return. Customer and supplier
  debt and the trade's profit leave the books; real payments stay (the customer may end
  with a credit, the supplier may owe the shop). Active freight must be cancelled first.
  After cancellation only erroneous payments can still be cancelled.

Owner-only (`cachedProfile.role === 'owner'`), not read-only, direct feature enabled,
fresh sync before preview, and the preview token must still match when saving.

## Document contract

- Trade correction updates both halves in place with a new `revision`,
  `previousRevision` = old revision, and appends the old date/lines/reason to
  `directTrade.corrections`. Effects of the old documents are reversed and the new
  ones applied once through `effectsOf`.
- Cancellation marks both halves `deleted: true`, `directTrade.status: 'cancelled'`,
  `cancelledAt`, `cancelledReason`, with a new revision. Integrity folds only live
  documents, so debt and profit disappear; ledgers show a zero-amount audit row.
- Payment correction tombstones the original (`deleted`, `correctedByUuid`), keeps
  its cash row, appends a reversal cash row (`directPaymentReversalOfUuid`, amount
  = −original cash), and inserts the replacement (`correctionOfUuid`,
  `correctionReason`, `correctionPrevious`). Cancellation tombstones with
  `cancelledReason`/`cancelledAt` and appends the reversal only. Money coming back into
  the till is posted before money going out, so only the net must be covered.
- Deterministic UUIDs (`stableUuid`) for revisions, replacements and reversal rows make
  retries converge on every device.

## Evidence

- `tests/direct-trade-correction-checks.ts` (in `node tests/direct-trade.mjs`, 31 cases):
  net previews write nothing; golden correction/payment/cancellation balances; caps,
  reasons, stale tokens, non-owner, read-only, till shortage, freight guard; integrity
  and backup validation after every write. Proven red by removing one effect reversal.
- `tests/direct-trade-correction-sync.mjs`: two devices with different local IDs; after
  create, correct, payment replace and cancel, device B matches device A exactly and a
  repeated replay changes nothing.
- `tests/direct-trade-correction-ui.mjs`: the owner's screens end to end, staff hidden,
  cancelled audit row in the customer ledger, 320px with large text.
