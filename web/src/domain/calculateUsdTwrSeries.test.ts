import { describe, expect, it } from "vitest";
import { calculateDailyPortfolioSnapshots } from "./calculateDailyPortfolioSnapshots";
import {
  calculateUsdTwrSeries,
  type UsdTwrSnapshotInput,
} from "./calculateUsdTwrSeries";
import type { LedgerEvent } from "./ledger";
import type { FxRate } from "./marketData";

function usdCnyRate(date: string, rate: number): FxRate {
  return {
    kind: "FX_RATE",
    pair: { baseCurrency: "USD", quoteCurrency: "CNY" },
    rate,
    marketTimestamp: `${date}T16:00:00Z`,
    fetchedAt: `${date}T18:00:00Z`,
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous reference source",
    isDelayed: true,
  };
}

function snapshot(
  date: string,
  navUsd: number,
  rate: number,
  flows: UsdTwrSnapshotInput["externalFlows"] = [],
): UsdTwrSnapshotInput {
  return {
    date,
    calculationVersion: 1,
    navCny: navUsd * rate,
    externalFlows: flows,
    netExternalFlowCny: flows.reduce(
      (sum, flow) =>
        sum + (flow.direction === "WITHDRAWAL" ? -flow.valueCny : flow.valueCny),
      0,
    ),
    valuationInputs: { usdCnyRate: usdCnyRate(date, rate) },
  };
}

describe("calculateUsdTwrSeries", () => {
  it("chain-links USD returns while removing same-day cash and in-kind flows", () => {
    const first = snapshot("2026-01-01", 100, 7, [
      {
        eventId: "initial-deposit",
        occurredAt: "2026-01-01",
        category: "CASH_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "CNY",
        nativeAmount: 700,
        valueCny: 700,
      },
    ]);
    const second = snapshot("2026-01-02", 110, 7);
    const third = snapshot("2026-01-03", 181, 7, [
      {
        eventId: "cash-deposit",
        occurredAt: "2026-01-03",
        category: "CASH_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "CNY",
        nativeAmount: 350,
        valueCny: 350,
      },
      {
        eventId: "share-reward",
        occurredAt: "2026-01-03",
        category: "IN_KIND_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "USD",
        nativeAmount: 20,
        valueCny: 140,
      },
      {
        eventId: "cash-withdrawal",
        occurredAt: "2026-01-03",
        category: "CASH_WITHDRAWAL",
        direction: "WITHDRAWAL",
        nativeCurrency: "CNY",
        nativeAmount: 70,
        valueCny: 70,
      },
    ]);
    const fourth = snapshot("2026-01-04", 199.1, 7);
    const input = [fourth, second, first, third];
    const before = structuredClone(input);

    const result = calculateUsdTwrSeries(input);

    expect(result.map((point) => point.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(result[0]).toMatchObject({ periodReturn: null, growthIndex: 100 });
    expect(result[1].netExternalFlowUsd).toBe(0);
    expect(result[1].growthIndex).toBeCloseTo(110);
    expect(result[2].netExternalFlowUsd).toBeCloseTo(60);
    expect(result[2].periodReturn).toBeCloseTo(0.1);
    expect(result[2].growthIndex).toBeCloseTo(121);
    expect(result[3].periodReturn).toBeCloseTo(0.1);
    expect(result[3].cumulativeReturn).toBeCloseTo(0.331);
    expect(input).toEqual(before);
  });

  it("removes an added deposit without changing the day's return", () => {
    const first = snapshot("2026-02-01", 100, 7);
    const withoutDeposit = snapshot("2026-02-02", 110, 7);
    const withDeposit = snapshot("2026-02-02", 210, 7, [
      {
        eventId: "extra-deposit",
        occurredAt: "2026-02-02",
        category: "CASH_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "CNY",
        nativeAmount: 700,
        valueCny: 700,
      },
    ]);

    expect(calculateUsdTwrSeries([first, withoutDeposit])[1].periodReturn).toBeCloseTo(0.1);
    expect(calculateUsdTwrSeries([first, withDeposit])[1].periodReturn).toBeCloseTo(0.1);
  });

  it("uses each close's FX rate and accepts complete ledger-derived snapshots", () => {
    const events: LedgerEvent[] = [
      {
        id: "first-deposit",
        occurredAt: "2026-03-01",
        accountId: "anonymous",
        type: "CNY_DEPOSIT",
        amountCny: 700,
      },
      {
        id: "later-deposit",
        occurredAt: "2026-03-03",
        accountId: "anonymous",
        type: "CNY_DEPOSIT",
        amountCny: 375,
      },
    ];
    const eventsBefore = structuredClone(events);
    const snapshots = calculateDailyPortfolioSnapshots(events, [
      { date: "2026-03-01", securityMappings: [], securityQuotes: [], usdCnyRate: usdCnyRate("2026-03-01", 7) },
      { date: "2026-03-02", securityMappings: [], securityQuotes: [], usdCnyRate: usdCnyRate("2026-03-02", 7) },
      { date: "2026-03-03", securityMappings: [], securityQuotes: [], usdCnyRate: usdCnyRate("2026-03-03", 7.5) },
    ]);

    const result = calculateUsdTwrSeries(snapshots);

    expect(result[1].periodReturn).toBe(0);
    expect(result[2].navUsd).toBeCloseTo(143.3333333333);
    expect(result[2].netExternalFlowUsd).toBe(50);
    expect(result[2].cumulativeReturn).toBeCloseTo(-1 / 15);
    expect(events).toEqual(eventsBefore);
  });

  it("rejects incomplete, duplicated, and impossible series", () => {
    const first = snapshot("2026-04-01", 100, 7);
    const second = snapshot("2026-04-02", 110, 7);

    expect(calculateUsdTwrSeries([])).toEqual([]);
    expect(() => calculateUsdTwrSeries([first, first])).toThrow(/appears more than once/);
    expect(() => calculateUsdTwrSeries([snapshot("2026-02-30", 100, 7)])).toThrow(/date .* invalid/);
    expect(() => calculateUsdTwrSeries([{ ...first, calculationVersion: 2 } as unknown as UsdTwrSnapshotInput])).toThrow(/unsupported calculation version/);
    expect(() => calculateUsdTwrSeries([{ ...first, valuationInputs: {} }])).toThrow(/USD\/CNY valuation rate/);
    expect(() => calculateUsdTwrSeries([{
      ...first,
      valuationInputs: {
        usdCnyRate: {
          ...usdCnyRate("2026-04-01", 7),
          pair: { baseCurrency: "CNY", quoteCurrency: "USD" },
        },
      },
    }])).toThrow(/USD\/CNY valuation rate/);
    expect(() => calculateUsdTwrSeries([{ ...first, valuationInputs: { usdCnyRate: usdCnyRate("2026-04-01", 0) } }])).toThrow(/USD\/CNY valuation rate/);
    expect(() => calculateUsdTwrSeries([{ ...first, navCny: -1 }])).toThrow(/non-negative CNY NAV/);
    expect(() => calculateUsdTwrSeries([snapshot("2026-04-01", 0, 7)])).toThrow(/positive NAV/);
    expect(() => calculateUsdTwrSeries([first, snapshot("2026-04-02", 0, 7), snapshot("2026-04-03", 110, 7)])).toThrow(/after zero NAV/);
    expect(() => calculateUsdTwrSeries([first, {
      ...second,
      externalFlows: [{
        eventId: "oversized-deposit",
        occurredAt: "2026-04-02",
        category: "CASH_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "CNY",
        nativeAmount: 1_400,
        valueCny: 1_400,
      }],
      netExternalFlowCny: 1_400,
    }])).toThrow(/pre-flow NAV is invalid/);
  });

  it("rejects flows with wrong dates, classification, values, or totals", () => {
    const flow: UsdTwrSnapshotInput["externalFlows"][number] = {
      eventId: "flow",
      occurredAt: "2026-05-01",
      category: "IN_KIND_CONTRIBUTION",
      direction: "CONTRIBUTION",
      nativeCurrency: "USD",
      nativeAmount: 10,
      valueCny: 70,
    };
    const base = snapshot("2026-05-01", 110, 7, [flow]);

    expect(() => calculateUsdTwrSeries([{ ...base, externalFlows: [{ ...flow, occurredAt: "2026-05-02" }] }])).toThrow(/does not belong/);
    expect(() => calculateUsdTwrSeries([{ ...base, externalFlows: [{ ...flow, direction: "WITHDRAWAL" }] }])).toThrow(/invalid values or classification/);
    expect(() => calculateUsdTwrSeries([{ ...base, externalFlows: [{ ...flow, valueCny: 71 }] }])).toThrow(/inconsistent CNY value/);
    expect(() => calculateUsdTwrSeries([{ ...base, netExternalFlowCny: 0 }])).toThrow(/do not reconcile/);
  });
});
