# Redesign verification progress

This records completed slices, not a claim of complete app parity. The release gate remains tasks/plan.md slice12 and the full feature contract. No production business records are test fixtures.

| Slice | Implementation | Evidence | Remaining limits |
|---|---|---|---|
| Shared primitives | ef179ce,113e7eb |51 focused checks,1130 financial checks/111 scenarios, build; independent review | Chromium; all app screens still need coverage |
| Four-tab navigation and Home |87a68ee | Actual App routes/settings/back/session/roles, whole-business navigation snapshot, direct Sales smoke, build; independent review | Exhaustive reminder variants and delayed-write race pending |
| Product selection and cart controls |e9b7acb | Retail/wholesale selected state; availability/full/half/repeated cartons; common product price; working reload; wizard ordinary-form preservation;320–1440 font scaling;1130/111;build; independent review | Payment presentation is next slice; no full direct App journey claim |
| Payment and held sales |a2f31cf | Cash/mixed/fullcredit, discount/back, held/resume, freightcreate/correct/cancel, stock/pricing/session/directUI;1130/111;build; independent review | Keyboard customer visual/DOM order followup; historical return/exchange full parity later |
| Sale history and customer documents |aecddc9,4af9020 | Date grouping/search/range, ordinary/direct detail routing, role guards, receipt image share/download, invoice print/share, escaped customer/product text, discount gross/net display; focused UI and accounting checks,1130/111,build; independent review | Physical printer/share-sheet checks remain device QA; return/exchange presentation is the next sub-slice |
| Returns and exchanges |a223d04 | Cash/debt and healthy/damaged returns; positive/partial-debt/negative/equal exchanges; stock failure/retry; guarded duplicate save and first close; 320–1440 enlarged-font screenshots;1130/111;build; independent review | Repeated browser Back during save and no-wrap for very large summary amounts remain final-gate followups |

Navigation paths: Home is default; Home→New Sale; Sales→History/Held/Statistics/Direct Sale; Accounts retains all party types; More→Inventory/Purchases/Expenses and support/settings. Inventory and purchase history are independent of low-stock reminders.

Selection fixtures check unchanged business rows before registration, and expected stock/cash changes only when registering. Common-price changes remain cart-only and do not rewrite catalog or earlier sale prices. QtyControl retains minimum-one callback semantics. Font URLs in generated CSS resolve from assets to the deployed fonts directory.

The online app still uses published direct-sale release023681b. Redesign is isolated on feature/ios-redesign and has not been deployed. Full audit/stock/cash/account fixture parity is required before release; retain all records and compatible direct-sale readers/effects/guards.
