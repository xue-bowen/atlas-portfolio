import { describe, expect, it } from "vitest";
import { calculateCurrentCnyPerformance } from "./calculateCurrentCnyPerformance";
import type { LedgerEvent } from "./ledger";

const events: LedgerEvent[] = [
  {
    id: "deposit",
    type: "CNY_DEPOSIT",
    occurredAt: "2025-01-01",
    accountId: "test",
    amountCny: 1_000,
  },
  {
    id: "internal-fx",
    type: "FX_TO_USD",
    occurredAt: "2025-01-02",
    accountId: "test",
    amountCny: 700,
    amountUsd: 100,
  },
  {
    id: "cashback",
    type: "IN_KIND_CONTRIBUTION",
    occurredAt: "2025-07-01",
    accountId: "test",
    source: "CASHBACK_REWARD",
    symbol: "TEST",
    quantity: 1,
    priceUsd: 10,
    currency: "USD",
  },
  {
    id: "withdrawal",
    type: "CNY_WITHDRAWAL",
    occurredAt: "2025-10-01",
    accountId: "test",
    amountCny: 100,
  },
];

describe("calculateCurrentCnyPerformance", () => {
  it("summarizes current CNY performance and ignores internal activity", () => {
    const result = calculateCurrentCnyPerformance({
      events,
      asOfDate: "2026-01-01",
      navCny: 1_210,
      inKindContributionValuesCny: [
        { eventId: "cashback", valueCny: 110 },
      ],
    });

    expect(result).toMatchObject({
      navCny: 1_210,
      cumulativeExternalCashContributionsCny: 1_000,
      cumulativeExternalWithdrawalsCny: 100,
      cumulativeExternalInKindContributionsCny: 110,
      cumulativeNetContributionsCny: 1_010,
      totalPnlCny: 200,
      unavailableReasons: [],
    });
    expect(result.xirrAnnualRate).toBeTypeOf("number");
  });

  it("reports only dependent values unavailable when NAV is incomplete", () => {
    const result = calculateCurrentCnyPerformance({
      events: [events[0]],
      asOfDate: "2026-01-01",
    });

    expect(result).toMatchObject({
      navCny: undefined,
      cumulativeExternalCashContributionsCny: 1_000,
      cumulativeExternalWithdrawalsCny: 0,
      cumulativeExternalInKindContributionsCny: 0,
      cumulativeNetContributionsCny: 1_000,
      totalPnlCny: undefined,
      xirrAnnualRate: undefined,
      unavailableReasons: ["NAV_UNAVAILABLE", "XIRR_UNAVAILABLE"],
    });
  });

  it("keeps cash totals visible while an in-kind value is missing", () => {
    const result = calculateCurrentCnyPerformance({
      events,
      asOfDate: "2026-01-01",
      navCny: 1_210,
    });

    expect(result).toMatchObject({
      navCny: 1_210,
      cumulativeExternalCashContributionsCny: 1_000,
      cumulativeExternalWithdrawalsCny: 100,
      unavailableReasons: [
        "IN_KIND_CONTRIBUTION_VALUE_UNAVAILABLE",
        "XIRR_UNAVAILABLE",
      ],
    });
    expect(result.cumulativeExternalInKindContributionsCny).toBeUndefined();
    expect(result.cumulativeNetContributionsCny).toBeUndefined();
    expect(result.totalPnlCny).toBeUndefined();
    expect(result.xirrAnnualRate).toBeUndefined();
  });

  it("rejects stale or invalid contribution valuations and early as-of dates", () => {
    expect(() =>
      calculateCurrentCnyPerformance({
        events,
        asOfDate: "2026-01-01",
        navCny: 1_210,
        inKindContributionValuesCny: [
          { eventId: "unknown", valueCny: 100 },
        ],
      }),
    ).toThrow(/unknown event/);

    expect(() =>
      calculateCurrentCnyPerformance({
        events,
        asOfDate: "2026-01-01",
        navCny: 1_210,
        inKindContributionValuesCny: [
          { eventId: "cashback", valueCny: Number.NaN },
        ],
      }),
    ).toThrow(/must be positive/);

    expect(() =>
      calculateCurrentCnyPerformance({
        events,
        asOfDate: "2025-06-01",
        navCny: 1_210,
      }),
    ).toThrow(/earlier than external flow/);
  });
});
