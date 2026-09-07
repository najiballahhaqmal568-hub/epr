# Remaining stock while selecting a sale

Every size/color shows physical stock, quantity selected in this cart, and remaining
pairs. The half-carton picker includes its pending quantities **plus** existing
cart lines. Selecting stock is not a database write or a cross-device reservation.

The shared summary announces exhaustion or overstock. Increment/add controls use
remaining stock; manual excessive or fractional quantities stay visible with an
error and block registration (and half-carton addition). They are not silently
clamped to physical stock. Decreasing or removing a cart line frees its quantity.

Full-carton capacity subtracts cart reservations and aggregates repeated template
entries for each variant. An old carton count is revalidated if available stock
changes. Search shortcuts and single-size pickers use the same remaining count.

The component follows the live IndexedDB query, so received stock changes revalidate
an open cart. This does not change sync or guarantee global reservations across
offline devices. The existing `addSale` transaction remains the final stock guard;
pricing, carton discount, accounting, and database schema are unchanged.

## Verification

Run `node tests/sale-availability.mjs` (Chrome or `CHROMIUM_PATH`, local Vite port
5195). It uses synthetic inventory in an isolated profile and blocks external
requests. Tests cover exhausted/manual/fractional quantities, half-cartons with
existing cart lines, repeated full cartons, a stale carton count after a stock
change, search shortcuts, incoming stock changes, widths 320/768/1024/1440, no
selection-time inventory writes, and correct stock/cash at final registration.
Also run `npm test` and `npm run build` before publishing.
