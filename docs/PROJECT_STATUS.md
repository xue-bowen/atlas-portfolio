# Atlas Portfolio - Project Status

## Current stable checkpoint

Latest stable feature checkpoint before this documentation update:

`19f4533 feat: add CNY performance summary`

Repository: `git@github.com:xue-bowen/atlas-portfolio.git` (private)

Windows local path:

`C:\Users\28301\atlas-portfolio`

Last updated: 2026-11-06

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
- Manual additions, edits, deletions, and complete imports are sorted and
  validated as one chronological timeline before local data is replaced. A
  batch may arrive out of date order; same-day source order remains meaningful.
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
- Unified USD dividend flow with grouped payment, withholding-tax, and note
  fields plus a pre-save impact preview.
- Cash dividends: net amount enters USD cash.
- Dividend reinvestment: records a dividend followed by a zero-fee buy using
  all net dividend proceeds. The user enters the reinvestment price; the app
  calculates the fractional shares automatically.
- Unified multi-currency after-tax interest flow for USD, HKD, and CNY with
  grouped payment and note fields plus a pre-save cash impact preview.
- Unified payment cashback shares flow with grouped source, instrument,
  acquisition, and note fields plus a pre-save non-cash contribution preview.
- Separate HKD cash balance.
- USD cash transaction history with inflow, outflow, and running balance.
- Unified ADR custody fee and other USD expense flow with grouped payment and
  note fields plus USD cash and accumulated-fee previews. Standalone commission
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
- The security-profile editor also lists historical symbols from buys, sells,
  and in-kind contributions after a position is fully closed. Closed positions
  can be mapped for past valuations without reopening a holding or requesting
  a current quote.
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
- Dated security closing-price requests now use a separate date-specific cache
  key and permanent historical expiry while preserving the latest-quote key and
  its TTL. The Eastmoney adapter requests the latest unadjusted close on or
  before the selected date and rejects a later bar; the dormant Twelve Data EOD
  adapter explicitly rejects dated requests. Anonymous response tests cover
  cache separation, weekend carry-forward, invalid dates, and mismatched data.
  Live historical endpoint connectivity remains unverified on the current
  network, which refused a direct request on 2026-11-06.
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
- Linear full-timeline validation shared by additions, edits, deletions, and
  complete backup imports. After stable date sorting, every event checks CNY,
  HKD, and USD cash plus position availability before the next event runs. A
  later deposit or conversion cannot hide an earlier cash shortfall, and an
  invalid batch is rejected before localStorage changes. This replaces the
  prior edit-only prefix recalculation with one reusable pass suitable for
  larger backfills and migration batches.
- Versioned daily portfolio snapshot calculation that replays the ledger
  through each requested close, values CNY/HKD/USD cash and USD securities with
  explicit dated market inputs, and retains the exact quote, FX, provider, and
  timestamp provenance used. Missing security coverage or a required FX rate
  blocks a complete NAV instead of treating the missing asset as zero.
- External-flow classification at the portfolio boundary: CNY deposits are
  cash contributions, CNY withdrawals are withdrawals, and direct share
  cashback is an in-kind contribution valued at its entry USD value and that
  date's USD/CNY rate. FX, buys, sells, dividends, interest, and fees remain
  internal activity. The rules and an anonymous hand-worked example are fixed
  in `docs/PERFORMANCE_METRICS.md`.
- Chronological CNY performance series derived from versioned daily snapshots.
  It keeps cumulative cash contributions, in-kind contributions, withdrawals,
  and net contributions separate, then calculates total CNY P&L as ending NAV
  plus withdrawals minus both contribution categories. Duplicate dates,
  unsupported versions, inconsistent daily flow totals, invalid values, and
  cumulative overflow are rejected rather than producing a misleading result.
- CNY XIRR / money-weighted return derived from the same versioned snapshots.
  Cash and in-kind contributions become negative investor cash flows,
  withdrawals are positive, and ending CNY NAV is the terminal value. The
  `ACTUAL/365` solver rejects one-sided, single-date, unsolved, and
  multiple-root series instead of displaying a misleading annual rate.
- Responsive CNY Performance summary connected to the live ledger and current
  complete portfolio valuation. It shows current NAV, net contributions, total
  CNY P&L, and annualized CNY XIRR, while retaining the existing realized USD
  P&L and fee totals. Dated CNY deposits and withdrawals feed investor cash
  flows directly; in-kind contributions use their historical USD/CNY rate from
  the existing provider/cache service. Metrics that depend on incomplete quote,
  FX, or in-kind valuation inputs show an explicit unavailable reason.
- USD daily-close TWR domain series derived from complete version-1 snapshots.
  It translates the whole CNY NAV and external flows at each date's USD/CNY
  rate, removes same-day net external flows at the close, and chain-links the
  resulting USD subperiod returns from a base index of 100. Incomplete FX,
  inconsistent flows, invalid values, and zero-NAV continuation are rejected.
  Intraday flow timing is outside this close-only metric.
- Historical valuation-input loader that replays the ledger for requested dates,
  fetches USD/CNY for every close and HKD/CNY only while HKD cash exists, and
  requests dated quotes only for positions held on that date. It can use saved
  profiles for positions now closed. Any missing profile, FX rate, or quote
  returns dated issues without exposing a partial input series.
- The responsive Performance page can calculate cumulative USD TWR on demand
  from every eligible ledger-event date through the latest completed close.
  It shows the return and date range, or dated missing-input reasons. Changing
  the ledger or security profiles hides a stale result until recalculation.
- The same calculation compares IVV and QQQ unadjusted USD closing-price
  changes over the portfolio TWR date range. Each benchmark has its own
  availability result and shows the actual close dates. The UI explicitly
  distinguishes these price changes from dividend-inclusive portfolio TWR.
- Complete USD TWR points also render as a responsive 100-base growth-index
  line with calendar-spaced dates. The chart is shown only after every required
  historical valuation input has loaded successfully.
- A versioned IndexedDB personal-ledger store is implemented and tested but is
  not yet connected to the UI. It distinguishes absent from empty personal
  ledgers, validates the full timeline before writes, and rejects corrupt or
  unsupported records without displaying demo data in their place.

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

An isolated total-portfolio-valuation check on temporary port 5226 combined the
existing cash valuation with automatic securities closing prices. The complete
anonymous case displayed CNY 17,867.66 from CNY 8,363.05 cash plus USD 1,416.02
of securities translated at USD/CNY 6.7122. A second case deliberately left one
of two positions without a security profile: Atlas retained the USD 1,416.02
covered subtotal and CNY 11,044.57 cash valuation but kept the combined total
unavailable instead of valuing the missing holding at zero. Both cases retained
their balances, positions, coverage, quote date, and explicit cache status after
a full refresh. Only temporary anonymous data was used; the port-5224 manual
ledger was not opened or modified.

An isolated direct-share cashback check on temporary port 5227 imported an
empty anonymous schema-v2 backup, then recorded 0.125 VOO shares at a USD 640.00
acquisition price dated 2026-09-15. The `IN_KIND_CONTRIBUTION` event with source
`CASHBACK_REWARD` produced a 0.125-share position with USD 640.00 average cost
while CNY, HKD, and USD cash, realized P&L, and accumulated fees all remained
zero. USD cash history remained empty because no cash moved. The historical date,
position, cost, and ledger description all survived a full page refresh with no
browser warnings or errors. Only isolated anonymous data was used; the manual
ledger on port 5224 was not opened or modified.

An isolated information-architecture check on temporary port 5228 verified the
new fixed desktop sidebar, all seven navigation destinations, and the global
Add transaction action. The action scrolled the Transactions container to the
top of the content area; Dashboard, Portfolio, Transactions, Cash, Performance,
Market Data, and Settings each resolved to an existing page section. A full page
refresh retained the anonymous CNY 5,680.00 and USD 333.67 balances plus all six
sample ledger events, with no browser warnings or errors. The mobile bottom bar
prioritizes Dashboard, Portfolio, Transactions, and Cash and exposes the other
destinations plus Add transaction through More at the 720px breakpoint. The
initial browser session did not expose viewport emulation, so the first check
was build-only. A later 390 px isolated viewport check on port 5229 confirmed
that the desktop sidebar is hidden, the four priority destinations remain in
the bottom bar, and More exposes Performance, Market Data, Settings, and Add
transaction. That check also found and fixed page-level horizontal overflow by
containing the USD cash-history table in its own scroll area. The manual ledger
on port 5224 was not opened or modified.

An isolated unified-BUY check on temporary port 5229 imported an anonymous
schema-v2 ledger with USD 1,000.00 cash. Selecting BUY opened the grouped basic
information, instrument, execution, and costs/notes form. Entering 1.5 AAPL at
USD 100.00 with a USD 1.00 fee previewed USD cash falling to 849.00, 1.5 shares,
USD 151.00 cost basis, USD 1.00 fees, and unchanged realized P&L before save. A
deliberately excessive purchase showed negative projected cash, a clear warning,
and a disabled save action. The valid purchase produced USD 849.00 cash, 1.5
AAPL shares at USD 100.67 average cost, USD 1.00 accumulated fees, and the
expected ledger entry; all values survived a full refresh with no browser
warnings or errors. Only anonymous data was used.

An isolated unified-SELL check on temporary port 5230 built an anonymous ledger
with USD 1,000.00 cash and four TEST shares carrying USD 404.00 total cost.
Selecting SELL opened the same grouped flow as BUY. Selling 1.5 shares at USD
120.00 with a USD 1.00 fee previewed USD 179.00 net proceeds, USD 27.50 realized
P&L, USD cash rising from 596.00 to 775.00, 2.5 remaining shares, USD 252.50
remaining cost basis, and cumulative fees rising from USD 4.00 to 5.00. An
attempt to sell five shares displayed an oversell warning and disabled save.
The valid sale, remaining USD 101.00 average cost, cash, realized P&L, fees, and
ledger entry all survived a full refresh with no browser warnings or errors.
Only isolated anonymous data was used; no existing manual-test origin was
opened or modified.

The same isolated origin then verified the personal-ledger transaction-detail
view and deletion path. Selecting the anonymous SELL entry displayed its date,
type, account, note, and explicit full-recalculation warning. Deleting that
entry recalculated USD cash from 775.00 to 596.00, realized P&L from 27.50 to
0.00, cumulative fees from 5.00 to 4.00, and restored the TEST position from
2.5 to four shares at USD 101.00 average cost. The deleted entry stayed absent
and all recalculated values remained correct after a full refresh, with no
browser warnings or errors. Deletion validation uses the same chronological
balance engine and refuses a removal when a later transaction would become
invalid.

An isolated transaction-edit check on temporary port 5233 imported four
anonymous events, including a four-share ANON purchase followed by a 1.5-share
sale. The detail view prefilled the immutable record, and reducing the purchase
below the later sale displayed the chronological insufficient-position error
and disabled save. Changing the purchase price from USD 100.00 to USD 90.00
previewed USD cash rising from 775.00 to 815.00, realized P&L rising from USD
27.50 to 42.50, remaining cost basis falling from USD 252.50 to 227.50, and
average cost falling from USD 101.00 to 91.00. Saving replaced only the selected
record; its ID, type, account, later sale, and event count remained unchanged.
The edited value, note, balances, costs, and realized P&L survived a full page
refresh. A 390 px viewport showed no horizontal page overflow, and the browser
reported no warnings or errors. Only isolated anonymous data was used.

An isolated unified-CNY-deposit check on temporary port 5234 imported an empty
anonymous ledger. Selecting CNY deposit opened the grouped basic information,
cash flow, and notes form. Entering CNY 1,234.56 previewed CNY cash rising from
zero to CNY 1,234.56 while other balances remained unchanged. Save stayed
disabled until the required amount was valid. The saved event, amount, note,
and resulting cash survived a full page refresh, and the duplicate legacy CNY
deposit form was absent. A 390 px viewport showed the same preview without
horizontal page overflow, and the browser reported no warnings or errors. Only
isolated anonymous data was used; no existing manual-test origin was opened.

An isolated unified-CNY-withdrawal check on temporary port 5235 imported one
anonymous CNY 1,000.00 deposit. Selecting CNY withdrawal opened the grouped
basic information, cash flow, and notes form. Entering CNY 1,200.00 previewed a
negative CNY 200.00 balance, displayed the insufficient-cash warning, and kept
save disabled. A valid CNY 400.25 withdrawal previewed CNY cash falling to CNY
599.75. The saved event, amount, note, and resulting cash survived a full page
refresh, and the duplicate legacy CNY withdrawal form was absent. A 390 px
viewport showed no horizontal page overflow, and the browser reported no
warnings or errors. Only isolated anonymous data was used; no existing
manual-test origin was opened.

An isolated unified-CNY-to-USD check on temporary port 5236 imported one
anonymous CNY 10,000.00 deposit. Selecting CNY to USD conversion opened the
grouped basic information, conversion, and notes form. An excessive CNY
12,000.00 spend previewed negative CNY 2,000.00 cash, displayed the
insufficient-cash warning, and kept save disabled. A valid CNY 7,200.00 to USD
1,000.00 conversion previewed CNY cash falling to CNY 2,800.00, USD cash rising
to USD 1,000.00, and an effective transaction rate of 1 USD = 7.2000 CNY. The
saved event, note, both cash balances, and USD cash-history entry survived a
full page refresh, and the duplicate legacy conversion form was absent. A 390
px viewport showed no horizontal page overflow, and the browser reported no
warnings or errors. Only isolated anonymous data was used; no existing
manual-test origin was opened.

An isolated unified-dividend check on temporary port 5237 started with a fresh
anonymous personal ledger. A USD 10.00 gross cash dividend with USD 1.00 tax
previewed and saved USD 9.00 net cash; tax above the gross amount displayed a
validation warning and kept save disabled. A USD 12.00 gross reinvested
dividend with USD 2.00 tax at USD 4.00 per share previewed USD cash remaining
at USD 9.00, 2.500000 new shares, and USD 10.00 cost basis. Saving produced the
existing DIVIDEND-plus-zero-fee-BUY ledger sequence, and both events, cash, and
position survived a full refresh. The duplicate legacy dividend form was
absent. A 390 px viewport showed no horizontal page overflow, and the browser
reported no warnings or errors. Only isolated anonymous data was used; no
existing manual-test origin was opened.

An isolated unified-interest check on temporary port 5238 started with a fresh
anonymous personal ledger. USD 12.34, HKD 88.88, and CNY 66.66 after-tax
interest payments each previewed and changed only the selected currency's cash
balance; zero amount kept save disabled. All three events and balances survived
a full refresh, the saved CNY note appeared in transaction detail, the USD
event appeared in USD cash history, and the duplicate legacy interest form was
absent. A 390 px viewport showed no horizontal page overflow, and the browser
reported no warnings or errors. Only isolated anonymous data was used; no
existing manual-test origin was opened.

An isolated unified-USD-expense check on temporary port 5239 created an
anonymous USD 100.00 cash balance through the existing deposit and conversion
flows. A USD 120.00 expense previewed negative USD 20.00 cash, displayed the
insufficient-cash warning, and kept save disabled. Saving a USD 2.50 ADR
custody fee followed by a USD 7.50 other expense previewed and produced USD
90.00 cash plus USD 10.00 accumulated fees. Both events, cash, fees, cash
history, category descriptions, and the saved note survived a full refresh,
and the duplicate legacy expense form was absent. A 390 px viewport showed no
horizontal page overflow, and the browser reported no warnings or errors. Only
isolated anonymous data was used; no existing manual-test origin was opened.

An isolated unified-payment-cashback check on temporary port 5240 started with
a fresh anonymous personal ledger. Entering 0.125 VOO shares at USD 640.00 per
share previewed USD 80.00 contribution value, position growth from zero to
0.125 shares, and cost basis growth from zero to USD 80.00. The preview stated
that cash balances, realized P&L, and accumulated fees remain unchanged; a zero
quantity kept save disabled. After save and refresh, the position, cost,
IN_KIND_CONTRIBUTION ledger event, source description, and note persisted,
while all cash balances, realized P&L, fees, and USD cash history remained
zero. The final duplicate legacy form and legacy-form navigation code were
removed, so every listed transaction type now uses the unified flow. A 390 px
viewport showed no horizontal page overflow, and the browser reported no
warnings or errors. Only isolated anonymous data was used; no existing
manual-test origin was opened.

The daily-snapshot domain check used a four-day anonymous ledger with a CNY
8,000 contribution, internal conversion and purchase, a USD 60 in-kind share
contribution, a CNY 300 withdrawal, and HKD interest. The calculated CNY NAVs
were 8,000.00, 8,252.00, 8,952.00, and 8,249.60; only the deposit, in-kind
contribution, and withdrawal appeared as external flows. Tests also confirmed
chronological output without input mutation, complete internal-event exclusion,
duplicate-date rejection, and rejection of missing closing-price coverage. A
read-only smoke check on temporary port 5241 retained the anonymous demo
balances after refresh; a 390 px viewport had no horizontal page overflow and
the browser reported no warnings or errors. The manual ledger on port 5224 was
not opened or modified.

The chronological-validation check accepted a complete anonymous deposit,
conversion, and purchase batch supplied out of date order, then returned it in
valid date order without mutating the source array. It rejected CNY and USD
shortfalls that were hidden by later funding, rejected an invalid same-day
dependency order, and rejected deletion of funding needed by a later outflow.
A read-only smoke check on temporary port 5242 retained the six-event anonymous
demo ledger and its CNY 5,680.00 and USD 333.67 balances after refresh. The
390 px layout had no horizontal page overflow, mobile navigation remained
visible, and the browser reported no warnings or errors. The manual ledger on
port 5224 was not opened or modified.

The cumulative CNY performance check reused the four-day anonymous snapshot
example. It reconciled CNY 8,000.00 cash contributions, CNY 420.00 in-kind
contributions, and CNY 300.00 withdrawals to CNY 8,120.00 net contributions;
against CNY 8,249.60 ending NAV, total CNY P&L was CNY 129.60. Tests also
covered multiple external-flow categories on one date, out-of-order snapshot
inputs without mutation, duplicate dates, inconsistent flow totals, unsupported
calculation versions, invalid values, and cumulative overflow. A read-only
smoke check on temporary port 5243 retained the anonymous demo ledger and its
CNY 5,680.00 and USD 333.67 balances after refresh. The 390 px layout had no
horizontal page overflow, mobile navigation remained visible, and the browser
reported no warnings or errors. The manual ledger on port 5224 was not opened
or modified.

The CNY XIRR check confirmed a one-year 10% result, an irregular-flow 20%
result, investor-perspective contribution/withdrawal signs, zero-ending-NAV
as-of dates, and explicit rejection of one-sided, single-date, unsolved, and
multiple-root series. A read-only smoke check on temporary port 5244 retained
the six-event anonymous demo ledger and its CNY 5,680.00 and USD 333.67 balances
after refresh. At 390 x 844, mobile navigation was visible, desktop navigation
was hidden, and document width remained within the viewport. The browser
reported no warnings or errors; the tab and server were closed afterward. The
manual ledger on port 5224 was not opened or modified.

The Performance-summary browser check on temporary port 5246 showed four CNY
metric cards and CNY 20,000.00 net contributions for the six-event anonymous
demo ledger. Because its two holdings intentionally lacked security profiles,
current NAV, total P&L, and XIRR remained explicitly unavailable instead of
using partial valuation. At 390 x 844 the cards collapsed to one column, mobile
navigation remained visible, document width stayed inside the viewport, and a
refresh retained all six events plus the CNY 5,680.00 and USD 333.67 balances.
The browser reported no warnings or errors; the tab and server were closed
afterward. The manual ledger on port 5224 was not opened or modified.

A read-only smoke check on temporary port 5247 retained the six-event anonymous
ledger after refresh with CNY 5,680.00 and USD 333.67 cash. At 390 x 844 the
document had no horizontal overflow, and the browser reported no warnings or
errors. The tab and server were closed; port 5224 was not opened.

A read-only check on temporary port 5248 again retained the same six anonymous
events and cash balances after refresh. The 390 x 844 layout had no horizontal
overflow, and the browser reported no warnings or errors. The tab and server
were closed; port 5224 was not opened.

An isolated anonymous import on temporary port 5249 contained a deposit, FX,
buy, and complete sell of TEST. The closed symbol remained available in the
security-profile editor, accepted a NASDAQ mapping, and retained that mapping
after refresh. The four events, CNY 300.00 and USD 110.00 cash, and no open
positions remained unchanged. The 390 x 844 layout had no horizontal overflow
or browser warnings; the tab, server, and temporary anonymous import file were
removed. Port 5224 was not opened.

A read-only check on temporary port 5250 retained the six-event anonymous demo
ledger and CNY 5,680.00 / USD 333.67 cash after refresh. At 390 x 844 the
document had no horizontal overflow and the browser reported no warnings or
errors. The tab and server were closed; port 5224 was not opened.

On temporary port 5252, an isolated anonymous ledger with a single CNY 1,000
deposit dated 2026-11-03 calculated USD TWR of -0.13% through the 2026-11-05
close using historical FX. A separate same-day deposit correctly showed that
no completed later close was available. The mobile viewport had no horizontal
overflow. Port 5224 was not opened.

On temporary port 5253, an isolated anonymous CNY 1,000 deposit dated
2026-11-03 produced portfolio USD TWR of -0.10% through 2026-11-08, alongside
IVV -2.53% and QQQ -4.26% unadjusted price changes through their 2026-11-06
close. The 390 x 844 mobile layout had no horizontal overflow or console
warnings, and the anonymous ledger persisted after refresh. Port 5224 was not
opened.

On temporary port 5254, the same isolated anonymous deposit produced a USD
growth-index line from 100.00 to 99.90, with an accessible description and
calendar-spaced endpoints. The mobile SVG fit within its section at 390 x 844;
the document had no horizontal overflow or console warnings. Port 5224 was not
opened.

A read-only anonymous smoke test on temporary port 5255 retained the six-event
demo ledger after refresh. Its 390 x 844 layout had no horizontal overflow or
console warnings. The new personal-ledger store is not yet active in this UI.
Port 5224 was not opened.

The automated regression suite now runs with `npm test`. Ninety-one
deterministic tests cover the ledger, editing and deletion, valuation, daily
snapshots, external-flow classification, chronological stable sorting without
input mutation, CNY performance, current-summary availability, XIRR, USD TWR, and
invalid-input rejection. The suite, production build, and lint all pass
together.

The npm development dependency audit initially reported two denial-of-service
advisories inherited through the lint/build toolchain. Exact overrides pin
`brace-expansion` 5.0.12 and `source-map-js` 1.2.2. As of 2026-11-09, a fresh
full audit reports 12 newer development-tool advisories; `npm audit --omit=dev`
reports zero production-dependency vulnerabilities. Resolve the development
toolchain advisories during release checks. Tests, build, and lint pass.

## Key ledger behavior

- BUY reduces USD cash by `quantity * price + fee` and adds that amount to
  position cost.
- SELL increases USD cash by `quantity * price - fee`, removes the sold
  moving-average cost, and records realized P&L.
- DIVIDEND adds `gross amount - withholding tax` to USD cash.
- IN_KIND_CONTRIBUTION with source CASHBACK_REWARD adds shares and acquisition
  value to position cost without changing cash, realized P&L, or fees.
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

`npm test`

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
- Paid APIs and paid market-data subscriptions are out of scope. If the current
  free provider and cache cannot cover an asset, the first public release shows
  it as unavailable instead of upgrading to a paid source.
- Stock/ETF and FX providers are separate behind a replaceable
  `MarketDataProvider` layer.
- All pages share an IndexedDB market cache with TTL; historical data is
  downloaded once and incrementally extended.
- Initial refresh behavior is launch-time refresh plus manual refresh.
- Existing provider, original source institution, market timestamp, fetch
  timestamp, and delay metadata remain stored. The first public release does
  not add a larger source-tracing interface.
- The existing automatic provider, fresh/stale cache behavior, and explicit
  unavailable state are sufficient for the first public release. Additional
  provider fallback and manual closing-price/rate entry are post-release work;
  pre-publication license review remains required.
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
- Explicit fresh/stale cache status remains mandatory. The dormant Twelve Data
  adapter and manual quote entry may be reconsidered after launch, but neither
  is part of the current UI or required setup.
- Phase 3 includes CNY XIRR, USD TWR, return charts, and USD benchmark
  comparison limited to IVV and QQQ. SPX Delta, government-bond/deposit series,
  additional indexes, and advanced attribution are post-release work.

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
- Basic navigation and the unified transaction entry are implemented on top of
  the IndexedDB market cache and valuation chain. Visual polish remains
  deferred.

## Remaining path to the first public release

The fast public-release estimate is four workstreams, roughly 6-11 small
verified commits. Scope can move within that range as anonymous edge cases are
found:

1. Add a CNY NAV history line and assess dividend-adjusted benchmark data
   before treating IVV/QQQ as total-return comparisons (about 1-2 steps).
2. Move the personal ledger from localStorage to versioned IndexedDB with safe
   migration and backup/restore verification (about 1-2 steps).
3. Add generic batch import preview and duplicate detection, prioritizing Atlas
   JSON and a documented CSV format; broker-specific adapters can follow after
   launch (about 1-2 steps).
4. Complete license/privacy/setup documentation, anonymous screenshots,
   production checks, and a clean-browser desktop/mobile release test (about
   2-4 steps).

Additional market-data fallback, manual quote entry, expanded provenance UI,
SPX Delta, advanced attribution, and more benchmarks are deferred until after
the first public release. Existing market metadata remains intact.

## Next task

Move the personal ledger to versioned IndexedDB without losing an existing
localStorage ledger. Preserve the current JSON backup format and reject unsafe
migration. A focused manual ledger review and local JSON backup remain required
before substantial real history.
