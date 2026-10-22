import { describe, expect, it } from "vitest";
import { calculateBalances } from "./calculateBalances";
import type { LedgerEvent } from "./ledger";
import { validateLedgerTimeline } from "./validateLedgerTimeline";

const validChronology: LedgerEvent[] = [
  {
    id: "deposit",
    occurredAt: "2026-01-01",
    accountId: "anonymous",
    type: "CNY_DEPOSIT",
    amountCny: 7_000,
  },
  {
    id: "fx",
    occurredAt: "2026-01-02",
    accountId: "anonymous",
    type: "FX_TO_USD",
    amountCny: 7_000,
    amountUsd: 1_000,
  },
  {
    id: "buy",
    occurredAt: "2026-01-03",
    accountId: "anonymous",
    type: "BUY",
    symbol: "TEST",
    quantity: 4,
    priceUsd: 100,
    feeUsd: 4,
  },
];

describe("validateLedgerTimeline", () => {
  it("accepts a complete batch supplied out of date order without mutating it", () => {
    const input = [validChronology[2], validChronology[0], validChronology[1]];
    const before = structuredClone(input);

    const ordered = validateLedgerTimeline(input);

    expect(ordered.map((event) => event.id)).toEqual([
      "deposit",
      "fx",
      "buy",
    ]);
    expect(calculateBalances(ordered).usdCash).toBe(596);
    expect(input).toEqual(before);
  });

  it("rejects an intermediate CNY shortfall hidden by a later deposit", () => {
    expect(() =>
      validateLedgerTimeline([
        {
          id: "opening-cash",
          occurredAt: "2026-01-01",
          accountId: "anonymous",
          type: "CNY_DEPOSIT",
          amountCny: 100,
        },
        {
          id: "over-withdrawal",
          occurredAt: "2026-01-02",
          accountId: "anonymous",
          type: "CNY_WITHDRAWAL",
          amountCny: 150,
        },
        {
          id: "later-deposit",
          occurredAt: "2026-01-03",
          accountId: "anonymous",
          type: "CNY_DEPOSIT",
          amountCny: 100,
        },
      ]),
    ).toThrow(
      "Insufficient cash in CNY after CNY_WITHDRAWAL on 2026-01-02.",
    );
  });

  it("rejects an intermediate USD shortfall hidden by a later conversion", () => {
    expect(() =>
      validateLedgerTimeline([
        {
          id: "deposit",
          occurredAt: "2026-01-01",
          accountId: "anonymous",
          type: "CNY_DEPOSIT",
          amountCny: 1_400,
        },
        {
          id: "first-fx",
          occurredAt: "2026-01-02",
          accountId: "anonymous",
          type: "FX_TO_USD",
          amountCny: 700,
          amountUsd: 100,
        },
        {
          id: "unfunded-buy",
          occurredAt: "2026-01-03",
          accountId: "anonymous",
          type: "BUY",
          symbol: "TEST",
          quantity: 1,
          priceUsd: 150,
          feeUsd: 0,
        },
        {
          id: "later-fx",
          occurredAt: "2026-01-04",
          accountId: "anonymous",
          type: "FX_TO_USD",
          amountCny: 700,
          amountUsd: 100,
        },
      ]),
    ).toThrow("Insufficient cash in USD after BUY on 2026-01-03.");
  });

  it("uses source order for same-day dependencies", () => {
    const deposit = validChronology[0];
    const sameDayFx = { ...validChronology[1], occurredAt: "2026-01-02" };
    const sameDayBuy = { ...validChronology[2], occurredAt: "2026-01-02" };

    expect(() =>
      validateLedgerTimeline([deposit, sameDayBuy, sameDayFx]),
    ).toThrow("Insufficient cash in USD after BUY on 2026-01-02.");
    expect(
      validateLedgerTimeline([deposit, sameDayFx, sameDayBuy]).map(
        (event) => event.id,
      ),
    ).toEqual(["deposit", "fx", "buy"]);
  });
});
