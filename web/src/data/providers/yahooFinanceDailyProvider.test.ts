import { describe, expect, it, vi } from "vitest";
import type { SecurityIdentifier } from "../../domain/marketData";
import { YahooFinanceDailyProvider } from "./yahooFinanceDailyProvider";
import { FallbackSecurityQuoteProvider } from "./fallbackSecurityQuoteProvider";
import { loadBenchmarkAdjustedReturns } from "../loadBenchmarkAdjustedReturns";

const ivv: SecurityIdentifier = { symbol: "IVV", exchange: "NYSE ARCA", currency: "USD", assetType: "ETF" };
const seconds = (value: string) => Date.parse(value) / 1000;
const now = () => new Date("2026-01-07T22:00:00Z");

function anonymousSeries(symbol = "IVV") {
  return {
    chart: {
      error: null,
      result: [{
        meta: {
          symbol, currency: "USD", exchangeName: symbol === "QQQ" ? "NGM" : "PCX",
          instrumentType: "ETF", exchangeTimezoneName: "America/New_York",
          currentTradingPeriod: { regular: { end: seconds("2026-01-06T21:00:00Z") } },
        },
        timestamp: [seconds("2026-01-02T14:30:00Z"), seconds("2026-01-06T14:30:00Z")],
        indicators: { quote: [{ close: [100, 100] }], adjclose: [{ adjclose: [90, 99] }] },
        events: { splits: {} as Record<string, unknown> },
      }],
    },
  };
}

describe("Yahoo Finance daily prices", () => {
  it("shares one request across historical dates, latest close, and adjusted lookup", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(anonymousSeries())));
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, now);
    const [first, latest, adjusted] = await Promise.all([
      provider.getSecurityQuote({ security: ivv, date: "2026-01-04" }),
      provider.getSecurityQuote({ security: ivv }),
      provider.getLatestOnOrBefore(ivv, "2026-01-07"),
    ]);
    expect(first).toMatchObject({ price: 100, marketTimestamp: "2026-01-02T00:00:00.000Z", provider: "yahoo-finance-daily" });
    expect(latest.marketTimestamp).toBe("2026-01-06T00:00:00.000Z");
    expect(adjusted?.adjustedCloseUsd).toBe(99);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/yahoo-chart?symbol=IVV", expect.any(Object));
    expect(await provider.getLatestOnOrBefore(ivv, "2026-01-01")).toBeUndefined();
  });

  it("uses adjusted returns including distributions even when close prices do not change", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const symbol = new URL(String(input), "http://localhost").searchParams.get("symbol")!;
      return new Response(JSON.stringify(anonymousSeries(symbol)));
    });
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, now);
    const results = await loadBenchmarkAdjustedReturns("2026-01-02", "2026-01-07", {
      async getLatestOnOrBefore() { return undefined; },
    }, provider);
    for (const result of results) {
      expect(result.status).toBe("READY");
      if (result.status === "READY") {
        expect(result.adjustedReturn).toBeCloseTo(0.1);
        expect(result.source).toMatch(/Yahoo/);
      }
    }
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reconstructs as-traded historical closes across a split while preserving adjusted prices", async () => {
    const body = anonymousSeries();
    const result = body.chart.result[0];
    result.indicators.quote[0].close = [50, 55];
    result.indicators.adjclose[0].adjclose = [45, 49.5];
    result.events.splits = { anonymous: { date: seconds("2026-01-06T14:30:00Z"), numerator: 2, denominator: 1 } };
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", async () => new Response(JSON.stringify(body)), now);
    expect((await provider.getSecurityQuote({ security: ivv, date: "2026-01-02" })).price).toBe(100);
    expect((await provider.getSecurityQuote({ security: ivv, date: "2026-01-06" })).price).toBe(55);
    expect((await provider.getLatestOnOrBefore(ivv, "2026-01-02"))?.adjustedCloseUsd).toBe(45);
  });

  it("excludes an in-progress session and accepts it only after the close plus delay", async () => {
    const body = anonymousSeries();
    const fetcher = async () => new Response(JSON.stringify(body));
    const during = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, () => new Date("2026-01-06T20:00:00Z"));
    expect((await during.getSecurityQuote({ security: ivv })).marketTimestamp).toContain("2026-01-02");
    const shortlyAfter = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, () => new Date("2026-01-06T21:10:00Z"));
    expect((await shortlyAfter.getSecurityQuote({ security: ivv })).marketTimestamp).toContain("2026-01-02");
    const completed = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, () => new Date("2026-01-06T21:16:00Z"));
    expect((await completed.getSecurityQuote({ security: ivv })).marketTimestamp).toContain("2026-01-06");
  });

  it.each(["symbol", "currency", "exchangeName", "instrumentType"])("rejects a mismatched %s", async (field) => {
    const body = anonymousSeries();
    Object.assign(body.chart.result[0].meta, { [field]: "INCORRECT" });
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", async () => new Response(JSON.stringify(body)), now);
    await expect(provider.getSecurityQuote({ security: ivv })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects duplicate dates and invalid prices rather than returning a partial valid series", async () => {
    const duplicate = anonymousSeries();
    duplicate.chart.result[0].timestamp[1] = duplicate.chart.result[0].timestamp[0];
    const invalid = anonymousSeries();
    invalid.chart.result[0].indicators.quote[0].close[0] = -1;
    for (const body of [duplicate, invalid]) {
      const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", async () => new Response(JSON.stringify(body)), now);
      await expect(provider.getSecurityQuote({ security: ivv })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("does not invent an adjusted price when the upstream supplies only ordinary closes", async () => {
    const body = anonymousSeries();
    Object.assign(body.chart.result[0].indicators, { adjclose: [] });
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", async () => new Response(JSON.stringify(body)), now);
    expect((await provider.getSecurityQuote({ security: ivv })).price).toBe(100);
    expect((await provider.getLatestOnOrBefore(ivv, "2026-01-07"))?.adjustedCloseUsd).toBeUndefined();
  });

  it("rejects non-daily data and malformed or duplicate split events", async () => {
    const weekly = anonymousSeries();
    Object.assign(weekly.chart.result[0].meta, { dataGranularity: "1wk" });
    const invalidSplit = anonymousSeries();
    invalidSplit.chart.result[0].events.splits = { invalid: { date: 1e20, numerator: 2, denominator: 1 } };
    const duplicateSplit = anonymousSeries();
    const split = { date: seconds("2026-01-06T14:30:00Z"), numerator: 2, denominator: 1 };
    duplicateSplit.chart.result[0].events.splits = { first: split, second: split };
    for (const body of [weekly, invalidSplit, duplicateSplit]) {
      const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", async () => new Response(JSON.stringify(body)), now);
      await expect(provider.getSecurityQuote({ security: ivv })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    }
  });

  it("retains one typed upstream failure per batch rather than retrying every history date", async () => {
    const fetcher = vi.fn(async () => new Response("blocked", { status: 403 }));
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, now);
    const results = await Promise.allSettled([
      provider.getSecurityQuote({ security: ivv, date: "2026-01-02" }),
      provider.getSecurityQuote({ security: ivv, date: "2026-01-06" }),
    ]);
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    await expect(provider.getSecurityQuote({ security: ivv })).rejects.toMatchObject({ code: "AUTHENTICATION_ERROR", message: expect.stringMatching(/403/) });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the actual fallback source and reports both failures if neither source works", async () => {
    const yahoo = new YahooFinanceDailyProvider("/api/yahoo-chart", async () => new Response("blocked", { status: 403 }), now);
    const quote = { kind: "SECURITY_QUOTE" as const, security: ivv, price: 101, marketTimestamp: "2026-01-06T00:00:00Z", fetchedAt: now().toISOString(), provider: "ANONYMOUS_FALLBACK", sourceInstitution: "Invented source", isDelayed: true };
    const fallback = { id: "anonymous", getSecurityQuote: vi.fn(async () => quote) };
    const provider = new FallbackSecurityQuoteProvider(yahoo, fallback);
    expect(await provider.getSecurityQuote({ security: ivv })).toEqual(quote);
    fallback.getSecurityQuote.mockRejectedValueOnce(new Error("offline"));
    await expect(provider.getSecurityQuote({ security: ivv })).rejects.toThrow(/403.*offline/);
  });

  it("rejects invalid dates and unsupported profiles without network requests", async () => {
    const fetcher = vi.fn();
    const provider = new YahooFinanceDailyProvider("/api/yahoo-chart", fetcher, now);
    await expect(provider.getSecurityQuote({ security: ivv, date: "2026-02-30" })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    await expect(provider.getSecurityQuote({ security: { ...ivv, currency: "HKD" } })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
