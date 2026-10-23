import { describe, expect, it } from "vitest";
import {
  calculateCnyPerformanceSeries,
  type CnyPerformanceSnapshotInput,
} from "./calculateCnyPerformanceSeries";

const snapshots: CnyPerformanceSnapshotInput[] = [
  {
    date: "2026-01-01",
    calculationVersion: 1,
    navCny: 8_000,
    externalCashContributionsCny: 8_000,
    externalWithdrawalsCny: 0,
    externalInKindContributionsCny: 0,
    netExternalFlowCny: 8_000,
  },
  {
    date: "2026-01-02",
    calculationVersion: 1,
    navCny: 8_252,
    externalCashContributionsCny: 0,
    externalWithdrawalsCny: 0,
    externalInKindContributionsCny: 0,
    netExternalFlowCny: 0,
  },
  {
    date: "2026-01-03",
    calculationVersion: 1,
    navCny: 8_952,
    externalCashContributionsCny: 0,
    externalWithdrawalsCny: 0,
    externalInKindContributionsCny: 420,
    netExternalFlowCny: 420,
  },
  {
    date: "2026-01-04",
    calculationVersion: 1,
    navCny: 8_249.6,
    externalCashContributionsCny: 0,
    externalWithdrawalsCny: 300,
    externalInKindContributionsCny: 0,
    netExternalFlowCny: -300,
  },
];

describe("calculateCnyPerformanceSeries", () => {
  it("calculates cumulative contributions, withdrawals, and total CNY P&L", () => {
    const input = [snapshots[3], snapshots[1], snapshots[0], snapshots[2]];
    const before = structuredClone(input);

    const result = calculateCnyPerformanceSeries(input);

    expect(result.map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(result[0]).toMatchObject({
      cumulativeExternalCashContributionsCny: 8_000,
      cumulativeExternalWithdrawalsCny: 0,
      cumulativeExternalInKindContributionsCny: 0,
      cumulativeNetContributionsCny: 8_000,
      totalPnlCny: 0,
    });
    expect(result[1]).toMatchObject({
      cumulativeNetContributionsCny: 8_000,
      totalPnlCny: 252,
    });
    expect(result[2]).toMatchObject({
      cumulativeExternalCashContributionsCny: 8_000,
      cumulativeExternalInKindContributionsCny: 420,
      cumulativeNetContributionsCny: 8_420,
      totalPnlCny: 532,
    });
    expect(result[3]).toMatchObject({
      cumulativeExternalCashContributionsCny: 8_000,
      cumulativeExternalWithdrawalsCny: 300,
      cumulativeExternalInKindContributionsCny: 420,
      cumulativeNetContributionsCny: 8_120,
    });
    expect(result[3].totalPnlCny).toBeCloseTo(129.6);
    expect(input).toEqual(before);
  });

  it("handles cash, in-kind, and withdrawal flows on the same date", () => {
    const [result] = calculateCnyPerformanceSeries([
      {
        date: "2026-02-01",
        calculationVersion: 1,
        navCny: 950,
        externalCashContributionsCny: 1_000,
        externalWithdrawalsCny: 300,
        externalInKindContributionsCny: 200,
        netExternalFlowCny: 900,
      },
    ]);

    expect(result).toMatchObject({
      cumulativeExternalCashContributionsCny: 1_000,
      cumulativeExternalWithdrawalsCny: 300,
      cumulativeExternalInKindContributionsCny: 200,
      cumulativeNetContributionsCny: 900,
      totalPnlCny: 50,
    });
  });

  it("rejects duplicate dates and inconsistent daily flow totals", () => {
    expect(() =>
      calculateCnyPerformanceSeries([snapshots[0], snapshots[0]]),
    ).toThrow(/appears more than once/);

    expect(() =>
      calculateCnyPerformanceSeries([
        { ...snapshots[0], netExternalFlowCny: 7_999 },
      ]),
    ).toThrow(/does not match/);
  });

  it("rejects invalid values and unsupported snapshot versions", () => {
    expect(() =>
      calculateCnyPerformanceSeries([
        { ...snapshots[0], externalWithdrawalsCny: -1 },
      ]),
    ).toThrow(/non-negative/);

    expect(() =>
      calculateCnyPerformanceSeries([
        {
          ...snapshots[0],
          calculationVersion: 2,
        } as unknown as CnyPerformanceSnapshotInput,
      ]),
    ).toThrow(/unsupported calculation version/);

    const extreme = {
      ...snapshots[0],
      navCny: Number.MAX_VALUE,
      externalCashContributionsCny: Number.MAX_VALUE,
      netExternalFlowCny: Number.MAX_VALUE,
    };
    expect(() =>
      calculateCnyPerformanceSeries([
        extreme,
        { ...extreme, date: "2026-01-02" },
      ]),
    ).toThrow(/too large/);
  });
});
