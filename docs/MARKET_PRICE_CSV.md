# Market-price CSV format (planned import)

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

The parser is implemented first; the local import control and cache lookup are
the next development steps. A parsed CSV is not yet usable in the app.
