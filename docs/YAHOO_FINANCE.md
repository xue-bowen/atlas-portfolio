# Yahoo Finance daily-price adapter

Updated: 2026-11-23.

The owner approved Google/Yahoo Finance and other technically usable free
sources for this non-commercial prototype. Continue implementation on that
basis. Complete market data is still required before public release; the
browser market-price CSV import control remains deferred.

## Local use

Run `npm run dev` from `web`. Yahoo is enabled automatically through the local
`/api/yahoo-chart?symbol=IVV` bridge. The bridge is also installed in Vite's
local preview server. It makes a normal server-side request to Yahoo's chart
endpoint, avoiding the browser's cross-origin restriction. It does not change
Yahoo's upstream access decisions or perform login/session workarounds.

The adapter requests a full daily series once per symbol per refresh/calculation
batch. Current and dated holdings quotes use completed closes. Yahoo failures
fall back to the existing Eastmoney provider; the existing IndexedDB quote
service retains explicit stale-cache behavior. Each result keeps the actual
provider's identity. A manual refresh creates a new batch and retries Yahoo.

Historical CSV observations remain preferred when present. Benchmark
calculations use both locally imported adjusted endpoints if available;
otherwise both endpoints come from the same Yahoo series. If Yahoo is absent,
fails, or lacks either adjusted endpoint, both are retried using Eastmoney's
forward-adjusted daily series. Sources are never mixed within one ratio.
Missing adjusted values across all sources leave the benchmark unavailable
instead of substituting ordinary close. See the
[benchmark rules and live checks](PERFORMANCE_METRICS.md#ivvqqq-adjusted-benchmark-returns).

Yahoo's split-adjusted Close is converted back to an as-traded historical
close using the split events for holdings valuation. Adj Close remains
adjusted for the IVV/QQQ return ratio. Record the corresponding ledger split
through Add transaction; [split support](STOCK_SPLITS.md) changes quantities
without inventing income or cash. Price downloads do not create ledger events.
The adapter checks security identity, exchange, USD currency, asset type,
ordered trading dates, and positive prices. Today's session is excluded until
15 minutes after its reported regular-session end; without that metadata,
only earlier sessions are accepted.

## Production hosting

The default production build does not assume a Yahoo backend exists. It uses
Eastmoney ordinary holdings quotes and tries local adjusted observations,
then Eastmoney adjusted observations, for benchmarks. This path was verified
with real browser requests on 2026-11-23 and needs no Yahoo backend.
GitHub Pages hosts static files and cannot run the optional Node Yahoo bridge.
The private Sites trial also uses this static Eastmoney/Frankfurter path.

For a host that supplies a compatible bridge, set `VITE_YAHOO_BRIDGE_URL` at
build time to its URL. For a local production-preview check in PowerShell:

```powershell
$env:VITE_YAHOO_BRIDGE_URL = '/api/yahoo-chart'
npm run build
Remove-Item Env:VITE_YAHOO_BRIDGE_URL
npm run preview -- --host 127.0.0.1 --port 5272 --strictPort
```

Use an unused temporary port and anonymous data. Never test against the manual
ledger at `127.0.0.1:5224`. A hosted cross-origin bridge must allow the Atlas
origin. Its public URL is build configuration, not an API key. The bridge
accepts GET and a single validated security symbol; the upstream host, daily
interval, and requested data types are fixed. It forwards no browser cookies,
credentials, ledger records, quantities, or account identifiers.

## Explicit daily history bounds

The bridge now uses `period1=0`, `period2=floor(Date.now()/1000)`, `interval=1d`,
and `events=div,splits`. `range=max` was removed: Yahoo can silently return
monthly history despite a requested daily interval. The shared URL builder
fixes the upstream host/path and validates the symbol. Tests assert the epoch
bounds and reject monthly (`1mo`) as well as weekly series in the adapter.

The owner's 2026-11-23 direction is to keep the first static release on
Eastmoney and Frankfurter, with Yahoo as a local enhancement. The attached
Grokbot plan also describes an optional Cloudflare Worker; that is not deployed
or required by this release. The Pages build can receive a compatible bridge
URL through repository variable `VITE_YAHOO_BRIDGE_URL`; an unset variable
preserves the Eastmoney-only production path. No login, crumb/cookie retry,
or region/rate-limit workaround was added. HTTP 401/403/429 remain explicit
failures and trigger the existing fallback.

## Connectivity observed

In the 2026-11-17 session, ordinary Node requests to both
`query1.finance.yahoo.com` and `query2.finance.yahoo.com` chart endpoints returned
HTTP 403. A Google Finance page request failed with a connection reset. Thus
the implementation and deterministic tests do not establish live Yahoo data
availability on this network. The bridge reports the actual failure and does
not present invented prices as live data.

Google documents `GOOGLEFINANCE` as a Sheets function and says its historical
results cannot be read through the Sheets API or Apps Script. That does not
supply a usable historical-data adapter for this app.
[Google's function documentation](https://support.google.com/docs/answer/3093281/googlefinance?hl=en).
The chart response structure used here can also be inspected in the
[yfinance history implementation](https://github.com/ranaroussi/yfinance/blob/main/yfinance/scrapers/history.py).
This is an unofficial Yahoo integration; the source-code MIT license does not
license third-party data.

On 2026-11-23 Yahoo chart requests still returned HTTP 403. Eastmoney ordinary
and adjusted daily endpoints returned HTTP 200; the adjusted response allowed
browser requests with `Access-Control-Allow-Origin: *`. A production-browser
check with an anonymous CNY 1,000 deposit used real historical FX and adjusted
benchmarks from 2025-09-02 through the 2026-11-20 security close. IVV showed
9.42% and QQQ 8.20%, with Eastmoney source labels. This was repeated on mobile
after refresh. The live Yahoo path remains unverified; it is no longer needed
for this tested automatic benchmark path. Subsequent representative holdings
and split checks are recorded below.

Those HTTP 403 observations describe earlier requests, not a permanent Yahoo
outage. Grokbot reported a successful full daily IVV response on its network;
that report is user-supplied evidence, not an Atlas live verification. After
the epoch-bound fix, this session's direct IVV request timed out after 10
seconds. Successful tests establish the corrected request and granularity
validation, while live availability remains dependent on the network and
upstream access decisions. Complete representative holdings/split checks on
the static path are now recorded in [release checks](RELEASE_CHECK.md) and
[split checks](STOCK_SPLITS.md).
