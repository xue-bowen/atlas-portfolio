# Generic CSV transaction import

Use **Settings → Merge transactions → Choose JSON or CSV batch** to preview a
CSV file before saving. Start an empty personal ledger first. Atlas keeps the
current ledger untouched until you select **Save merged transactions**. Back up
your browser ledger as JSON before importing a large history.

The CSV must be UTF-8 with a header row. The four columns `id`, `occurredAt`,
`accountId`, and `type` are required. Other columns may be omitted when the
selected transaction types do not use them. Fields may be quoted using standard
CSV double quotes. Dates use `YYYY-MM-DD`; monetary and quantity values are
plain numbers with a period as the decimal separator and no currency symbols.
Keep a stable, unique `id` from the source record or assign one in the CSV.
An existing identical ID is skipped; the same ID with different details is an
error. Two distinct transactions with the same date and amount need distinct
IDs. Rows may arrive out of date order, but same-day rows retain file order.

| `type` | Additional required columns |
| --- | --- |
| `CNY_DEPOSIT`, `CNY_WITHDRAWAL` | `amountCny` |
| `FX_TO_USD`, `FX_TO_CNY` | `amountCny`, `amountUsd` |
| `BUY`, `SELL` | `symbol`, `quantity`, `priceUsd`, `feeUsd` |
| `DIVIDEND` | `symbol`, `grossAmountUsd`, `withholdingTaxUsd` |
| `INTEREST` | `currency` (`CNY`, `HKD`, or `USD`), `amount` |
| `FEE` | `amountUsd`, `category` (`COMMISSION`, `ADR_FEE`, or `OTHER`) |
| `IN_KIND_CONTRIBUTION` | `symbol`, `quantity`, `priceUsd`, `source` (`CASHBACK_REWARD`), `currency` (`USD`) |

`note` is optional for every type. These are all supported column names:
`id`, `occurredAt`, `accountId`, `type`, `amountCny`, `amountUsd`, `symbol`,
`quantity`, `priceUsd`, `feeUsd`, `grossAmountUsd`, `withholdingTaxUsd`,
`currency`, `amount`, `category`, `source`, `note`. Atlas also accepts the
legacy `INTEREST` form with `amountUsd` instead of `currency` and `amount`.

Anonymous example:

```csv
id,occurredAt,accountId,type,amountCny,amountUsd,symbol,quantity,priceUsd,feeUsd,note
example-deposit,2026-01-02,personal-main,CNY_DEPOSIT,1000,,,,,,Initial funding
example-fx,2026-01-03,personal-main,FX_TO_USD,700,100,,,,,"Example conversion, including bank spread"
example-buy,2026-01-03,personal-main,BUY,,,IVV,1,80,0.5,Example purchase
```

This example is anonymous and illustrative; it is not a current market price.
The combined current ledger and CSV must form a valid chronological timeline:
cash and holdings cannot go negative at an earlier date just because funds or
shares arrive later. The preview shows added/skipped counts, projected cash,
and the first ten new events. This merge only adds ledger events; it leaves
security profiles unchanged. Use **Import JSON backup** for complete replacement
and profile restoration.
