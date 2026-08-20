# Atlas Portfolio - Project Status

## Current stable checkpoint

Latest committed and pushed version:

`ffa8a7d feat: calculate dividend reinvestment shares`

Repository: `git@github.com:xue-bowen/atlas-portfolio.git` (private)

Windows local path:

`C:\Users\28301\atlas-portfolio`

Last updated: 2026-08-21

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

Anonymous browser tests verified balance updates and persistence after refresh.
The latest reinvestment test confirmed that buying below the existing average
cost lowers the average cost per share.

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

## Next task

Implement a manual USD interest form:

- date
- amount received in USD
- save as an `INTEREST` ledger event
- increase USD cash without changing positions or trading P&L
- verify persistence after refresh with anonymous data

After interest, continue with independent USD fees and CNY withdrawal. Do not
start recording substantial real history until the user has manually tested the
current workflow and exported a local JSON backup.
