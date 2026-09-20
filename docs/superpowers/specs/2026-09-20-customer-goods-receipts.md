# Goods received against a customer's debt

## Approved business outcome

Two former debtors settled their receivables by handing over shops/goods. The business now separately owes those former owners a remainder. The shops/goods were handed to a new customer whose receivable is already recorded. Do not recreate or transfer these historical balances. The new customer may hand back goods not previously in this app; an agreed price is set at receipt time. This is not a return against an earlier app sale.

Create a dedicated **دریافت جنس بابت طلب** action in the customer's account. Receipt value reduces only that customer's receivable. Either receive the goods into stock, creating absent products/variants, or sell them onward to another customer without stock movement. Agreed receipt value is acquisition cost, not income or a profit reversal. Onward/later resale recognizes normal revenue and margin. Former owners' payables remain unchanged.

## Scope and safety decisions

- Web/PWA only; no APK work, no live business data edits, no new database table or remote migration.
- Existing ordinary sales, purchases, direct trades, cash, debts and backups retain their meanings.
- One destination per receipt: warehouse or onward sale. Separate receipts can cover mixed destinations.
- Receipt quantity is a positive whole number; agreed unit cost is a positive whole AFN amount; line and document totals must be safe integers. Product/model, size and color are required, photo optional.
- Receipt value cannot exceed the source customer's current positive receivable. An onward buyer must be a different active customer. Onward cash is between zero and resale total; the rest becomes that buyer's receivable. No fictional supplier or purchase is created.
- Record date, note, agreed costs, quantities, destination and identities. Preview shows source debt reduction, stock/cash changes, onward buyer debt and resale profit.
- Support correction and cancellation with reason, retained original documents, explicit links and stale-state protection. Once dependent inventory activity exists, block commercial correction/cancellation with a clear explanation; replenished stock does not make a previously consumed receipt freely reversible. Do not automatically alter unrelated later payments.
- Writes require a separate per-device compatible-version acknowledgement, excluded from backup. All devices must update before use. No server-side version fence is claimed.
- Sync uses UUID identities, not another device's numeric IDs. Missing or conflicting aggregate members cannot appear ready or be edited. Row-wise cloud sync is not an atomic multi-device transaction: update all devices and edit a receipt on one device at a time after sync.
- All tests use isolated synthetic data and block external network. Never run tests/two-device.mjs or tests/restore-two-device.mjs.

## Data design

Reuse existing tables, with additive typed metadata. Anchor the receipt in a Payment with partyType customer, via goods, amount equal to agreed receipt value and cashDelta zero. A manifest identifies child documents by table/UUID plus receipt revision. Warehouse children are positive costed Adjustments. Create absent product/variant masters at zero stock, then apply the adjustment once. Existing weighted costing reads that acquisition cost.

Onward sale is a linked Sale with empty physical lines and a distinct goodsReceiptLines commercial snapshot (not directLines/directTrade, whose existing contract requires a supplier/purchase pair). Its cost is the agreed receipt cost, price is the onward selling price, paid is actual cash. A linked normal cash movement records only actual resale cash. Shared commercial-line readers expose these sales to history, receipts and reports.

Dedicated operations own the aggregate; generic sale/payment/return/shipping mutations reject members. Stable request UUID plus normalized creation fingerprint makes retries idempotent. Transactional reload of roles, balances, state tokens and dependencies prevents local stale writes. Corrections cancel the original aggregate and create a linked replacement atomically, with repeat-call safety and competing-successor detection. Original records remain available for audit.

## Verification examples

1. Customer owes 10,000; receive 2 pairs at 1,000: receivable 8,000, stock +2, cash unchanged, no sales/profit, former owner payables unchanged.
2. Same receipt sold onward at 1,300 per pair, cash 500: source debt 8,000; buyer debt +2,100; cash +500; revenue 2,600, cost 2,000, profit 600; warehouse unchanged.
3. Repeat request changes nothing. Same UUID with a different amount fails. Read-only, invalid quantities/prices, over-receipt and self-onward sale fail without writes.
4. Eligible correction 2 pairs to 3 preserves original and changes only net debt/stock. Cancel restores net effects once. Later stock consumption, including later replenishment, blocks reversal.
5. Two isolated devices with different local IDs converge after shuffled/repeated members, correction and cancellation; incomplete/conflicting groups are blocked. Malformed backup is rejected before tables are cleared. Valid backup preserves audit and links but not device activation.

## Delivery

Implement and verify in feature/customer-goods-receipts, based on the published direct-sales code. Keep the unfinished iOS-redesign worktree unchanged. Publishing/merging is a separate step; do not describe local code as already live.
