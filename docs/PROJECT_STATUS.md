# Atlas Portfolio - Project Status

## Current stable checkpoint

Latest stable feature checkpoint before this documentation update:

`1b1cdde feat: add Frankfurter FX provider`

Repository: `git@github.com:xue-bowen/atlas-portfolio.git` (private)

Windows local path:

`C:\Users\28301\atlas-portfolio`

Last updated: 2026-08-24

The working tree was clean after the latest commit. Personal ledger data is
browser-local and is never committed to GitHub.

## Confirmed product rules

- Desktop-first React + TypeScript + Vite web app.
- CNY is the funding and wealth-view currency; USD is the investment and
  holding currency.
- Ledger events are the single source of truth.
- Core flow: CNY deposit -> CNY to USD FX -> USD cash -> buy/sell/dividend.
- Sales and cash dividends remain USD cash until an explicit USD-to-CNY
  conversion.
- MVP cost method is moving-average USD cost. FIFO and specific lots are
  deferred; future buy records should retain traceable lot data before adding
  lot selection to sales.
- Personal records are browser-local only. Never commit real transactions,
  account details, exports, backups, or secrets.
- Do not use `git add .`; explicitly list every staged file.

## Implemented and verified

- Typed ledger events for deposits, withdrawals, FX, buy/sell, dividends,
  interest, and fees.
- CNY and USD cash calculation.
- Open positions with moving-average USD cost, total cost, and average cost
  per share.
- Realized USD P&L and cumulative trading fees.
- Browser localStorage read/write, plus local JSON export/import backup.
- Explicit separation of anonymous demo data and an empty personal ledger.
- Personal CNY deposit and CNY-to-USD FX forms.
- Manual USD security buy form with USD cash validation.
- Manual USD security sell form with position-quantity validation.
- Manual USD dividend form with gross amount and withholding tax.
- Cash dividends: net amount enters USD cash.
- Dividend reinvestment: records a dividend followed by a zero-fee buy using
  all net dividend proceeds. The user enters the reinvestment price; the app
  calculates the fractional shares automatically.
- Multi-currency after-tax interest entry for USD, HKD, and CNY.
- Separate HKD cash balance.
- USD cash transaction history with inflow, outflow, and running balance.
- Manual ADR custody fee and other USD expense entry; standalone commission
  entry is intentionally excluded because trading commission belongs to the
  related buy or sell.
- Manual CNY withdrawal with current-cash validation.
- Provider-neutral market-data contract with separate stock/ETF quote and FX
  provider capabilities, standardized provenance/timestamps/delay metadata,
  and typed provider failures. No external API is connected yet.
- Provider-neutral IndexedDB market cache with normalized deterministic keys
  for security quotes and latest/historical FX rates, caller-supplied expiry
  timestamps, explicit `FRESH`/`STALE` cache hits, and get/put/delete/clear
  operations. Stale records are retained for later fallback rather than being
  silently discarded.
- Free Frankfurter v2 FX provider for latest and historical daily reference
  rates. It validates response shape, preserves the blended source-provider
  keys, records market/fetch timestamps, marks the data as delayed, and maps
  rate limits, unsupported requests, network failures, and invalid responses to
  typed provider errors. It is not connected to the UI or ledger.

Anonymous browser tests verified balance updates and persistence after refresh.
The latest reinvestment test confirmed that buying below the existing average
cost lowers the average cost per share. An isolated anonymous market-data test
also verified stable cache keys, fresh/stale classification, deletion, misses,
and IndexedDB persistence after a full page refresh. A separate isolated live
API test verified USD/CNY, HKD/CNY, and historical USD/CNY results plus typed
error handling without reading or modifying ledger data.

## Key ledger behavior

- BUY reduces USD cash by `quantity * price + fee` and adds that amount to
  position cost.
- SELL increases USD cash by `quantity * price - fee`, removes the sold
  moving-average cost, and records realized P&L.
- DIVIDEND adds `gross amount - withholding tax` to USD cash.
- Reinvested dividends append a DIVIDEND event followed by a BUY event on the
  same date, so USD cash returns to its pre-dividend amount and the position
  gains the automatically calculated fractional shares.
- A reinvestment price below the current average cost can lower the remaining
  average cost; a higher price can increase it.

## Development workflow

From the repository root:

`git status`

`git log -1 --oneline`

From the `web` directory:

`npm run build`

`npm run dev`

For each small feature:

1. Implement only the scoped change.
2. Test with anonymous data in an isolated local browser origin.
3. Verify refresh persistence and expected balances.
4. Run `npm run build`, `git diff --check`, `git diff`, and `git status`.
5. Stage explicit paths only, commit, push, and confirm a clean worktree.

## Confirmed market-data direction

- Free-First: reliable delayed/EOD data is preferred over unnecessary paid
  real-time data.
- Paid APIs and paid market-data subscriptions are out of scope. If free
  providers cannot cover an asset, Atlas uses cache or manual input instead of
  upgrading to a paid source.
- Stock/ETF and FX providers are separate behind a replaceable
  `MarketDataProvider` layer.
- All pages share an IndexedDB market cache with TTL; historical data is
  downloaded once and incrementally extended.
- Initial refresh behavior is launch-time refresh plus manual refresh.
- Provider, original source institution, market timestamp, fetch timestamp,
  delay status, and manual overrides remain traceable.
- Provider fallback, explicit stale-data display, API request budgets, license
  review, and manual price input are mandatory parts of the market-data phase.
- Frankfurter is the first FX candidate; stock provider candidates must be
  re-evaluated against official pricing, market coverage, delay, and license
  terms immediately before integration.
- Phase 3 includes portfolio return charts and benchmark comparison. Initial
  benchmark candidates are US Treasury, China government bond, and China
  one-year term-deposit return series, normalized to a common starting value
  with explicit currency and compounding assumptions.
- Phase 3 also includes SPX Delta, defined as the estimated percentage change
  in total portfolio NAV for a 1% change in SPX. It will also show estimated
  portfolio percentage and USD changes for SPX +/-1% scenarios and market-value
  coverage. The first version covers stocks and ETFs; options Greeks are
  deferred until the ledger supports options. Missing price/beta inputs must
  remain visible rather than being treated as zero exposure.

## Confirmed information architecture

- Product-development principle: **Function-first, usability-always,
  polish-later**. Core data and calculations come first, but basic usability and
  information architecture are not deferred.
- Desktop uses a fixed left navigation with Dashboard, Portfolio,
  Transactions, Cash, Performance, Market Data, and Settings, plus one global
  `Add transaction` action.
- Mobile bottom navigation prioritizes Dashboard, Portfolio, Transactions, and
  Cash; Performance, Market Data, and Settings are reached through More.
- Every transaction follows one flow: select transaction type, complete a
  grouped form, preview ledger/portfolio impact, then save.
- The buy form is grouped into basic information, instrument, execution, and
  costs/notes.
- Editing and deletion are available only from a transaction detail view in
  Transactions. Either action triggers a full recalculation from the ledger.
- Basic navigation and the unified transaction entry will be implemented as a
  separate small phase only after the IndexedDB cache and basic valuation chain
  are complete. Visual polish remains deferred.

## Next task

Implement a cache-aware FX rate service that combines the provider-neutral
IndexedDB cache with the Frankfurter provider. Fresh cache hits must avoid a
network request; successful requests must write an explicit expiry; provider
failure may return a clearly marked stale cache hit but must never disguise it
as fresh. Keep actual broker/bank FX ledger rates separate. Continue through the
basic valuation chain, then enter the separate information-architecture phase
for navigation and the unified transaction entry before beginning
performance/report UI work. A focused manual ledger review and local JSON
backup remain required before recording substantial real history.
