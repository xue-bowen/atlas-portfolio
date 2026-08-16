# Atlas Portfolio — Project Status

## Current stable checkpoint

Latest committed and pushed version:

`d3502a6 feat: initialize empty personal ledger`

Repository: `git@github.com:xue-bowen/atlas-portfolio.git` (private)

Windows local path:

`C:\Users\28301\atlas-portfolio`

## Confirmed product rules

- Desktop-first React + TypeScript + Vite web app.
- CNY is the funding and wealth-view currency.
- USD is the investment and holding currency.
- Flow: CNY deposit → FX conversion → USD cash → buy/sell/dividend.
- Sales and dividends remain USD cash until an explicit USD-to-CNY conversion.
- Ledger events are the single source of truth.
- Personal records are browser-local only; never commit them to GitHub.
- Do not use `git add .`; explicitly list files when staging.

## Implemented and verified

- Typed ledger events: deposits, withdrawals, FX, buy/sell, dividends, interest, fees.
- CNY/USD cash calculation.
- Open positions with moving-average USD cost basis.
- Realized USD P&L and cumulative trading fees.
- Anonymous demo ledger for calculation tests.
- Browser localStorage read/write.
- Explicit separation of demo data and empty personal ledger.
- Personal CNY-deposit form, retained after browser refresh.

The local CNY 100 record is test data only and is not in Git.

## Development workflow

From the repository root:

`git status`

`git log -1 --oneline`

From the `web` directory:

`npm run build`

`npm run dev`

After browser verification:

`git add <explicit-file-paths>`

`git commit -m "type: short description"`

`git push`

`git status`

## Next task

Add a manual FX conversion form:

- date
- CNY amount spent
- USD amount received
- save to local ledger
- verify both cash balances change correctly and persist after refresh

Before entering substantial real history, implement local JSON export/import backup.