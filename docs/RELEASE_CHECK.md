# Anonymous production-path release check

Use [the fictional backup](examples/anonymous-release-backup.json) only on a
disposable origin. Every trade price, account, fee, dividend, and cash movement
in that file is invented. Public tickers identify the live data requests;
these records are not anyone's personal portfolio or a trading recommendation.
Do not restore this file over a personal ledger.

## Repeat the check

From `web`, run the tests, lint, `npm run build`, and `npm run build:pages`.
Start the production preview on a new port, for example:

```bash
npm run preview -- --base=/atlas-portfolio/ --host 127.0.0.1 --port 5275 --strictPort
```

1. Open `http://127.0.0.1:5275/atlas-portfolio/` with no prior data at that
   origin. Never use the protected manual-ledger origin on port 5224.
2. Import the fictional JSON through **Local backup**. Expect 14 events and
   3 security profiles. MSFT must remain mapped and marked closed; IVV and KO
   must remain open. No market-price CSV control is needed.
3. Wait for current prices and both FX rates. Check the ordinary price's
   source and actual date, complete coverage, and the ledger balances below.
4. Calculate history. All 14 selected snapshot dates must have prices and FX;
   both adjusted benchmark cards must show a return, actual close dates, and
   a source. Live values change, so do not hard-code a return as a release test.
5. Export JSON. Check the actual downloaded file contains the same events and
   security identifiers. Restore that exported file on a second new origin,
   recalculate using a fresh market cache, then reload and recalculate again.
6. At desktop 1440 × 1000 and phone 390 × 844, check navigation, portfolio
   tables, performance charts, backup controls, horizontal overflow, and the
   browser console. Restore the default viewport and stop temporary servers.

If a provider is unavailable, preserve that result as a failed live check;
invented network responses cannot establish release readiness.

## Ledger reconciliation

These expected values do not depend on live prices:

| Item | Expected |
| --- | ---: |
| CNY cash | 28,500.00 |
| USD cash | 7,086.50 |
| HKD cash | 2.00 |
| IVV quantity / remaining cost in USD | 3 / 1,800.60 |
| KO quantity / remaining cost in USD | 11 / 771.00 |
| MSFT quantity | 0 |
| Realized P&L in USD | 76.60 |
| Fees and USD expenses | 7.00 |

For live USD/CNY rate `u`, HKD/CNY rate `h`, and ordinary IVV/KO closes `i`/`k`:

```text
Securities USD = 3 × i + 11 × k
NAV CNY = 28,500 + (7,086.50 + Securities USD) × u + 2 × h
Net contributions CNY = 100,000 − 5,000 + 70 × USD/CNY on 2025-09-29
Total P&L CNY = NAV CNY − Net contributions CNY
```

The KO share reward is an external contribution; dividends and interest are
income. The MSFT sale proceeds stay in USD cash. Ordinary holdings prices are
unadjusted (`fqt=0`); benchmark pairs use one forward-adjusted series (`fqt=1`).

## Observed on 2026-11-23

Production Pages-path builds on ports 5275 and 5276 used actual Eastmoney and
Frankfurter responses, with no fixture network override or Yahoo bridge.

- Both open positions were covered: IVV USD 693.71 and KO USD 96.99, dated
  2026-11-20. Securities value was USD 3,148.02.
- Current USD/CNY was 6.6703 and HKD/CNY 0.85017, observed 2026-11-23.
  Current NAV was CNY 96,769.02, matching the independent formula above.
  Net contributions were CNY 95,498.41; total P&L was CNY 1,270.61.
- History covered 2025-09-02 through 2026-11-22 in 14 selected snapshots,
  including the period when now-closed MSFT was held. Historical ending NAV
  was CNY 96,772.09 and USD TWR was 8.27%. Historical valuation uses dated FX,
  so it can differ from the current NAV using the latest FX observation.
- IVV and QQQ adjusted reference returns were 9.42% and 8.20%, respectively,
  with actual endpoint closes 2025-09-02 and 2026-11-20, both from Eastmoney.
- The exported schema-v2 JSON retained all 14 events and 3 profiles. A second
  fresh origin restored the actual export, not a reconstructed replacement.
  Reload retained the records and closed-position mapping; recalculation
  reproduced the historical values and both benchmark returns.
- Desktop 1440 px and phone 390 px had no horizontal page overflow or console
  warnings/errors. Mobile navigation, backup controls, valuation cards, and
  both performance charts were checked. The protected port 5224 was untouched.

This verifies a representative multi-currency portfolio and the static path.
It does not establish coverage of every ticker, corporate action, long date
range, geography, or future provider availability. Manual share splits now
have a separate [live check and backup fixture](STOCK_SPLITS.md). Other
corporate actions remain outside that flow.

## Completed-close rule

Latest ordinary prices, adjusted benchmarks, and historical snapshot selection
share a New York calendar ceiling: today's bar is eligible only at 16:15 ET.
The [NYSE regular session](https://www.nyse.com/trade/hours-calendars) ends at
16:00 ET; Atlas deliberately adds 15 minutes. Summer/winter offsets follow
`America/New_York`. This is conservative on early-close days. Providers carry
weekends and holidays back to an actual observation date; this helper is not
a holiday calendar.

Unfinished dated ordinary requests are rejected rather than permanently cached
under a date whose close can still change. Older Eastmoney entries fetched
before their bar/request date was complete are ignored and re-fetched, even
when the old cache expiry claims permanence. A failed refresh cannot revive
such an intraday entry as stale fallback.
