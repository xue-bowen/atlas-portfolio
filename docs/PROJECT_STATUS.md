# Atlas Portfolio - Project Status

## Current stable checkpoint

Latest stable feature checkpoint before this documentation update:

`ce936b6 feat: configure runtime security quotes`

Repository: `git@github.com:xue-bowen/atlas-portfolio.git` (private)

Windows local path:

`C:\Users\28301\atlas-portfolio`

Last updated: 2026-09-06

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
- When a payment-reward platform directly grants shares without first crediting
  cash, record an `IN_KIND_CONTRIBUTION` with source `CASHBACK_REWARD`. It adds
  quantity and acquisition cost but no CNY, USD, or HKD cash; its entry value is
  an external non-cash contribution rather than investment P&L. A platform flow
  that actually credits reward cash before investing remains two separate cash
  income and buy events.
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
- Cache-aware FX rate service that combines any `FxRateProvider` with the
  provider-neutral cache. It deduplicates concurrent requests, uses a 12-hour
  default TTL for latest rates, stores dated historical rates permanently,
  avoids network calls on fresh hits, and returns explicit `PROVIDER_FRESH`,
  `CACHE_FRESH`, or `CACHE_STALE` status. A stale fallback includes the refresh
  error; a cache miss never disguises provider failure as valid data.
- Read-only valuation FX panel for USD/CNY and HKD/CNY. It loads on initial
  demand, supports a manual force refresh, and displays the rate, observation
  date, fetch time, Frankfurter service, contributing sources, and
  fresh/cache/stale-fallback status. It explicitly states that valuation rates
  never replace actual broker or bank conversion rates in the ledger.
- Read-only cash valuation summary in CNY. It shows CNY cash directly, converts
  non-zero USD and HKD cash with the displayed valuation rates, and calculates
  total cash reference value without changing ledger balances or actual FX
  events. Missing rates block a complete total only when the related foreign
  cash balance is non-zero; stale cached inputs remain explicitly identified.
- Provider-neutral Twelve Data `/eod` adapter for stock and ETF closing prices.
  It accepts an API key only at runtime, sends it in the authorization header
  rather than the URL, validates symbol/currency/date/positive close values,
  preserves exchange and MIC provenance, marks quotes as delayed, and maps
  authentication, rate-limit, unsupported, network, and invalid-response
  failures to the shared market-data error model. It is not connected to the UI
  or any personal configuration yet.
- Cache-aware security quote service behind `SecurityQuoteProvider`. It uses a
  configurable 12-hour default TTL suitable for EOD quotes, normalized cache
  keys, concurrent-request deduplication, force refresh, and explicit
  `PROVIDER_FRESH`, `CACHE_FRESH`, or `CACHE_STALE` results. Stale fallback
  retains the typed refresh error, while a cache miss surfaces provider failure.
  The service is provider-neutral and is not connected to the UI, ledger, or
  personal API-key configuration.
- Provider-neutral, read-only holdings valuation calculation. Existing
  symbol-only positions receive an explicit external mapping to symbol,
  exchange, quote currency, and asset type, so the legacy ledger does not need
  to be rewritten. Exact matching is case-insensitive for symbols and exchanges.
  For covered USD positions it reports per-position market value and unrealized
  P&L, covered market-value and cost subtotals, and a complete securities total.
  Missing mappings, missing exact quotes, and non-USD quote currencies remain
  explicit uncovered states; if any position is uncovered, the complete total
  is unavailable rather than silently treating that position as zero.
- Versioned local security-profile registry, stored separately from immutable
  ledger events. It normalizes position symbols, provider symbols, and exchanges;
  currently accepts USD-quoted stock and ETF identifiers; rejects duplicate
  position mappings and duplicate canonical identifiers; and reports invalid
  stored data instead of treating it as valid. Starting an empty personal ledger
  also clears old profiles so metadata from another ledger cannot leak across.
- Personal-ledger security-profile editor for open positions. It shows mapped
  and unmapped holdings, pre-fills the existing provider symbol, exchange, and
  stock/ETF type when editing, fixes quote currency to USD, and saves metadata
  to the separate local registry without adding a ledger event or changing cash,
  quantity, cost, realized P&L, or fees. Backup imports update the visible
  registry immediately as well as local storage.
- Read-only holdings valuation panel connected to saved security profiles, the
  cache-aware quote service, IndexedDB market cache, and the existing valuation
  calculation. Only mapped open positions trigger quote lookups. The table shows
  shares, average cost, cached quote date, market value, unrealized USD P&L, and
  fresh/stale/refresh-failure status. Coverage and covered market value remain
  explicit, while total securities value stays unavailable whenever any holding
  lacks a profile or quote. A cache-only provider keeps this slice usable with
  prior data without embedding a key or pretending that live data is configured.
- Runtime-only Twelve Data EOD configuration was implemented and verified, then
  intentionally removed from the current UI when the prototype returned to a
  no-paid-API, no-required-key direction. The provider-neutral adapter remains
  dormant for possible later iteration; no Twelve Data key field is currently
  shown and no personal configuration is stored.
- Automatic no-key US daily closing-price source using Eastmoney's public JSON
  endpoint. The provider maps saved NASDAQ, NYSE, NYSE Arca, and NYSE American
  profiles to the source's US-market identifiers, requests unadjusted daily
  bars, validates the returned symbol/market/date/positive close, and writes the
  latest completed daily close through the existing cache-aware quote service.
  Startup uses a fresh IndexedDB value without another request; manual refresh
  forces a provider request, while refresh failure keeps an explicit stale
  fallback. No quote entry or API key is required from the user.
- User-initiated TradingView market-chart links for mapped US holdings. Atlas
  derives the TradingView exchange and symbol from the saved security profile,
  including the `NYSE ARCA`/`NYSE AMERICAN` to `AMEX` convention used by
  TradingView, and opens the official symbol page in a separate isolated tab.
  Unmapped or unsupported holdings show no link. The external page is display
  only: no Widget value is scraped, parsed, cached, or used in Atlas valuation.
- Portfolio JSON backup schema v2 now includes both ledger events and security
  profiles. Import remains compatible with the original raw ledger array and
  schema-v1 Atlas backups; formats without profiles import an empty registry so
  unrelated local mappings are not silently retained. API keys and market cache
  data are not included in the backup.
- Stable chronological ledger ordering across manual saves, local loads,
  imports, exports, balance calculations, USD cash history, and page display.
  Events sort by date ascending while same-day events retain their original
  order. Every manual entry is reordered and fully recalculated before storage;
  an invalid backdated sequence such as a sale before sufficient holdings is
  rejected without overwriting the valid local ledger.

Anonymous browser tests verified balance updates and persistence after refresh.
The latest reinvestment test confirmed that buying below the existing average
cost lowers the average cost per share. An isolated anonymous market-data test
also verified stable cache keys, fresh/stale classification, deletion, misses,
and IndexedDB persistence after a full page refresh. A separate isolated live
API test verified USD/CNY, HKD/CNY, and historical USD/CNY results plus typed
error handling without reading or modifying ledger data. An isolated cached
service test verified first-fetch writes, zero-network fresh hits, concurrent
request deduplication, explicit stale fallback, miss failure, permanent dated
rates, and IndexedDB persistence after refresh. UI verification confirmed first
provider loads, fresh-cache page reloads, forced manual refreshes, unchanged
anonymous balances and ledger entries, and a readable two-card desktop layout.
A separate isolated cash-valuation check used CNY 5,680.00, USD 333.67, HKD
0.00, USD/CNY 6.7174, and HKD/CNY 0.85613; it displayed USD cash at CNY
2,241.39 and total cash at CNY 7,921.39. A full page refresh returned both FX
inputs from fresh IndexedDB cache and preserved the same values without writing
a ledger event. Anonymous Twelve Data provider fixtures verified a valid AAPL
EOD response, header-only test-key transport, typed 429 handling, and rejection
of a mismatched response currency. No personal API key or ledger data was used.
Anonymous security-quote service fixtures verified first-fetch writes,
zero-network fresh hits, force refresh, concurrent-request deduplication, stale
fallback, cache-miss failure, and invalid-TTL rejection. A separate isolated
browser test verified real IndexedDB persistence after a full refresh: the
initial provider quote reloaded as `CACHE_FRESH`, then remained available as an
explicit `CACHE_STALE` fallback when a simulated refresh failed. The test used
only temporary anonymous data on port 5205 and removed its IndexedDB database,
test files, browser tab, and local server afterward.
Anonymous holdings-valuation fixtures verified two-position market value,
per-position unrealized P&L, case-insensitive mapping, exact exchange matching,
missing identifiers, missing quotes, unsupported quote currency, empty
portfolios, invalid inputs, duplicate mappings, and non-mutation of position
cost data. A separate browser check on temporary port 5213 produced USD 100.00
market value and USD 20.00 unrealized P&L for a fully covered anonymous holding.
Adding an uncovered position preserved the USD 100.00 covered subtotal but made
the complete total unavailable. The same result remained after a full refresh;
the temporary tab, server, and test files were removed afterward.
Anonymous security-profile fixtures verified normalization without input
mutation, schema-v2 backup round trips, schema-v1 and raw-array compatibility,
duplicate position and identifier rejection, non-USD rejection, and malformed
v2 failure. An isolated browser check on temporary port 5214 saved one anonymous
profile, confirmed it in a schema-v2 backup, reloaded it on a new page and after
a full refresh, then cleared the registry and confirmed the empty state. The
test page reported no browser warnings or errors; its tab, server, files, and
anonymous local data were removed afterward.
Anonymous ledger-ordering fixtures verified ascending dates, stable same-day
order, non-mutation of input arrays, matching balance and USD cash-history
ordering, and sorted schema-v2 imports. An isolated browser check on temporary
port 5216 saved deliberately unordered anonymous entries, reloaded the same
ascending order after a full refresh, and confirmed that an invalid backdated
sale was rejected while the previously saved ledger remained unchanged. The
test reported no browser warnings or errors; its local data, tab, server, and
temporary files were removed afterward.
An isolated security-profile editor check on temporary port 5217 began with
unmapped VOO and GOOGL holdings. Saving VOO as a USD-quoted NYSE ARCA ETF
survived a full refresh while USD cash remained 998.00, both position costs
remained 201.00, and the ledger remained four events. Importing a schema-v2
anonymous backup immediately replaced the visible mapping with ANON on TEST
EXCHANGE, and the three-event ledger, USD 750.00 cash, and mapping all remained
after refresh. The temporary local data, browser tab, server, setup page, and
backup file were removed afterward.
An isolated holdings-valuation UI check on temporary port 5219 used two VOO
shares at USD 201.00 total cost, one unmapped GOOGL share, and an anonymous
cached VOO quote of USD 125.00. The page displayed USD 250.00 covered market
value and USD 49.00 unrealized P&L, reported 1/2 quote coverage, and kept total
securities value unavailable because GOOGL was uncovered. A forced refresh
retained the cache with an explicit refresh-unavailable status; a full page
refresh preserved the same valuation, USD 998.00 cash, and four ledger events.
The temporary local data, IndexedDB records, browser tab, server, and test files
were removed afterward.
An isolated runtime-provider UI check on temporary port 5221 used a fake key and
an anonymous Twelve Data response fixture. The request URL contained no key and
the authorization header was present. A USD 130.00 VOO EOD quote produced USD
260.00 market value and USD 59.00 unrealized P&L while USD 799.00 cash and three
ledger events stayed unchanged. A simulated second-request rate limit retained
the cached valuation with an explicit refresh-unavailable status. Loading a new
page discarded the key, returned to cache-only mode, and kept the cached quote;
all temporary local data, IndexedDB records, test files, browser tab, and server
were removed afterward.

An isolated live EOD UI check on temporary port 5224 imported only anonymous
data: two VOO shares with USD 1,201.00 total cost, USD 799.00 cash, CNY 3,000.00
cash, and three ledger events. The automatic no-key provider returned the
2026-09-04 USD 708.01 close, producing USD 1,416.02 market value and USD 215.02
unrealized P&L. A full page refresh reused the quote as `CACHE_FRESH`; the
manual refresh action fetched the same close as `PROVIDER_FRESH`. Both cash
balances, position cost, accumulated USD 1.00 fee, and all three ledger events
remained unchanged, with no browser warnings or errors. The temporary JSON file
was removed afterward.

An isolated TradingView-link UI check on temporary port 5225 imported the same
anonymous two-share VOO position and verified that its saved `NYSE ARCA` profile
produced `https://www.tradingview.com/symbols/AMEX-VOO/`, with `_blank` and
`noopener noreferrer` isolation. The destination resolved to TradingView's VOO
ETF price-and-chart page. CNY 3,000.00 cash, USD 799.00 cash, USD 1,201.00
position cost, and all three ledger events stayed unchanged; the temporary JSON
file was removed afterward. The pre-existing manual-test ledger on port 5224
was read only and was not modified during this check.

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
- Long-term portfolio measurement uses the latest available daily close; Atlas
  does not require intraday delayed quotes for the prototype.
- Yahoo Finance is an experimental free source behind a local server adapter,
  never a direct browser dependency or the sole valuation source. A live
  `yahoo-finance2` check on 2026-09-06 reached Yahoo's session/crumb step but was
  rejected with HTTP 403 from the current network, so the failed dependency was
  removed rather than presenting automatic quotes as available.
- Eastmoney's public US daily JSON endpoint is the current no-key prototype
  source because it is directly reachable from the current environment and
  exposes completed daily bars. It remains behind `SecurityQuoteProvider`, and
  its access terms, stability, symbol coverage, and redistribution constraints
  must be reviewed before making the repository public.
- TradingView is reserved for a user-initiated per-security chart/quote display.
  Widget content is not scraped or extracted into the portfolio valuation.
- Explicit fresh/stale cache status remains mandatory. Manual price override is
  a later failure fallback, not the normal user workflow. The dormant Twelve
  Data adapter may be reconsidered later, but it is not part of the current UI
  or required setup.
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

Calculate total portfolio value in CNY from the existing cash valuation and
complete USD securities market value. The result must remain unavailable if a
non-zero cash currency lacks its FX rate or any open holding lacks a profile or
quote; covered subtotals remain visible, but missing assets must never be treated
as zero. Show the securities USD subtotal, its USD/CNY conversion input, total
cash CNY value, combined CNY market value, valuation timestamp/coverage, and the
reason for any incomplete total. This read-only calculation must not alter cash,
ledger events, costs, or cached data. Verify complete and incomplete anonymous
cases plus refresh persistence before starting the separate information-
architecture phase. A focused manual ledger review and local JSON backup remain
required before substantial real history.

The direct-share cashback event is specified in the development plan but is
queued until the current security-profile and basic market-valuation chain is
complete. It must be implemented before portfolio return metrics so its external
non-cash contribution is not misclassified as investment performance.
