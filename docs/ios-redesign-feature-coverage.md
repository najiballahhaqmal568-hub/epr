# iOS-inspired redesign: feature preservation contract

Approved visual direction: owner approved the sales, dashboard, inventory and accounts image samples, then required that no feature be left out (2026-09-08).

Status: source inventory and proposed navigation map, NOT implemented or regression-tested. Source baseline: local commit `4d0ea36`. Do not mistake an image for working functionality or this checklist for completed verification. Any newer local/remote changes must be reconciled before implementation.

## Non-negotiable scope

- Preserve all existing business operations, validations, permissions and audit history. No feature removal is authorized by approval of the minimal screenshots.
- Change presentation and navigation incrementally; reuse existing accounting operations. No database reset, restore, migration or recalculation just to install the UI.
- Existing records, identities, dates, quantities, costs, margins, balances, cash boxes, attachments, transaction links and sync metadata must not be rewritten by opening redesigned screens.
- Web/PWA on phone and desktop; no APK or native iOS rewrite. iOS-inspired appearance does not mean dependence on an iPhone.
- Maintain Dari/RTL, numeric input, font-size preference, keyboard/back behavior and protected unsaved/held sales.
- Preserve current restrictions on correction/deletion. A generic edit button must not bypass linked-document or read-only guards.
- Future-money forecasting previously rejected by the owner stays absent. Existing reports are not removed because dashboard charts are absent from the sample.
- Mock data never enters the real business database. Use synthetic isolated databases for tests.

## Evidence consulted

`src/App.tsx` routes, auth/back/pending logic; all file names under `src/pages` and `src/components`; `More.tsx` and `Accounts.tsx` entry points; view switches in Sales, Inventory, Purchases, Expenses and Settings; exported operations in `src/lib/ops.ts`; form/action labels in sale, inventory, customer, lender, cash and year-start components; report sections; existing tests. This establishes the preservation baseline, not proof of every behavior on the live deployment. During each slice enumerate all conditional controls in its component and add missing cases here before replacing UI.

## Navigation contract

Four sample tabs are organizational, not a reduction of functionality:

| New destination | Contents and access |
|---|---|
| خانه / Today | Daily overview, new-sale action, purchase and expense shortcuts, inventory shortcut/reorder alert, reports shortcut, important reminders |
| فروش / Sales | New retail/wholesale sale, held sales, date-grouped history, sale detail, receipts/invoices, returns/exchanges, sales statistics |
| حساب‌ها / Accounts | Search and add/manage above list; customers, suppliers, sarrafs, lenders, expense creditors; party ledger and all permitted transactions; partners reachable in More / financial management |
| بیشتر / More | First group: گدام و خرید, مصارف و صندوق; then reports, partners/year, sync/account, backup/restore, reminders, app settings, advanced integrity and protected danger zone |

Inventory is reachable from Home and More, not solely through a warning that disappears when stock is healthy. Cash/expenses and purchases retain direct shortcuts. More's first group stays short and visible without expanding advanced settings. Active checkout can hide global tabs, but still offers safe back/hold/cancel with existing draft and pending-write protection. History/statistics remain accessible from Sales outside active checkout.

## Coverage checklist

Every unchecked box means verification in the redesigned app is still required. A feature is retained only when its destination, controls and resulting behavior are tested, not just when its old component remains in the repository.

| ID | Features to retain | New location | Source anchor / regression evidence to use |
|---|---|---|---|
| S01 | Retail and wholesale, existing customer or cash walk-in, search and product/size/color selection | Sales → New | `Sales.tsx`, `sales/NewSaleModal.tsx`; sale-flow/workspace tests |
| S02 | Individual quantities, whole/half cartons, selected-vs-remaining stock, unavailable/max guards, remove cart line | Sales → Item selection | `StockSelectionSummary.tsx`, `QtyControl.tsx`; sale-availability/wizard-switch tests |
| S03 | Per-row price edit AND one price for all selected sizes/colors of the same product; discount | Sales → Cart | `BulkSalePrice.tsx`, `NewSaleModal.tsx`; bulk-sale-price test |
| S04 | Cash, credit, mixed receipt; required customer, due date, physical ledger page | Sales → Payment step | `NewSaleModal.tsx`; bookpage/sale-flow tests |
| S05 | Freight: shop/customer/split shares, reimbursement, date/box/note, later correction/cancellation | Payment step and sale detail | `SaleShipping.tsx`, shipping ops; shipping-ui and accounting checks |
| S06 | Held sales: save/resume/delete draft; active cart restoration; no duplicate posting or unsafe navigation | Sales → Held; checkout header | `Sales.tsx`, `lib/appHistory.ts`; sale-workspace/back-button tests |
| S07 | History grouped by date, filters, details, receipts/invoices and existing share/download actions | Sales → History/detail | `SaleHistory.tsx`, `Receipt.tsx`, `InvoiceModal.tsx`; sale-history tests |
| S08 | Customer returns, stock-restock/settlement choices, exchanges, cancellation with existing guards | Sale detail | `ReturnModal.tsx`, `ExchangeModal.tsx`, return/exchange ops; checks.ts |
| S09 | Selected-sale cancellation from customer ledger; preview/reason, retain later payments and old debt | Account → Transaction detail | `CancelLedgerSaleModal.tsx`, `ledgerSaleCancellation.ts`; ledger-sale-cancel test |
| S10 | Sales statistics, sold items, periods and role-dependent profit visibility | Sales → Statistics | `SalesStats.tsx`, `SoldListCard.tsx`; sold-list and accounting tests |
| I01 | Product creation/edit, brand/category, variants, prices, initial stock, bulk size creation, guarded removal | Inventory → Product | `inventory/ProductModal.tsx`; newproduct tests |
| I02 | Camera capture AND gallery, preview/accept/cancel, photo removal | Product → Photo | `ProductPhotoPicker.tsx`; photo-picker test |
| I03 | Carton composition/prices, variable pairs-per-carton, model-level reorder threshold across colors | Product → Carton settings; inventory alerts | `StockCartonWizard.tsx`, `ReorderModal.tsx`; checks.ts |
| I04 | Stock filters/sorting, age/value views, detail by size/color | Inventory list/detail | `Inventory.tsx`, helpers; stock-sort/stock-value tests |
| I05 | Adjustments, opening-stock/cost tools, stocktake and duplicate-product merge | Inventory → Manage | `AdjustModal.tsx`, `StocktakeModal.tsx`, `MergeProductsModal.tsx`; merge tests and checks.ts |
| P01 | Purchase entry/items/cartons, supplier, existing cash/sarraf/credit choices, history | Purchases → New/history | `Purchases.tsx`, `NewPurchaseModal.tsx`, `CartonWizardModal.tsx`; checks.ts |
| P02 | In-transit versus received goods, receive action, landing costs and later landing payment | Purchase detail | `LandingCostModal.tsx`; receive/landing ops and checks.ts |
| P03 | Quantity correction, purchase-price correction after sales, landing correction, guarded cancellation | Purchase detail → Correct | `PurchasePriceCorrectionModal.tsx`, `PurchaseCancelModal.tsx`; checks.ts |
| P04 | Supplier goods returns and their cancellation | Purchase/supplier detail | `purchases/ReturnModals.tsx`; supplier-return ops and checks.ts |
| P05 | Purchase candidates/list and reorder entry points | Inventory → Buying list | `purchases/Candidates.tsx`, `Purchases.tsx` |
| A01 | Add/manage/search all party types, phone, balance direction; customers retail/wholesale | Accounts | `Accounts.tsx`, customer/supplier modals; customer-sort tests |
| A02 | Customer family grouping, ledger/page references, due dates, flags, old debts, receipts, statement detail | Customer management/detail | `Customers.tsx`, `FamilyDetail.tsx`, `CustomerDetail.tsx`; debt-detail/bookpage tests |
| A03 | Supplier/sarraf ledgers, prepayments/credits, opening debt, cash or sarraf or split payment | Supplier/sarraf detail | `SupplierModals.tsx`, `SupplierDetailModal.tsx`; checks.ts |
| A04 | Sarraf credit consumed before additional debt; explicit cash-box effect | Supplier payment preview | `addPayment` in ops, shared effects; checks.ts |
| A05 | Customer/supplier/opening-debt corrections and allowed cancellation with previous/replacement history | Transaction detail → Correct | `CorrectCustomerPaymentModal.tsx`, supplier correction, `CorrectOpeningDebtModal.tsx`; checks/delete-debt tests |
| A06 | Lender creation/edit/guarded deletion, opening loans, fresh cash loans, lender directly paying supplier | Accounts → Lenders | `LendersView.tsx`, lender ops; checks.ts |
| A07 | Cash repayment versus cash lent to lender; shoes for settlement versus shoes on credit, agreed prices | Lender → Transaction | `LendersView.tsx`, `giveCashToLender`, `giveGoodsToLender` |
| A08 | Historical cash/shoe records even if shoes no longer exist, manual descriptions, dates, quantities/values; correction/audit | Lender → Previous records/detail | `addOpeningLenderCash/Goods`, `CorrectLenderPaymentModal.tsx`; checks.ts |
| A09 | Convert lender to partner with existing confirmation and share rules | Lender → Advanced | `convertLoanToCapital`, `LendersView.tsx`; partnership tests |
| E01 | Business, home, personal, withdrawal expenses; cash/credit/mixed where currently supported; creditor and box | Expenses → New/detail | `NewExpenseModal.tsx`, `ExpenseDetails.tsx`; expense-details/checks.ts |
| E02 | Expense correction/cancellation, date filters/calendar, categories, expense reports | Expenses → History/manage | `CorrectExpenseModal.tsx`, `ExpenseCalendar.tsx`, `CategoryManager.tsx`, `ExpenseStats.tsx`; expense-calendar tests |
| E03 | Daily-category checklist, variable actual amounts, closed days/holidays, reminders; NO automatic expense posting | Expenses → Daily checklist | `DailyExpenseChecklist.tsx`, `CategoryManager.tsx`; checks.ts |
| E04 | Expense-creditor accounts and later cash/shoe settlement; agreed sale value, profit and excess cash/credit | Accounts → Expense creditors | `ExpenseCreditors.tsx`, `payExpenseCreditorCash/Goods`; checks.ts |
| C01 | Cash balances per named box, ledger/filter/date range, movement details | More → Cash/expenses → Cash | `CashView.tsx`; cash checks |
| C02 | Transfers between boxes including named new box; reasoned transfer cancellation | Cash → Transfer/detail | `transferCash`, `cancelTransfer` and CashView |
| C03 | Cash counting/reconciliation, shortage handling and history with existing permissions | Cash → Reconcile | `reconcile`, CashView; checks.ts |
| R01 | Day/month/year/custom periods; sale/purchase totals, cost, profit/loss, returns, expenses and cash/debt distinctions | Reports | `Reports.tsx`, `analytics.ts`, AnalyticsCards; checks.ts |
| R02 | Period comparison, retail/wholesale, product/customer/size/month/supplier breakdown, dead-stock views | Reports → Details | `Reports.tsx`, `AnalyticsCards.tsx` |
| R03 | Net worth, partners, capital, profit shares, withdrawal and year-start setup | More → Financial management/reports | `PartnersCard.tsx`, `YearStartCard.tsx`; networth/partnership tests |
| U01 | Sign in, password recovery, cached offline access, re-login after session expiry, logout | Account/login; persistent sync status | `App.tsx`, `Login.tsx`, `ResetPassword.tsx`, AccountCard; session tests |
| U02 | Owner/staff/viewer restrictions; staff profit privacy; read-only mutation protection | Every route and action | `accessFlags`, App role gates, operation guards; role tests |
| U03 | Server/account configuration, account creation roles, sync details/retry/pending/offline/restore-incomplete states | Header status and More → Account/sync | `SyncIndicator.tsx`, `SyncDetails.tsx`, ServerCard/AccountCard; sync-status/safety tests |
| U04 | Backup export, both restore modes, emergency backup, dangerous-replace confirmation, correct local/cloud status | More → Backup/restore | `Settings.tsx`, import/export ops; local restore checks |
| U05 | Font size, PIN lock, reminder settings, financial-year settings, integrity check, protected local/all-data reset | More → Settings/advanced | settings components and hooks; checks.ts |
| U06 | Mobile and desktop layout, PWA/offline, touch/keyboard/back, visible focus, error/loading/empty states, reduced motion | Entire app | App/history/shared UI; premium-ui/back-button/session tests |

### Feature groups awaiting redesigned verification

- [ ] S01–S10 sales
- [ ] I01–I05 inventory
- [ ] P01–P05 purchases
- [ ] A01–A09 accounts and lending
- [ ] E01–E04 expenses
- [ ] C01–C03 cash
- [ ] R01–R03 reporting and partners
- [ ] U01–U06 account/security/sync/support

## Published direct sales — preservation addendum (2026-09-13)

Direct supplier-to-customer resale is now published at 023681b and merged into this redesign branch. Preserve the implemented first release, not the original larger plan's deferred features.

| ID | Required preservation | Evidence |
|---|---|---|
| D01 | Sales entry, owner per-device upgrade acknowledgement, manual non-stock goods, review confirmation | DirectTradeEnable/Form, direct-trade-ui.mjs |
| D02 | Initial/later customer cash, supplier cash/sarraf split, customer-to-supplier payment; separate trade and overall balances | DirectPaymentForm/Fields, direct-trade.mjs |
| D03 | Sales/Purchases/customer/supplier detail links, customer-safe receipt, staff cost privacy, existing freight | DirectTradeDetail/Receipt, direct-trade-ui.mjs |
| D04 | Profit/report commercial readers, no warehouse effects, incomplete/conflict warnings, one-sided correction/delete guards | direct-trade-report-checks.ts, direct-trade-checks.ts |
| D05 | UUID sync/replay, portable backup, local acknowledgement excluded from backup | direct-trade-sync.mjs, direct-trade-backup.mjs |

- [ ] D01–D05 redesigned verification

Advanced direct correction/cancellation/return remains unavailable. Do not enable it cosmetically or replace new direct-sale code with older components. No reset, migration, accounting-rule change or production testing is part of redesign.

## Mockup discrepancies that must not ship

- Account-search barcode icon is an image-generation artifact; remove it. Product barcode scanning is not verified as an existing working feature, so do not promise it from the icon alone; preserve current text/SKU search and camera photo capture.
- Four tabs require explicit routes for every old destination. Do not delete expense/inventory routes while changing navigation.
- The sample accounts list does not depict supplier, sarraf, lender, expense-creditor or partner screens. They remain required.
- Quantity zero must not allow decrement below zero; disabled controls need actual logic and accessible state, not just gray paint.
- Cartoon/mockup carton equivalents cannot imply a complete mixed-size carton when only total pairs are known; show pairs-equivalent clearly and retain composition details.
- Images show example sync success. The real interface must use actual sync state and never permanently display that success label.
- Readability and tap speed take precedence over glass/animation. Keep numbers opaque; honor reduced-motion and font-size preferences.

## Release acceptance

For every coverage ID record: new click path, role visibility, synthetic fixture, test/result and any limitation. Inventory all conditional actions in the touched component before replacing it. All existing routes and legitimate actions must have a destination; a hidden unreachable component is a lost feature.

Compare representative before/after fixtures for stock, weighted cost, previous sale margin, cash by box, customer/supplier/sarraf/lender/creditor balances, links and audit records. Opening/navigating/restyling must have zero business-data writes. Test ordinary sales, held/resumed carts, returns, split payments, historical shoes, expenses and correction paths together.

Run `npm test`, `npm run build`, and inspected local-only suites for each slice. Relevant existing suites are listed in the table. Add a synthetic navigation coverage test for the new map. Never run `tests/two-device.mjs` or `tests/restore-two-device.mjs`; they contact production infrastructure. Local sync-safety and sync-status suites are suitable after inspection. UI tests are still required even when accounting operations are unchanged.

No release until every coverage group is checked with evidence or a specific limitation has been disclosed and approved. Do not claim 'nothing missing' based only on this source scan.
