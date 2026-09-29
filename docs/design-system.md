# Design system — فروشگاه اتل

The app is used standing at a counter, with one hand, often in sunlight, by people who read Dari and not
English. Every rule below serves one of three things: **speed at the counter**, **numbers that are never
wrong on screen**, and **nothing hidden behind the next tap**.

## Colour tokens (`src/index.css` `:root`, modes in `src/themes.css`)

| Token | Meaning |
|---|---|
| `--canvas`, `--surface`, `--surface-grouped` | page, cards, grouped controls |
| `--text-primary`, `--text-secondary` | body text, supporting text |
| `--border-subtle`, `--border-control` | separators, input borders |
| `--action` | blue **text** that does something (links, pressed chips) |
| `--action-fill` | blue **background** with white text (buttons). Same as `--action` in light modes, darker at night |
| `--action-tint` | pale blue selected background |
| `--success` | money came in, profit, done |
| `--danger`, `--danger-tint` | money went out, debt, loss |
| `--warning`, `--warning-tint`, `--warning-text` | attention (change to give back, held sales) |
| `--toast-bg` | dark bars with white text (undo) |

Colour always carries meaning, and never carries it alone: every red/green number also has a word or
▲▼ next to it.

**Display modes** (`lib/displayMode.ts`, per device): normal, «آفتاب» (sunlight: darker text, stronger
borders), «شب» (night), «مثل گوشی». Modes redefine Tailwind's colour variables under
`:root[data-theme]`; components never branch on the mode. To change a mode edit
`scripts/gen-themes.mjs` and run `node scripts/gen-themes.mjs` — `src/themes.css` is generated.

Strong backgrounds (`bg-*-500…950`) keep their light-mode colour at night, because they carry white text.

## Type

Vazirmatn 400/700, tabular digits everywhere (`font-variant-numeric: tabular-nums` on `html`), so money
columns line up. The money amount is the largest thing on its card. Font size is a per-device setting
(`lib/fontScale.ts`); every screen must work at «خیلی بزرگ» on a 320px phone.

## Motion (`--motion-fast` 120ms, `--motion-base` 200ms, `--motion-slow` 320ms; `--ease-out`, `--ease-spring`)

1. **Nothing waits for an animation.** Motion is decoration on a state change that has already happened;
   every tap works mid-animation. The only deliberate pause is the «روز بسته شد» stamp (750 ms, end of day).
2. **Only transform and opacity**, so cheap Android phones stay smooth.
3. **Reduced motion** (phone setting) zeroes the tokens; JS motion checks `reducedMotion()` and does nothing.
4. **RTL direction**: forward travel comes from the left.
5. **A number on screen is always the true number.** `RollingNumber` rolls only the digits that changed;
   it never counts through in-between values (`tests/motion-e2e.mjs` samples every frame to prove it).
6. Never move a container that holds `position: fixed` children (a transform re-parents them). Tab changes
   therefore fade the content and slide only the title.

| Moment | Where |
|---|---|
| Pair flies from size tile to the cart bar, bar bumps | `lib/motion.ts` `flyToCart` |
| Sale saved: check mark + one vibration | `saleCheck` |
| Price under cost: red border, one nudge when the field is left | CSS `.sale-line-price[aria-invalid]` |
| Rows slide / fade in / fade out | `lib/useFlipList.ts` (skips bulk changes like search) |
| Undo: ten seconds as a shrinking line | `UndoToast` |
| Sheet: spring in, pull down to close (phones) | `Modal` in `components/ui.tsx` |
| Target reached: confetti once per month | `celebrate`, setting `targetCelebrated` |
| Loading: grey shapes | `Skeleton` |

## Components

- `Modal` — bottom sheet on phones, centred window on desktop; Back closes it (`lib/appHistory`).
- `PrimaryBtn` — when `onClick` returns a promise, the button locks until it settles, so one tap makes one
  document. Pass the async function itself (`onClick={save}`), not `() => void save()`, or the lock never
  sees the promise. Plain `<button>`s that create documents use `lib/useSubmitOnce`.
- `Empty({ text, hint, action })` — an empty screen says what to do next and offers the action.
- `Skeleton` — loading shapes with `role="status"`.
- `RollingNumber` — money that changes in place.
- `MoneyKeypad` + `lib/quickCash.ts` — big keys (`inputMode="none"` on the field) and quick-cash buttons.
- `DocTimeline` + `lib/docHistory.ts` — «تاریخچهٔ این سند», built only from what documents store.
- `ErrorBoundary` — a broken screen shows plain Dari and «دوباره باز کردن», never a blank page.

## Rules that touch money

- **Change is never kept in the till.** The sale screen records `paid = min(tendered, total)`;
  `ops.addSale` refuses `paid > total`. Older sales saved before this rule are listed (read-only) in
  «کنترل حساب‌ها».
- **«چه کسی ثبت کرد»** (`by`, `deletedBy`, `deletedAt`) is written by the database hook for ordinary
  sales, expenses, payments and returns only — never for rows arriving by sync, and never for direct-trade
  or goods-receipt documents (they compare their exact content).
- Speed numbers (`lib/saleSpeed.ts`), targets, the first-day guide and display modes live in per-device
  settings and are never part of the accounts.

## Home screen (`pages/Dashboard.tsx` + `pages/dashboard/*`)

The owner opens the app standing at the counter, so the page answers three questions in this order:
*how is the month*, *what do I do now*, *where is my money*.

- **`HomeHero`** — the dark lapis card. Always the month («▲ مفاد» / «▼ زیان») with two bars (sales profit vs
  expenses on one scale) and the same `expenseAlert` text the reports use. Staff see only today's sales. It
  never disappears at any hour: a hidden number is worse than an extra one.
- **`TimePrompt`** — a separate light card with a gold border, only in the morning («صندوق را بشمارید» with the
  till figure the app expects; «بعداً» is remembered for the day in the `homeMorningSkip` setting) and in the
  evening («روز را ببندید»). It states one fact and offers one button.
- **`BackupNudgeCard`** — «بکاپ بگیرید», only when something is unprotected AND the last backup is 7+ days old
  (or never): the rule is `lib/backupReminder.ts` (`backupNudge`). The button downloads a real backup and
  records `lastBackupAt`; «بعداً» sleeps it until tomorrow. Both settings are per-device and are excluded from
  backup files, so an old backup can never move «last backup» backwards. Owner only.
- **Quick actions** — دریافت پول (picks a customer, then opens the account with the payment form open),
  مصرف, خرید, شمارش نقد (opens the count window itself). Hidden for the read-only role.
- **«پول شما کجاست»** (`MoneyMap`) — cash, receivables, stock and debts as rows; every bar shares ONE scale (the
  largest amount). Each row opens its own «از کجا آمد» sheet whose total equals the row. While the numbers
  load it shows a skeleton, never «۰».
- **«فروش‌های آخر»** — the last three sales today; a tap opens that sale's document (receipt, return,
  exchange) through `goTo('sale:<id>')`.
- **Navigation** — five tabs: خانه · حساب‌ها · **فروش** (raised circle, centre) · گدام · بیشتر. On wide screens
  the same five are a side column and «فروش» becomes a filled row.
- Colour on the home is meaning, not decoration: lapis = the month card, gold = the one action to take,
  blue = money owed to us, amber = money we owe, red = loss.

## Checks

| Test | Proves |
|---|---|
| `tests/display-modes-e2e.mjs` + `tests/contrast.mjs` | WCAG AA text contrast on main screens in all three modes |
| `tests/accessibility-e2e.mjs` | targets ≥ 40px with names, images with alt, no sideways scroll at 320px / largest text |
| `tests/motion-e2e.mjs` | numbers show only old/new values, undo line, sheet pull, list ghosts, reduced motion |
| `tests/sale-design-e2e.mjs` | size grid, keypad, quick cash, change not kept, speed card |
| `tests/documents-e2e.mjs` | who saved it, sale/expense history, branded receipt |
| `tests/first-day-e2e.mjs` | guide ticks from data, empty screens act |
| `tests/backup-reminder-e2e.mjs` | reminder rule on the real screen, real download is a valid backup, snooze, last backup in Settings, staff excluded, AA contrast |
| `tests/home-e2e.mjs` | month card and bars, morning/evening card, money map on one scale, recent sale opens, 5-tab nav, receive money, staff view |
