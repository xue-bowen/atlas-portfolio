import { describe, expect, it } from "vitest";
import type { CnyPerformanceSnapshotInput } from "./calculateCnyPerformanceSeries";
import {
  buildCnyXirrCashFlows,
  calculateCnyXirr,
} from "./calculateCnyXirr";

function snapshot(
  date: string,
  navCny: number,
  cashContributionCny = 0,
  withdrawalCny = 0,
  inKindContributionCny = 0,
): CnyPerformanceSnapshotInput {
  return {
    date,
    calculationVersion: 1,
    navCny,
    externalCashContributionsCny: cashContributionCny,
    externalWithdrawalsCny: withdrawalCny,
    externalInKindContributionsCny: inKindContributionCny,
    netExternalFlowCny:
      cashContributionCny + inKindContributionCny - withdrawalCny,
  };
}

describe("calculateCnyXirr", () => {
  it("calculates a one-year money-weighted return", () => {
    const result = calculateCnyXirr([
      snapshot("2025-01-01", 1_000, 1_000),
      snapshot("2026-01-01", 1_100),
    ]);

    expect(result.annualRate).toBeCloseTo(0.1, 9);
    expect(result.asOfDate).toBe("2026-01-01");
    expect(result.dayCountConvention).toBe("ACTUAL_365");
  });

  it("uses actual dates and investor-perspective signs for irregular flows", () => {
    const expectedRate = 0.2;
    const secondContributionGrowthDays = 184;
    const endingNav =
      1_000 * (1 + expectedRate) +
      500 * Math.pow(1 + expectedRate, secondContributionGrowthDays / 365);
    const snapshots = [
      snapshot("2025-01-01", 1_000, 1_000),
      snapshot("2025-07-01", 1_500, 500),
      snapshot("2026-01-01", endingNav),
    ];

    expect(buildCnyXirrCashFlows(snapshots)).toEqual([
      {
        date: "2025-01-01",
        amountCny: -1_000,
        source: "EXTERNAL_FLOW",
      },
      {
        date: "2025-07-01",
        amountCny: -500,
        source: "EXTERNAL_FLOW",
      },
      {
        date: "2026-01-01",
        amountCny: endingNav,
        source: "ENDING_NAV",
      },
    ]);
    expect(calculateCnyXirr(snapshots).annualRate).toBeCloseTo(
      expectedRate,
      9,
    );
  });

  it("records withdrawals as positive investor cash flows", () => {
    const cashFlows = buildCnyXirrCashFlows([
      snapshot("2025-01-01", 1_000, 1_000),
      snapshot("2025-07-01", 900, 0, 200),
      snapshot("2026-01-01", 900),
    ]);

    expect(cashFlows).toEqual([
      {
        date: "2025-01-01",
        amountCny: -1_000,
        source: "EXTERNAL_FLOW",
      },
      {
        date: "2025-07-01",
        amountCny: 200,
        source: "EXTERNAL_FLOW",
      },
      {
        date: "2026-01-01",
        amountCny: 900,
        source: "ENDING_NAV",
      },
    ]);
  });

  it("keeps a zero ending NAV so the result retains its as-of date", () => {
    const cashFlows = buildCnyXirrCashFlows([
      snapshot("2025-01-01", 100, 100),
      snapshot("2025-07-01", 0, 0, 110),
      snapshot("2026-01-01", 0),
    ]);

    expect(cashFlows.at(-1)).toEqual({
      date: "2026-01-01",
      amountCny: 0,
      source: "ENDING_NAV",
    });
    expect(calculateCnyXirr([
      snapshot("2025-01-01", 100, 100),
      snapshot("2025-07-01", 0, 0, 110),
      snapshot("2026-01-01", 0),
    ]).asOfDate).toBe("2026-01-01");
  });

  it("rejects empty, one-date, and one-sign cash-flow series", () => {
    expect(() => calculateCnyXirr([])).toThrow(/at least one .*snapshot/);
    expect(() =>
      calculateCnyXirr([snapshot("2026-01-01", 1_000, 1_000)]),
    ).toThrow(/at least two dates/);
    expect(() =>
      calculateCnyXirr([
        snapshot("2025-01-01", 0, 0, 100),
        snapshot("2026-01-01", 100, 0, 100),
      ]),
    ).toThrow(/positive and one negative/);
  });

  it("rejects a series without a root in the supported range", () => {
    expect(() =>
      calculateCnyXirr([
        snapshot("2025-01-01", 100, 100),
        snapshot("2026-01-01", 0, 0, 10),
        snapshot("2027-01-01", 0, 100),
      ]),
    ).toThrow(/no solution/);
  });

  it("rejects ambiguous cash flows with multiple roots", () => {
    expect(() =>
      calculateCnyXirr([
        snapshot("2025-01-01", 100, 100),
        snapshot("2026-01-01", 0, 0, 230),
        snapshot("2027-01-01", 100, 232),
      ]),
    ).toThrow(/multiple possible solutions/);
  });
});
