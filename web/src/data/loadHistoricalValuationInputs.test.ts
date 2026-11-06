import { describe, expect, it } from "vitest";
import { calculateDailyPortfolioSnapshots } from "../domain/calculateDailyPortfolioSnapshots";
import type { PositionSecurityMapping } from "../domain/calculateHoldingsValuation";
import type { LedgerEvent } from "../domain/ledger";
import type { FxRate, SecurityQuote } from "../domain/marketData";
import {
  loadHistoricalValuationInputs,
  type HistoricalFxSource,
  type HistoricalQuoteSource,
} from "./loadHistoricalValuationInputs";

const mapping: PositionSecurityMapping = {
  positionSymbol: "TEST",
  security: {
    symbol: "TEST",
    exchange: "ANON",
    currency: "USD",
    assetType: "ETF",
  },
};

const events: LedgerEvent[] = [
  { id: "deposit", occurredAt: "2026-01-01", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 1_000 },
  { id: "conversion", occurredAt: "2026-01-02", accountId: "anonymous", type: "FX_TO_USD", amountCny: 700, amountUsd: 100 },
  { id: "buy", occurredAt: "2026-01-03", accountId: "anonymous", type: "BUY", symbol: "TEST", quantity: 1, priceUsd: 50, feeUsd: 0 },
  { id: "sell", occurredAt: "2026-01-04", accountId: "anonymous", type: "SELL", symbol: "TEST", quantity: 1, priceUsd: 60, feeUsd: 0 },
];

function rate(baseCurrency: "USD" | "HKD", date: string): FxRate {
  return {
    kind: "FX_RATE",
    pair: { baseCurrency, quoteCurrency: "CNY" },
    rate: baseCurrency === "USD" ? 7 : 0.9,
    marketTimestamp: `${date}T00:00:00.000Z`,
    fetchedAt: "2026-01-05T00:00:00.000Z",
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous reference source",
    isDelayed: true,
  };
}

function quote(date: string): SecurityQuote {
  return {
    kind: "SECURITY_QUOTE",
    security: mapping.security,
    price: 60,
    marketTimestamp: `${date}T00:00:00.000Z`,
    fetchedAt: "2026-01-05T00:00:00.000Z",
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous exchange",
    isDelayed: true,
  };
}

describe("loadHistoricalValuationInputs", () => {
  it("loads only held securities and produces complete ledger-derived snapshots", async () => {
    const requestedRates: string[] = [];
    const requestedQuotes: string[] = [];
    const fxSource: HistoricalFxSource = {
      async getFxRate(request) {
        requestedRates.push(`${request.pair.baseCurrency}:${request.date}`);
        return { rate: rate(request.pair.baseCurrency as "USD" | "HKD", request.date!) };
      },
    };
    const quoteSource: HistoricalQuoteSource = {
      async getSecurityQuote(request) {
        requestedQuotes.push(`${request.security.symbol}:${request.date}`);
        return { quote: quote(request.date!) };
      },
    };
    const dates = ["2026-01-04", "2026-01-02", "2026-01-01", "2026-01-03"];
    const eventsBefore = structuredClone(events);
    const datesBefore = [...dates];

    const result = await loadHistoricalValuationInputs(
      events,
      dates,
      [mapping],
      fxSource,
      quoteSource,
    );

    expect(result.status).toBe("READY");
    if (result.status !== "READY") throw new Error("Expected complete inputs.");
    expect(result.inputs.map((input) => input.date)).toEqual([
      "2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04",
    ]);
    expect(requestedRates).toEqual([
      "USD:2026-01-01", "USD:2026-01-02", "USD:2026-01-03", "USD:2026-01-04",
    ]);
    expect(requestedQuotes).toEqual(["TEST:2026-01-03"]);
    expect(result.inputs[2].securityMappings).toEqual([mapping]);
    expect(result.inputs[3].securityQuotes).toEqual([]);
    expect(calculateDailyPortfolioSnapshots(events, result.inputs).map((snapshot) => snapshot.navCny)).toEqual([
      1_000, 1_000, 1_070, 1_070,
    ]);
    expect(events).toEqual(eventsBefore);
    expect(dates).toEqual(datesBefore);
  });

  it("reports missing closed-position profiles instead of returning partial inputs", async () => {
    let quoteRequests = 0;
    const result = await loadHistoricalValuationInputs(
      events,
      ["2026-01-03", "2026-01-04"],
      [],
      { async getFxRate(request) { return { rate: rate("USD", request.date!) }; } },
      { async getSecurityQuote() { quoteRequests += 1; return { quote: quote("2026-01-03") }; } },
    );

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      issues: [{ date: "2026-01-03", kind: "SECURITY_PROFILE", symbol: "TEST" }],
    });
    expect(quoteRequests).toBe(0);
  });

  it("requests HKD/CNY only after HKD cash exists", async () => {
    const requested: string[] = [];
    const withHkdInterest: LedgerEvent[] = [
      events[0],
      { id: "interest", occurredAt: "2026-01-02", accountId: "anonymous", type: "INTEREST", currency: "HKD", amount: 20 },
    ];

    const result = await loadHistoricalValuationInputs(
      withHkdInterest,
      ["2026-01-01", "2026-01-02"],
      [],
      {
        async getFxRate(request) {
          requested.push(`${request.pair.baseCurrency}:${request.date}`);
          return { rate: rate(request.pair.baseCurrency as "USD" | "HKD", request.date!) };
        },
      },
      { async getSecurityQuote() { throw new Error("No holdings expected."); } },
    );

    expect(result.status).toBe("READY");
    expect(requested).toEqual([
      "USD:2026-01-01", "USD:2026-01-02", "HKD:2026-01-02",
    ]);
  });

  it("reports missing and future-dated market data", async () => {
    const result = await loadHistoricalValuationInputs(
      events,
      ["2026-01-03"],
      [mapping],
      { async getFxRate() { throw new Error("FX unavailable"); } },
      { async getSecurityQuote() { return { quote: quote("2026-01-04") }; } },
    );

    expect(result).toMatchObject({
      status: "UNAVAILABLE",
      issues: [
        { date: "2026-01-03", kind: "USD_CNY", message: "FX unavailable" },
        { date: "2026-01-03", kind: "SECURITY_QUOTE", symbol: "TEST" },
      ],
    });
  });

  it("rejects duplicate or invalid requested dates", async () => {
    const fxSource: HistoricalFxSource = {
      async getFxRate(request) { return { rate: rate("USD", request.date!) }; },
    };
    const quoteSource: HistoricalQuoteSource = {
      async getSecurityQuote() { return { quote: quote("2026-01-03") }; },
    };

    await expect(loadHistoricalValuationInputs(events, ["2026-01-01", "2026-01-01"], [], fxSource, quoteSource)).rejects.toThrow(/more than once/);
    await expect(loadHistoricalValuationInputs(events, ["2026-02-30"], [], fxSource, quoteSource)).rejects.toThrow(/invalid/);
    await expect(loadHistoricalValuationInputs(events, [], [], fxSource, quoteSource)).resolves.toEqual({ status: "READY", inputs: [] });
  });
});
