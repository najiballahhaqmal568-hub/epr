# Direct sales — first web release

## Owner workflow

1. Refresh the web app/PWA on **every active phone and computer**. Do not clear data or re-import a backup to update.
2. Open Sales → «فروش مستقیم». Read and confirm the per-device upgrade acknowledgement. This is manual, not a server version fence.
3. Select existing customer and supplier. Enter goods, quantity, purchase cost and sale price. These goods never enter or leave warehouse stock.
4. Enter any initial customer receipt, supplier payment (cash and/or sarraf), or customer payment directly to the supplier. Review the remaining amounts and confirm once.
5. Open the direct trade from Sales, Purchases, or the customer/supplier account. Record subsequent payments against that trade. Trade remainder and overall account including previous debt are shown separately.
6. Share the customer receipt; purchase cost/profit are not included. Existing freight entry is available after creating the trade.

Only the cash part changes the selected cash box; customer-to-supplier payment changes both debts without cash movement. Sarraf credit is used before additional debt. Profit belongs to the sale date, not subsequent payment dates.

## First-release limits

- Advanced correction, cancellation and return are deliberately unavailable. Review values before saving; do not attempt a one-sided delete from an account. Existing ordinary transactions keep their existing controls.
- Incomplete/conflicting direct trades block payment and receipt actions; retry sync and investigate instead of importing data again.
- Customer receipts support text sharing/copying. The premium redesign and richer receipt presentation are separate follow-up work.
- No production transactions were created for verification. Local tests use synthetic data and fake transport; they do not prove production networking/RLS or every physical device's refresh state.
- This release does not add a server-enforced compatibility or multi-device atomic transaction fence. Do not use old clients after activation.

## Safe recovery

Once direct records exist, retain compatible readers/effects/guards in any subsequent build. Do not deploy the old pre-feature app or delete records as a rollback. Stop direct entry, retain backups, and ship a compatible fix if an issue occurs. No schema migration or data reset is required for this release.
