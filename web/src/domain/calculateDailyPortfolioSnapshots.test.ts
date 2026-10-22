import { describe, expect, it } from "vitest";
import {
  calculateDailyPortfolioSnapshots,
  classifyExternalFlow,
  type DailyPortfolioValuationInput,
} from "./calculateDailyPortfolioSnapshots";
import type { PositionSecurityMapping } from "./calculateHoldingsValuation";
import type { LedgerEvent } from "./ledger";
import type { FxRate, SecurityQuote } from "./marketData";

const security = {
  symbol: "TEST",
  exchange: "ANON",
  currency: "USD" as const,
  assetType: "ETF" as const,
};

const mappings: PositionSecurityMapping[] = [
  { positionSymbol: "TEST", security },
];

function fxRate(
  baseCurrency: "HKD" | "USD",
  date: string,
  rate: number,
): FxRate {
  return {
    kind: "FX_RATE",
    pair: { baseCurrency, quoteCurrency: "CNY" },
    rate,
    marketTimestamp: `${date}T16:00:00Z`,
    fetchedAt: `${date}T18:00:00Z`,
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous reference source",
    isDelayed: true,
  };
}

function quote(date: string, price: number): SecurityQuote {
  return {
    kind: "SECURITY_QUOTE",
    security,
    price,
    marketTimestamp: `${date}T16:00:00Z`,
    fetchedAt: `${date}T18:00:00Z`,
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous exchange",
    isDelayed: true,
  };
}

const events: LedgerEvent[] = [
  {
    id: "deposit",
    occurredAt: "2026-01-01",
    accountId: "anonymous",
    type: "CNY_DEPOSIT",
    amountCny: 8_000,
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
    occurredAt: "2026-01-02",
    accountId: "anonymous",
    type: "BUY",
    symbol: "TEST",
    quantity: 4,
    priceUsd: 100,
    feeUsd: 4,
  },
  {
    id: "cashback-shares",
    occurredAt: "2026-01-03",
    accountId: "anonymous",
    type: "IN_KIND_CONTRIBUTION",
    source: "CASHBACK_REWARD",
    symbol: "TEST",
    quantity: 0.5,
    priceUsd: 120,
    currency: "USD",
  },
  {
    id: "withdrawal",
    occurredAt: "2026-01-04",
    accountId: "anonymous",
    type: "CNY_WITHDRAWAL",
    amountCny: 300,
  },
  {
    id: "hkd-interest",
    occurredAt: "2026-01-04",
    accountId: "anonymous",
    type: "INTEREST",
    currency: "HKD",
    amount: 20,
  },
];

describe("external flow classification", () => {
  it("classifies contributions and withdrawals without treating internal activity as external", () => {
    expect(events.map(classifyExternalFlow)).toEqual([
      {
        eventId: "deposit",
        occurredAt: "2026-01-01",
        category: "CASH_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "CNY",
        nativeAmount: 8_000,
      },
      undefined,
      undefined,
      {
        eventId: "cashback-shares",
        occurredAt: "2026-01-03",
        category: "IN_KIND_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "USD",
        nativeAmount: 60,
      },
      {
        eventId: "withdrawal",
        occurredAt: "2026-01-04",
        category: "CASH_WITHDRAWAL",
        direction: "WITHDRAWAL",
        nativeCurrency: "CNY",
        nativeAmount: 300,
      },
      undefined,
    ]);
  });

  it("keeps every internal ledger event outside the external-flow boundary", () => {
    const internalEvents: LedgerEvent[] = [
      events[1],
      {
        id: "fx-to-cny",
        occurredAt: "2026-01-05",
        accountId: "anonymous",
        type: "FX_TO_CNY",
        amountUsd: 10,
        amountCny: 72,
      },
      events[2],
      {
        id: "sell",
        occurredAt: "2026-01-05",
        accountId: "anonymous",
        type: "SELL",
        symbol: "TEST",
        quantity: 1,
        priceUsd: 125,
        feeUsd: 1,
      },
      {
        id: "dividend",
        occurredAt: "2026-01-05",
        accountId: "anonymous",
        type: "DIVIDEND",
        symbol: "TEST",
        grossAmountUsd: 10,
        withholdingTaxUsd: 1,
      },
      events[5],
      {
        id: "fee",
        occurredAt: "2026-01-05",
        accountId: "anonymous",
        type: "FEE",
        amountUsd: 2,
        category: "OTHER",
      },
    ];

    expect(internalEvents.map(classifyExternalFlow)).toEqual(
      internalEvents.map(() => undefined),
    );
  });
});

describe("daily portfolio snapshots", () => {
  it("replays the ledger through each close and values that day's external flows", () => {
    const valuationInputs: DailyPortfolioValuationInput[] = [
      {
        date: "2026-01-04",
        securityMappings: mappings,
        securityQuotes: [quote("2026-01-04", 100)],
        usdCnyRate: fxRate("USD", "2026-01-04", 7.2),
        hkdCnyRate: fxRate("HKD", "2026-01-04", 0.92),
      },
      {
        date: "2026-01-01",
        securityMappings: [],
        securityQuotes: [],
      },
      {
        date: "2026-01-03",
        securityMappings: mappings,
        securityQuotes: [quote("2026-01-03", 120)],
        usdCnyRate: fxRate("USD", "2026-01-03", 7),
      },
      {
        date: "2026-01-02",
        securityMappings: mappings,
        securityQuotes: [quote("2026-01-02", 110)],
        usdCnyRate: fxRate("USD", "2026-01-02", 7),
      },
    ];
    const eventsBefore = structuredClone(events);
    const inputsBefore = structuredClone(valuationInputs);

    const snapshots = calculateDailyPortfolioSnapshots(
      events,
      valuationInputs,
    );

    expect(snapshots.map((snapshot) => snapshot.date)).toEqual([
      "2026-01-01",
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
    expect(snapshots[0]).toMatchObject({
      calculationVersion: 1,
      cashValueCny: 8_000,
      securitiesMarketValueUsd: 0,
      securitiesMarketValueCny: 0,
      navCny: 8_000,
      externalCashContributionsCny: 8_000,
      externalWithdrawalsCny: 0,
      externalInKindContributionsCny: 0,
      netExternalFlowCny: 8_000,
    });
    expect(snapshots[1]).toMatchObject({
      cashValueCny: 5_172,
      securitiesMarketValueUsd: 440,
      securitiesMarketValueCny: 3_080,
      navCny: 8_252,
      netExternalFlowCny: 0,
    });
    expect(snapshots[2]).toMatchObject({
      cashValueCny: 5_172,
      securitiesMarketValueUsd: 540,
      securitiesMarketValueCny: 3_780,
      navCny: 8_952,
      externalInKindContributionsCny: 420,
      netExternalFlowCny: 420,
    });
    expect(snapshots[2].externalFlows).toEqual([
      expect.objectContaining({
        eventId: "cashback-shares",
        nativeAmount: 60,
        valueCny: 420,
      }),
    ]);
    expect(snapshots[3]).toMatchObject({
      securitiesMarketValueUsd: 450,
      securitiesMarketValueCny: 3_240,
      externalWithdrawalsCny: 300,
      netExternalFlowCny: -300,
    });
    expect(snapshots[3].cashValueCny).toBeCloseTo(5_009.6);
    expect(snapshots[3].navCny).toBeCloseTo(8_249.6);
    expect(snapshots[3].balances.positions).toEqual([
      { symbol: "TEST", quantity: 4.5, costUsd: 464 },
    ]);
    expect(events).toEqual(eventsBefore);
    expect(valuationInputs).toEqual(inputsBefore);
  });

  it("rejects a snapshot when an open position lacks a closing quote", () => {
    expect(() =>
      calculateDailyPortfolioSnapshots(events, [
        {
          date: "2026-01-02",
          securityMappings: mappings,
          securityQuotes: [],
          usdCnyRate: fxRate("USD", "2026-01-02", 7),
        },
      ]),
    ).toThrow(/SECURITY_COVERAGE_INCOMPLETE/);
  });

  it("rejects duplicate dates and missing in-kind contribution FX inputs", () => {
    expect(() =>
      calculateDailyPortfolioSnapshots([], [
        { date: "2026-01-01", securityMappings: [], securityQuotes: [] },
        { date: "2026-01-01", securityMappings: [], securityQuotes: [] },
      ]),
    ).toThrow(/appears more than once/);

    const settledInKindContribution: LedgerEvent[] = [
      {
        ...events[3],
        occurredAt: "2026-01-01",
      },
      {
        id: "sell-contributed-shares",
        occurredAt: "2026-01-01",
        accountId: "anonymous",
        type: "SELL",
        symbol: "TEST",
        quantity: 0.5,
        priceUsd: 120,
        feeUsd: 0,
      },
      {
        id: "convert-proceeds",
        occurredAt: "2026-01-01",
        accountId: "anonymous",
        type: "FX_TO_CNY",
        amountUsd: 60,
        amountCny: 420,
      },
    ];

    expect(() =>
      calculateDailyPortfolioSnapshots(settledInKindContribution, [
        {
          date: "2026-01-01",
          securityMappings: [],
          securityQuotes: [],
        },
      ]),
    ).toThrow(/requires a USD\/CNY rate to value an in-kind contribution/);
  });
});
