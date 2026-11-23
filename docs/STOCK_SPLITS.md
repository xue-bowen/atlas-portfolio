# Stock splits and reverse splits

Use **Add transaction → Stock split / reverse split**. Enter the first trading
date on the new share basis, symbol, and the whole-number ratio of new shares
to old shares. A 10-for-1 split uses `newShares=10`, `oldShares=1`; a 1-for-10
reverse split uses `newShares=1`, `oldShares=10`.

The holding must already exist before that date. The entry changes quantity
and average cost while preserving total acquisition cost, cash, fees, and
realized P&L at that instant. It is not income or an external contribution.
Later sales allocate cost using the new quantity. The preview includes those
later transactions, so the *remaining* cost and realized P&L may change when
inserting a missing historical split.

Manual additions insert the split before existing records on its date without
changing their relative order. JSON/CSV imports retain their original same-day
order: put a split before that security's trades on the effective date. Invalid
ratios, missing holdings, duplicate symbol/date splits, and imports with the
split after same-day trades are rejected. Editing and deletion recalculate
the full timeline and cannot create a later oversell.

Price refreshes do not create split events. Record every split in the held
period and use ordinary, as-traded historical closes for NAV. Adjusted closes
remain benchmark-only. Fractional holdings are retained after reverse splits;
cash paid instead of fractions, mergers, spin-offs, and symbol changes are
outside this first split flow. Do not model those using a made-up split.

## Storage and backup compatibility

New complete JSON backups use schema **3** and include split events and
security profiles. Raw event arrays and schema 1/2 backups remain importable.
Older Atlas versions reject schema 3 instead of silently losing split events.
The existing IndexedDB record container is unchanged; current balances and
history rebuild from its ledger events without resetting personal data.

CSV split rows use `type=STOCK_SPLIT`, `symbol`, `newShares`, and `oldShares`
in addition to the four common columns. See [CSV import](CSV_IMPORT.md).

## Anonymous live check

Restore [the pre-entry fixture](examples/anonymous-split-before-entry.json)
only on a disposable origin. Its account, amounts, trades, and fees are all
fictional. It deliberately omits the split so it can be added through the UI.

Enter NVDA, 2024-06-10, 10 new shares for 1 old share. NVIDIA's
[issuer announcement](https://investor.nvidia.com/news/press-release-details/2024/NVIDIA-Announces-Financial-Results-for-First-Quarter-Fiscal-2025/)
confirms that new-basis trading began on that date. With the fixture's later
one-share sale, the resulting holding must be **19 shares**, remaining cost
**USD 2,281.90**, average cost **USD 120.10**, realized P&L **USD 8.90**, USD cash
**7,727.00**, CNY cash **30,000.00**, and total fees **USD 3.00**.

On 2026-11-23, actual Eastmoney `fqt=0` closes were USD 1,208.88 on 2024-06-07,
121.79 on 2024-06-10, and 120.91 on 2024-06-11. The before/after quantity
change therefore pairs with the price basis change. The live browser check
produced CNY NAV 102,515.10 → 102,670.80 across those first two closes,
without a fictitious 90% loss, and loaded both adjusted benchmarks. These
amounts validate this anonymous sample; they are not a personal return claim.

The actual UI-exported [schema-v3 backup](examples/anonymous-split-backup.json)
restored all five events and the NVDA mapping on a separate clean root-path
origin. It recalculated the same 19 shares and historical result. The first
fixture deliberately uses schema 2 to check compatibility; use the schema-3
file when checking a complete split round trip.
