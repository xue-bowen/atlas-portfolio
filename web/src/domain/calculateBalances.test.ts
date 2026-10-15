import { describe, expect, it } from "vitest";
import { calculateBalances } from "./calculateBalances";
import type { LedgerEvent } from "./ledger";
import { removeLedgerEvent } from "./removeLedgerEvent";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";

const ledger: LedgerEvent[] = [
  {
    id: "deposit",
    occurredAt: "2026-01-01",
    accountId: "test",
    type: "CNY_DEPOSIT",
    amountCny: 7_000,
  },
  {
    id: "fx",
    occurredAt: "2026-01-02",
    accountId: "test",
    type: "FX_TO_USD",
    amountCny: 7_000,
    amountUsd: 1_000,
  },
  {
    id: "buy",
    occurredAt: "2026-01-03",
    accountId: "test",
    type: "BUY",
    symbol: "TEST",
    quantity: 4,
    priceUsd: 100,
    feeUsd: 4,
  },
  {
    id: "sell",
    occurredAt: "2026-01-04",
    accountId: "test",
    type: "SELL",
    symbol: "TEST",
    quantity: 1.5,
    priceUsd: 120,
    feeUsd: 1,
  },
];

describe("calculateBalances", () => {
  it("calculates moving-average cost, sale proceeds, realized P&L, and fees", () => {
    const result = calculateBalances(ledger);

    expect(result.cnyCash).toBe(0);
    expect(result.usdCash).toBe(775);
    expect(result.realizedPnlUsd).toBe(27.5);
    expect(result.totalFeesUsd).toBe(5);
    expect(result.positions).toEqual([
      { symbol: "TEST", quantity: 2.5, costUsd: 252.5 },
    ]);
  });

  it("tracks after-tax interest in each supported cash currency", () => {
    const result = calculateBalances([
      {
        id: "cny-interest",
        occurredAt: "2026-01-01",
        accountId: "test",
        type: "INTEREST",
        currency: "CNY",
        amount: 10,
      },
      {
        id: "hkd-interest",
        occurredAt: "2026-01-01",
        accountId: "test",
        type: "INTEREST",
        currency: "HKD",
        amount: 20,
      },
      {
        id: "usd-interest",
        occurredAt: "2026-01-01",
        accountId: "test",
        type: "INTEREST",
        currency: "USD",
        amount: 30,
      },
    ]);

    expect(result.cnyCash).toBe(10);
    expect(result.hkdCash).toBe(20);
    expect(result.usdCash).toBe(30);
  });

  it("rejects a sale that exceeds the chronological position", () => {
    expect(() =>
      calculateBalances([
        { ...ledger[3], occurredAt: "2025-12-31" },
        ledger[2],
      ]),
    ).toThrow(/insufficient position/i);
  });
});

describe("ledger ordering", () => {
  it("sorts by date and keeps same-day source order without mutation", () => {
    const input = [ledger[2], ledger[1], ledger[0], ledger[3]];
    const snapshot = [...input];
    const result = sortLedgerEventsChronologically(input);

    expect(result.map((event) => event.id)).toEqual([
      "deposit",
      "fx",
      "buy",
      "sell",
    ]);
    expect(input).toEqual(snapshot);
  });
});

describe("removeLedgerEvent", () => {
  it("removes one event and returns a fully recalculated-valid ledger", () => {
    const remaining = removeLedgerEvent(ledger, "sell");
    const result = calculateBalances(remaining);

    expect(remaining.map((event) => event.id)).toEqual([
      "deposit",
      "fx",
      "buy",
    ]);
    expect(result.usdCash).toBe(596);
    expect(result.realizedPnlUsd).toBe(0);
    expect(result.totalFeesUsd).toBe(4);
    expect(result.positions[0]).toEqual({
      symbol: "TEST",
      quantity: 4,
      costUsd: 404,
    });
  });

  it("rejects deletion when a later sale would become invalid", () => {
    expect(() => removeLedgerEvent(ledger, "buy")).toThrow(
      /insufficient position/i,
    );
  });
});
