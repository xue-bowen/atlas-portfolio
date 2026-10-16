import { describe, expect, it } from "vitest";
import { calculateBalances } from "./calculateBalances";
import {
  buildLedgerEdit,
  getLedgerEditFields,
  ledgerEditValues,
  replaceLedgerEvent,
} from "./editLedgerEvent";
import type { LedgerEvent } from "./ledger";

const base = { accountId: "anonymous", occurredAt: "2026-10-01" };
const ledger: LedgerEvent[] = [
  { ...base, id: "fund", type: "CNY_DEPOSIT", amountCny: 7000 },
  { ...base, id: "fx", type: "FX_TO_USD", amountCny: 7000, amountUsd: 1000 },
  {
    ...base,
    id: "buy",
    type: "BUY",
    symbol: "ANON",
    quantity: 4,
    priceUsd: 100,
    feeUsd: 4,
  },
  {
    ...base,
    occurredAt: "2026-10-03",
    id: "sell",
    type: "SELL",
    symbol: "ANON",
    quantity: 1.5,
    priceUsd: 120,
    feeUsd: 1,
  },
];
const edit = (event: LedgerEvent, changes: Record<string, string>) =>
  buildLedgerEdit(event, { ...ledgerEditValues(event), ...changes });

describe("transaction editing", () => {
  it("replaces one record and recalculates later sale cost, P&L, and cash without mutation", () => {
    const snapshot = JSON.stringify(ledger);
    const result = replaceLedgerEvent(
      ledger,
      edit(ledger[2], { priceUsd: "90", note: "Anonymous correction" }),
    );
    expect(result).toHaveLength(4);
    expect(result.map((event) => event.id)).toEqual(
      ledger.map((event) => event.id),
    );
    expect(result[2].note).toBe("Anonymous correction");
    expect(JSON.stringify(ledger)).toBe(snapshot);
    expect(calculateBalances(result)).toEqual({
      cnyCash: 0,
      hkdCash: 0,
      usdCash: 815,
      totalFeesUsd: 5,
      realizedPnlUsd: 42.5,
      positions: [{ symbol: "ANON", quantity: 2.5, costUsd: 227.5 }],
    });
  });

  it("rejects a reduced purchase or renamed symbol that invalidates a later sale", () => {
    expect(() =>
      replaceLedgerEvent(ledger, edit(ledger[2], { quantity: "1" })),
    ).toThrow(/insufficient position/i);
    expect(() =>
      replaceLedgerEvent(ledger, edit(ledger[2], { symbol: "OTHER" })),
    ).toThrow(/insufficient position/i);
  });

  it("rejects moving the acquisition after the sale", () => {
    expect(() =>
      replaceLedgerEvent(ledger, edit(ledger[2], { occurredAt: "2026-10-04" })),
    ).toThrow(/insufficient position/i);
  });

  it("rejects cash shortfalls even when a later contribution would cover the final balance", () => {
    const fundedLater: LedgerEvent[] = [
      ...ledger,
      {
        ...base,
        occurredAt: "2026-10-05",
        id: "later",
        type: "INTEREST",
        amountUsd: 1000,
      },
    ];
    expect(() =>
      replaceLedgerEvent(fundedLater, edit(ledger[2], { priceUsd: "300" })),
    ).toThrow(/insufficient cash/i);
    expect(() =>
      replaceLedgerEvent(ledger, edit(ledger[0], { amountCny: "6000" })),
    ).toThrow(/insufficient cash/i);
  });

  it("keeps the original same-day order and reorders valid date edits", () => {
    const result = replaceLedgerEvent(
      ledger,
      edit(ledger[3], { occurredAt: "2026-10-01" }),
    );
    expect(result.map((event) => event.id)).toEqual([
      "fund",
      "fx",
      "buy",
      "sell",
    ]);
    const earlier = replaceLedgerEvent(
      ledger,
      edit(ledger[0], { occurredAt: "2026-09-30" }),
    );
    expect(earlier[0].occurredAt).toBe("2026-09-30");
  });

  it("preserves immutable identity, ignores unrelated draft properties, and normalizes symbols", () => {
    const result = edit(ledger[2], {
      id: "fake",
      type: "SELL",
      accountId: "fake",
      symbol: " anon ",
      note: "  corrected  ",
      amountUsd: "42",
    });
    expect(result).toMatchObject({
      id: "buy",
      type: "BUY",
      accountId: "anonymous",
      symbol: "ANON",
      note: "corrected",
    });
    expect(result).not.toHaveProperty("amountUsd");
  });

  it("does not turn an absent note into visible text during replacement", () => {
    const result = replaceLedgerEvent(
      ledger,
      edit(ledger[2], { priceUsd: "95" }),
    );
    expect(result[2].note).toBeUndefined();
  });

  it("rejects missing/duplicate records and changes to type or account", () => {
    expect(() => replaceLedgerEvent([], ledger[0])).toThrow(
      /existing transaction/i,
    );
    expect(() => replaceLedgerEvent([ledger[0], ledger[0]], ledger[0])).toThrow(
      /existing transaction/i,
    );
    expect(() =>
      replaceLedgerEvent(ledger, { ...ledger[0], accountId: "other" }),
    ).toThrow(/cannot change/i);
    expect(() =>
      replaceLedgerEvent(ledger, {
        ...base,
        id: "fund",
        type: "CNY_WITHDRAWAL",
        amountCny: 1,
      }),
    ).toThrow(/cannot change/i);
  });

  it.each(["", "0", "-1", "Infinity", "NaN"])(
    "rejects invalid quantity %s",
    (quantity) => {
      expect(() => edit(ledger[2], { quantity })).toThrow(/quantity/i);
    },
  );

  it.each(["", "2026-02-30", "2026-13-01", "not-a-date"])(
    "rejects invalid date %s",
    (occurredAt) => {
      expect(() => edit(ledger[0], { occurredAt })).toThrow(/date/i);
    },
  );

  it("rejects non-finite calculated amounts", () => {
    expect(() =>
      replaceLedgerEvent(
        ledger,
        edit(ledger[2], { priceUsd: "1e308", quantity: "1e308" }),
      ),
    ).toThrow();
  });
});

describe("event-specific editing", () => {
  const events: LedgerEvent[] = [
    ...ledger,
    { ...base, id: "withdraw", type: "CNY_WITHDRAWAL", amountCny: 10 },
    {
      ...base,
      id: "return-fx",
      type: "FX_TO_CNY",
      amountCny: 70,
      amountUsd: 10,
    },
    {
      ...base,
      id: "reward",
      type: "IN_KIND_CONTRIBUTION",
      source: "CASHBACK_REWARD",
      currency: "USD",
      symbol: "ANON",
      quantity: 0.25,
      priceUsd: 100,
    },
    {
      ...base,
      id: "dividend",
      type: "DIVIDEND",
      symbol: "ANON",
      grossAmountUsd: 10,
      withholdingTaxUsd: 2,
    },
    { ...base, id: "legacy-interest", type: "INTEREST", amountUsd: 3 },
    { ...base, id: "interest", type: "INTEREST", currency: "HKD", amount: 3 },
    { ...base, id: "fee", type: "FEE", category: "ADR_FEE", amountUsd: 1 },
  ];

  it.each(events)(
    "round-trips $type ($id) using only its own fields",
    (event) => {
      expect(buildLedgerEdit(event, ledgerEditValues(event))).toEqual({
        ...event,
        note: undefined,
      });
      expect(getLedgerEditFields(event).length).toBeGreaterThan(0);
    },
  );

  it("retains legacy interest format and supports currency-specific interest", () => {
    expect(edit(events[8], { amountUsd: "5" })).toMatchObject({ amountUsd: 5 });
    expect(edit(events[9], { currency: "CNY", amount: "7" })).toMatchObject({
      currency: "CNY",
      amount: 7,
    });
    expect(() => edit(events[9], { currency: "EUR" })).toThrow(/currency/i);
  });

  it("retains cashback provenance and USD currency", () => {
    expect(
      edit(events[6], { source: "OTHER", currency: "CNY", quantity: "0.5" }),
    ).toMatchObject({
      source: "CASHBACK_REWARD",
      currency: "USD",
      quantity: 0.5,
    });
  });

  it("rejects excess dividend tax and unknown expense categories", () => {
    expect(() => edit(events[7], { withholdingTaxUsd: "11" })).toThrow(
      /cannot exceed/i,
    );
    expect(() => edit(events[10], { category: "UNKNOWN" })).toThrow(
      /category/i,
    );
  });
});
