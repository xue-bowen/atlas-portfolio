# GitHub Pages release preparation

**Release hold (2026-11-23):** the owner requires complete market data before
the repository or site becomes public, and approved technically usable free
Google/Yahoo sources for non-commercial prototype development. The Yahoo
adapter and local bridge are implemented, but current Yahoo requests return
HTTP 403. Eastmoney ordinary closes and automatic adjusted IVV/QQQ comparisons
now work in the tested production-browser sample without a backend. A Yahoo
bridge is therefore optional for that static path; if used, it still needs
separate hosting and `VITE_YAHOO_BRIDGE_URL` at build time. See
[source setup](YAHOO_FINANCE.md). Broader holdings/history coverage and release
checks remain required. The CSV browser control remains deferred.

The website build is static. No ledger or backup file is part of the build:
the browser starts with anonymous demo data until a user creates a local
personal ledger. The published project URL will be
`https://xue-bowen.github.io/atlas-portfolio/` if GitHub Pages is configured
for this repository under the current owner.

The default `xue-bowen.github.io` host shares a browser storage origin across
all project paths under that host. Check whether other Pages projects on that
host are trusted before using a personal ledger there; a dedicated domain gives
Atlas its own storage boundary.

The workflow in `.github/workflows/pages.yml` uses **manual dispatch only**.
Pushing code cannot deploy it. It builds `web` with the `/atlas-portfolio/`
base path, runs tests and lint, then uploads `web/dist` to GitHub Pages.

Before the first public deployment:

1. Clear the market-data gate: verify complete current/historical holdings and
   FX coverage, and dividend/split-adjusted IVV/QQQ comparisons with anonymous
   live-data checks. Missing or unavailable benchmarks do not clear this gate.
   Confirm repository contents, Git history, MIT license, dependency audit,
   and third-party terms are acceptable for public release. Recheck the current
   terms at release time. The source-code MIT license does not license data.
2. Make the repository public if the account uses GitHub Free. GitHub Pages
   sites are public even when the repository stays private under a paid plan.
3. In repository **Settings → Pages**, select **GitHub Actions** as the source.
4. In **Actions → Deploy Atlas Portfolio to GitHub Pages**, run the workflow
   from `main`. Confirm the deployment URL reported by the job.
5. Open the site in a clean desktop browser and a clean phone-sized browser,
   enter only anonymous records, test backup/restore, refresh, and check the
   console and layout. Do not import a real personal ledger into that test.

Local production-path smoke test from `web`:

```bash
npm ci
npm test
npm run lint
npm run build:pages
npm run preview -- --base=/atlas-portfolio/ --host 127.0.0.1 --port 5266 --strictPort
```

Open `http://127.0.0.1:5266/atlas-portfolio/`. This is a disposable local
origin and will not access the separate ledger at `127.0.0.1:5224`.
