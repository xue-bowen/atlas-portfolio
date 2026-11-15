# Privacy and local data

Atlas Portfolio has no sign-in, cloud ledger, or application analytics service.
The static web app runs calculations in the browser. Personal transactions are
stored in IndexedDB; security profiles and the one-time migration marker use
localStorage. Market-data cache records use a separate IndexedDB database.
The app does not send a complete ledger or JSON/CSV import file to its host.

Each browser origin has separate storage. A locally run version and a future
hosted version will therefore start with separate ledgers. Clearing site data,
using a private browsing window, or moving devices can remove access to the
ledger. Use **Settings → Export JSON backup** regularly and keep that file in
a safe place. The export includes transaction events and security profiles but
does not include market-data cache entries. **Import JSON backup** replaces the
local ledger; **Merge transactions** adds reviewed events from JSON or CSV.

An origin is the protocol, host, and port; URL paths are not separate storage
boundaries. On the default GitHub Pages domain, other project sites under
`xue-bowen.github.io` share the same browser origin and can access this origin's
storage. Use a dedicated host if other projects on that domain are not trusted.

The browser makes direct HTTPS requests to third-party market-data services:

| Service | Request data | Purpose |
| --- | --- | --- |
| Frankfurter (`api.frankfurter.dev`) | Currency pairs and requested dates | Reference FX rates for valuation |
| Eastmoney (`push2his.eastmoney.com`) | Mapped security symbols and requested dates | US closing-price lookup |
| TradingView (`tradingview.com`) | A symbol in the opened URL, only after clicking a chart link | External market chart |

Those services can see the request and ordinary network metadata such as the
browser's IP address. A mapped security symbol may reveal an interest in that
security; the app does not send transaction quantities, account IDs, or a full
portfolio to these services. Review each service's own privacy terms before
using its data. Atlas does not control their retention or availability.

The repository and its issue tracker are public only when the owner publishes
them. Do not put personal investment data, backups, account identifiers, or
access tokens into issues, screenshots, commits, or pull requests.
