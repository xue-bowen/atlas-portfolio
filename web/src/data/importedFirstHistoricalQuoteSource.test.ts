import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type {
  SecurityIdentifier,
  SecurityQuote,
  SecurityQuoteRequest,
} from "../domain/marketData";
import { ImportedFirstHistoricalQuoteSource } from "./importedFirstHistoricalQuoteSource";
import { IndexedDbImportedMarketPriceStore } from "./importedMarketPriceStore";
import { loadBenchmarkPriceChanges } from "./loadBenchmarkPriceChanges";

const ivv: SecurityIdentifier = {
  symbol: "IVV", exchange: "NYSE ARCA", assetType: "ETF", currency: "USD",
};
const qqq: SecurityIdentifier = {
  symbol: "QQQ", exchange: "NASDAQ", assetType: "ETF", currency: "USD",
};

function fallbackQuote(request: SecurityQuoteRequest): SecurityQuote {
  return {
    kind: "SECURITY_QUOTE", security: request.security, price: 999,
    marketTimestamp: `${request.date ?? "2026-01-08"}T00:00:00.000Z`,
    fetchedAt: "2026-01-08T12:00:00.000Z", provider: "anonymous-fallback",
    sourceInstitution: "Anonymous source", isDelayed: true,
  };
}

describe("ImportedFirstHistoricalQuoteSource", () => {
  it("uses an imported close before the requested date ahead of the online fallback", async () => {
    const store = new IndexedDbImportedMarketPriceStore(`atlas-anonymous-source-${crypto.randomUUID()}`);
    await store.putAll([
      { date: "2026-01-02", security: ivv, closeUsd: 100, adjustedCloseUsd: 99 },
      { date: "2026-01-06", security: ivv, closeUsd: 105 },
    ]);
    const requests: SecurityQuoteRequest[] = [];
    const source = new ImportedFirstHistoricalQuoteSource(store, {
      async getSecurityQuote(request) {
        requests.push(request);
        return { quote: fallbackQuote(request) };
      },
    }, () => new Date("2026-01-08T12:00:00.000Z"));

    expect(await source.getSecurityQuote({ security: ivv, date: "2026-01-05" }))
      .toMatchObject({ quote: {
        price: 100,
        marketTimestamp: "2026-01-02T00:00:00.000Z",
        fetchedAt: "2026-01-08T12:00:00.000Z",
        provider: "imported-market-price-csv",
      } });
    expect(requests).toEqual([]);
    await store.close();
  });

  it("keeps the existing source for uncovered dates and undated current quotes", async () => {
    const store = new IndexedDbImportedMarketPriceStore(`atlas-anonymous-source-${crypto.randomUUID()}`);
    await store.putAll([{ date: "2026-01-02", security: ivv, closeUsd: 100 }]);
    const requests: SecurityQuoteRequest[] = [];
    const source = new ImportedFirstHistoricalQuoteSource(store, {
      async getSecurityQuote(request) {
        requests.push(request);
        return { quote: fallbackQuote(request) };
      },
    });

    expect((await source.getSecurityQuote({ security: qqq, date: "2026-01-05" })).quote.price).toBe(999);
    expect((await source.getSecurityQuote({ security: ivv })).quote.price).toBe(999);
    expect(requests).toEqual([
      { security: qqq, date: "2026-01-05" },
      { security: ivv },
    ]);
    await store.close();
  });

  it("feeds locally stored IVV and QQQ closes into the existing benchmark calculation", async () => {
    const store = new IndexedDbImportedMarketPriceStore(`atlas-anonymous-source-${crypto.randomUUID()}`);
    await store.putAll([
      { date: "2026-01-02", security: ivv, closeUsd: 100 },
      { date: "2026-01-06", security: ivv, closeUsd: 110 },
      { date: "2026-01-02", security: qqq, closeUsd: 200 },
      { date: "2026-01-06", security: qqq, closeUsd: 190 },
    ]);
    const source = new ImportedFirstHistoricalQuoteSource(store, {
      async getSecurityQuote() { throw new Error("Online fallback should not be used."); },
    });

    const result = await loadBenchmarkPriceChanges("2026-01-02", "2026-01-07", source);
    expect(result).toMatchObject([
      { status: "READY", symbol: "IVV", startCloseDate: "2026-01-02", endCloseDate: "2026-01-06" },
      { status: "READY", symbol: "QQQ", startCloseDate: "2026-01-02", endCloseDate: "2026-01-06" },
    ]);
    if (result[0].status !== "READY" || result[1].status !== "READY") {
      throw new Error("Both imported benchmarks should be available.");
    }
    expect(result[0].priceChange).toBeCloseTo(0.1);
    expect(result[1].priceChange).toBeCloseTo(-0.05);
    await store.close();
  });
});
