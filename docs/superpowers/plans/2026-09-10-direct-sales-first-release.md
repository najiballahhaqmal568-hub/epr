# Direct sale first web release — approved scope

The owner approved a smaller first release on 2026-09-10 because direct sales are needed now. This supersedes the delivery sequence of the September 8 plan, not its accounting invariants.

## Included

- Creation of paired non-stock purchase/sale documents.
- Customer-to-shop, shop/sarraf-to-supplier, and customer-to-supplier payments, initially and later.
- Separate customer/supplier remaining trade amounts and total account balances.
- Accurate line display, daily/monthly/yearly profit, account ledgers and customer-safe receipts.
- Existing freight workflow; never count its expense twice.
- Generic edit/delete/return guards, explicit temporary correction/cancellation unavailability.
- Visible blocked/incomplete state, portable backup preservation and release compatibility acknowledgement.

## Deferred by owner approval

Advanced coordinated correction/cancellation, expanded fault-injection testing, optional catalog-copy/common-size editor, and the visual redesign. No APK work.

## Delivery checklist

- [x] Math, effects, state, UUID replay and atomic posting (prior tasks 1–4).
- [x] Complete generic guards (5a).
- [x] Integrate commercial readers, reports, account links and safe receipts.
- [x] Add existing-style creation/detail/payment UI and explicit per-device upgrade acknowledgement.
- [x] Essential isolated accounting/UI/replay/backup smoke, repository tests and production build.
- [ ] Publish web through existing GitHub workflow and verify deployment revision/assets.
- [ ] Owner refreshes all active devices before enabling direct mutations; no reset/import needed.

Publishing code and enabling financial mutations are distinct. Local acknowledgement is not server-enforced old-client protection. No production transactions are test data. No database schema/access changes are authorized. After direct records exist, retain readers/effects/guards even if new writes are disabled.

Owner confirmed they will refresh every active device after publication. The initial release can expose an owner-only acknowledgement requiring that refresh to be completed before enabling writes locally. Do not silently enable during deployment or import that acknowledgement from a backup. This replaces the old plan's prohibition on a local release UI, while retaining the explicit warning that it is not server-enforced protection.
