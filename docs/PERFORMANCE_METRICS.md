# Atlas Portfolio Performance Metrics

## Current calculation boundary

Atlas measures one portfolio made up of every account tracked by the app. A
transfer across that boundary is an external flow. Trades, currency conversion,
income, and expenses that happen inside the tracked accounts remain portfolio
activity.

| Ledger event | Performance classification | Valuation |
|---|---|---|
| `CNY_DEPOSIT` | External cash contribution | Recorded CNY amount |
| `CNY_WITHDRAWAL` | External cash withdrawal | Recorded CNY amount |
| `IN_KIND_CONTRIBUTION` | External non-cash contribution | Quantity multiplied by entry USD price, translated with that date's USD/CNY valuation rate |
| FX, buy, sell, dividend, interest, and fee events | Internal portfolio activity | No external flow |

Contribution values are positive inputs. Withdrawal values are positive
outputs. A daily signed net external flow is calculated as cash contributions
plus in-kind contributions minus withdrawals.

## Daily close snapshot

A daily snapshot is derived from the ledger and can always be rebuilt. For a
snapshot date, Atlas replays every ledger event through that date, including all
events on the date, in chronological order. Events on the same date retain their
ledger order. The resulting cash balances and positions are valued after the
last event of the day.

Each snapshot records:

- date and calculation version;
- CNY, HKD, and USD cash balances plus open position quantities and costs;
- cash value in CNY;
- security market value in USD and CNY;
- total CNY NAV;
- that date's external-flow records and separate CNY totals for cash
  contributions, withdrawals, and in-kind contributions;
- the security mappings, closing quotes, FX observations, providers, original
  institutions, market timestamps, fetch timestamps, and delay flags used by
  the calculation.

The required inputs are supplied per date. A quote can represent the latest
available close for a non-trading day, so its market timestamp remains separate
from the snapshot date. USD/CNY is required when USD cash, USD securities, or a
USD in-kind contribution needs translation. HKD/CNY is required when the HKD
cash balance is non-zero.

Atlas does not create a complete snapshot when a held security lacks an
identifier or closing quote, a held currency lacks its valuation rate, an FX
pair is reversed, or a required value is invalid. This prevents missing assets
from being treated as zero.

## CNY contributions and total P&L

Daily external-flow totals accumulate independently so cash funding, in-kind
funding, and withdrawals remain auditable:

\[
Net\ Contributions=Cumulative\ Cash\ Contributions+Cumulative\ InKind\ Contributions-Cumulative\ Withdrawals
\]

\[
Total\ P\&L_{CNY}=NAV_{CNY}+Cumulative\ Withdrawals-Cumulative\ Cash\ Contributions-Cumulative\ InKind\ Contributions
\]

The same relationship can be written as `Total P&L = NAV - Net
Contributions`. Total P&L is a currency amount, not a return rate. The series is
calculated in date order from complete versioned snapshots. Duplicate dates,
unsupported calculation versions, negative external-flow totals, or a daily net
flow that does not reconcile to its components invalidate the series.

## CNY XIRR / money-weighted return

CNY XIRR measures the annualized return experienced by the investor. Atlas
converts dated external flows to the investor perspective before solving:

- cash and in-kind contributions are negative cash flows;
- withdrawals are positive cash flows;
- the ending CNY NAV is appended on the final snapshot date as the terminal
  portfolio value, including when that value is zero.

The solver uses actual UTC calendar-day differences divided by 365
(`ACTUAL/365`). It searches annual rates from `-99.9999%` through `1,000,000%`
and retains full floating-point precision internally. The interface may round
the displayed percentage but must not round the cash flows before calculation.

A valid series needs at least one positive cash flow, one negative cash flow,
and cash-flow dates spanning at least two dates. If no root exists in the
supported range, XIRR is unavailable. If more than one root exists, Atlas
reports the series as ambiguous instead of silently choosing one result.

The current Performance summary can calculate a terminal view before historical
snapshots are persisted. It uses the complete current CNY valuation as ending
NAV, groups CNY deposits and withdrawals by their ledger dates, and translates
each in-kind contribution with its dated USD/CNY rate. Internal trades, FX,
income, and expenses remain outside the investor cash-flow list. If current NAV
or a dated in-kind-contribution rate is unavailable, Atlas keeps independent
cash-flow totals visible but does not show the dependent total P&L or XIRR. This
terminal view does not create substitute historical NAV points; TWR and charts
still require real dated valuations.

## USD daily-close time-weighted return

USD TWR measures the investment result independently of the size of external
funding. It uses complete, version-1 daily portfolio snapshots. Every snapshot
in the series needs a positive USD/CNY valuation rate, including a CNY-only
cash day: `NAV_USD = NAV_CNY / USD_CNY`. This values CNY and HKD cash, USD cash,
and securities within the same portfolio boundary. A missing or invalid rate
blocks the series; a partial portfolio value is never substituted.

Each CNY deposit or withdrawal is translated at its snapshot date's USD/CNY
rate. An in-kind share contribution uses its entry USD value. For each date,
same-day flows retain their classification but are summed into one signed USD
net flow. FX, trades, dividends, interest, and fees remain internal.

The first input must be a positive-NAV close. It sets the base index to 100 and
has no measured return. For each later close, Atlas treats that day's external
flows as taking place at the close, after that day's investment return. They are already in
closing NAV, so the pre-flow close and subperiod return are:

\[
PreFlowNAV_{USD,t}=ClosingNAV_{USD,t}-NetExternalFlow_{USD,t}
\]

\[
r_t=\frac{PreFlowNAV_{USD,t}}{ClosingNAV_{USD,t-1}}-1
\qquad
Index_t=Index_{t-1}(1+r_t)
\]

The cumulative USD TWR is `Index / 100 - 1`. Dates are sorted without
changing the source snapshots. Each date can occur once, and the series must
include a complete close on every date with an external flow. A close-only
series cannot measure returns between intraday deposits or withdrawals; the
end-of-day convention is explicit rather than claiming intraday precision.
The first close's intraday return is likewise outside the measured period.

An empty input yields an empty series. Duplicate or invalid dates, unsupported
snapshot versions, inconsistent flow totals or classifications, missing USD/CNY,
negative or non-finite NAV, a non-positive starting NAV, negative pre-flow NAV,
or non-finite chained values invalidate the series. A zero closing NAV can
represent a total loss or full exit, but no later period can be calculated from
it without a new positive-NAV anchor.

## Recalculation

The ledger remains the source of truth. Prices, rates, and daily snapshots are
derived inputs and outputs. Editing a historical event, security mapping, close,
or FX rate invalidates snapshots from the earliest affected date. Recalculation
uses calculation version `1` and replaces those derived snapshots in date order.

## Anonymous hand-worked example

The deterministic domain example begins with a CNY 8,000 contribution. On the
next day, CNY 7,000 becomes USD 1,000 and four anonymous shares are bought for
USD 100 each plus a USD 4 fee. At a USD 110 close and USD/CNY 7.00, cash is worth
CNY 5,172, securities are worth CNY 3,080, and NAV is CNY 8,252. The conversion,
purchase, and fee produce no external flow.

On day three, 0.5 shares arrive as an external in-kind contribution at USD 120.
Its contribution value is USD 60, or CNY 420 at USD/CNY 7.00. With 4.5 shares
closing at USD 120, NAV is CNY 8,952. The CNY 420 contribution is kept separate
from investment performance.

On day four, a CNY 300 withdrawal gives a signed daily external flow of CNY
-300. With CNY 700, USD 596, HKD 20, 4.5 shares at USD 100, USD/CNY 7.20, and
HKD/CNY 0.92, the end-of-day NAV is CNY 8,249.60. Cumulative cash
contributions are CNY 8,000, cumulative in-kind contributions are CNY 420, and
cumulative withdrawals are CNY 300. Net contributions are therefore CNY 8,120
and total CNY P&L is CNY 129.60.

A separate one-year XIRR check contributes CNY 1,000 on 2025-01-01 and ends
with CNY 1,100 NAV on 2026-01-01. Its investor cash flows are CNY -1,000 and
CNY +1,100, producing an annualized CNY XIRR of 10% under `ACTUAL/365`.

For a USD TWR check, an initial USD 100 close anchors the index at 100. A USD
110 close without external flows yields a 10% subperiod return. On the next
date, a CNY 350 cash deposit at USD/CNY 7, a USD 20 in-kind contribution, and a
CNY 70 withdrawal net to USD +60. If closing NAV is USD 181, its pre-flow NAV
is USD 121; the second subperiod return is 10%, and the linked index is 121.

Chart presentation and benchmark alignment remain separate steps. Public-version
benchmark comparison is limited to IVV and QQQ.
