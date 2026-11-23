# Private trial and GitHub Pages release

## Current private trial

The owner-only Sites trial is live at
[Atlas Portfolio](https://atlas-portfolio.schneider200con.chatgpt.site).
Sign in with the owner's ChatGPT account. Visitors without access see the
platform sign-in gate; sharing has not been opened to friends or the public.
The GitHub repository remains private.

Site identity is recorded in `.openai/hosting.json`. The first deployment used
Sites source commit `b4999d62d0942a821550e224add37e5cd697a9a0` and saved version
`appgprj_6b0411e40de8819185b0bd635313039c~appgver_73cf1d90eca08191a7976265d5ff393a`.
The native deployment returned `succeeded` on 2026-11-23. A browser visit
confirmed the sign-in gate; authenticated hosted-app behavior still needs the
owner's trial. Local production builds passed the anonymous checks below.

This is a static deployment with Eastmoney prices and Frankfurter FX. It has
no Yahoo backend or cloud ledger. The release packet contains only the
hosting manifest, compiled HTML, JS, and CSS. It excludes ledger databases,
exports, example backup files, credentials, and Git history.

To prepare another Sites release from the repository root:

```bash
npm run build --prefix web -- --outDir ../dist
```

The root `dist/` is ignored. Use a fresh isolated staging checkout containing
only `.openai/hosting.json` and those compiled `dist/` assets. The official
Sites workflow helper owns its separate source Git repository and deployment
archive; never point that source helper at the private GitHub development
checkout. Preserve the Site ID and owner-only audience on subsequent updates.

## Public release and Pages

**Release hold (2026-11-23):** the owner requires complete market data before
the repository or site becomes public, and approved technically usable free
Google/Yahoo sources for non-commercial prototype development. The Yahoo
adapter and local bridge are implemented, but current Yahoo requests return
HTTP 403. Eastmoney ordinary closes and automatic adjusted IVV/QQQ comparisons
now work in the tested production-browser sample without a backend. The
representative holdings and export/restore checks also pass on the Pages
production path; see [repeatable release check](RELEASE_CHECK.md). A Yahoo
bridge is therefore optional for that static path; if used, it still needs
separate hosting and `VITE_YAHOO_BRIDGE_URL` at build time. See
[source setup](YAHOO_FINANCE.md). Manual share splits are now supported and
verified across actual historical prices; other corporate actions remain
explicit limits. Public audience and publication checks remain pending. The
CSV browser control remains deferred.

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
   console and layout. Use [the release fixture and reconciliation rules](RELEASE_CHECK.md).
   Do not import a real personal ledger into that test.

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
