# Market-price CSV format (import in progress)

Atlas will accept a UTF-8 CSV with one US-dollar daily close per row. Rows may
be out of date order. The first row contains these exact column names:

```csv
date,symbol,exchange,assetType,closeUsd,adjustedCloseUsd
2026-01-02,IVV,NYSE ARCA,ETF,600.50,599.80
2026-01-02,QQQ,NASDAQ,ETF,520.25,519.90
```

`date` uses `YYYY-MM-DD`. `assetType` is `STOCK` or `ETF`; `symbol` and
`exchange` must match the security profile used by Atlas. `closeUsd` is the
actual daily close used for holdings valuation. `adjustedCloseUsd` is optional
for ordinary holdings, but IVV/QQQ total-return comparisons will require a
source whose adjusted close accounts for distributions and splits. Every
price must be positive. Repeated date/security rows are rejected. Do not put
transactions, account IDs, API keys, or other personal records in this file.

The parser and local IndexedDB daily-price store are implemented. Imported
observations can be looked up by security and the latest trading date on or
before a requested date, so weekends do not require invented prices. Historical
portfolio valuation prefers these local observations when present and uses the
existing quote service otherwise. IVV/QQQ comparisons now require positive
`adjustedCloseUsd` at two distinct closes and calculate the adjusted-close
ratio. If local adjustments do not cover both endpoints, the configured
[Yahoo daily source](YAHOO_FINANCE.md) can supply both instead, with Eastmoney
forward-adjusted daily data as the next fallback. Different sources
are never mixed within a benchmark ratio. Missing local and automatic
adjustments leave the benchmark unavailable. Use one consistently adjusted
data series for both dates. The browser import control is deferred, so a CSV
is not yet usable through the app UI.
