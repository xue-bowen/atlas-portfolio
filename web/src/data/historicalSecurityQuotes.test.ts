import { describe, expect, it, vi } from "vitest";
import { CachedSecurityQuoteService } from "./cachedSecurityQuoteService";
import {
  createSecurityQuoteCacheKey,
  type MarketDataCacheHit,
  type MarketDataCacheRecord,
} from "./marketDataCache";
import { EastmoneyUsEodProvider } from "./providers/eastmoneyUsEodProvider";
import type {
  SecurityIdentifier,
  SecurityQuote,
  SecurityQuoteProvider,
} from "../domain/marketData";

const security: SecurityIdentifier = {
  symbol: "IVV",
  exchange: "NYSE ARCA",
  currency: "USD",
  assetType: "ETF",
};

function quote(date: string, price: number): SecurityQuote {
  return {
    kind: "SECURITY_QUOTE",
    security,
    price,
    marketTimestamp: `${date}T00:00:00.000Z`,
    fetchedAt: "2026-01-12T00:00:00.000Z",
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous exchange",
    isDelayed: true,
  };
}

class MemoryCache {
  readonly records = new Map<string, MarketDataCacheRecord>();

  async get(key: string, now: Date = new Date()): Promise<MarketDataCacheHit | undefined> {
    const record = this.records.get(key);
    return record
      ? {
          ...record,
          freshness: now.getTime() < Date.parse(record.expiresAt) ? "FRESH" : "STALE",
        }
      : undefined;
  }

  async put(record: MarketDataCacheRecord): Promise<void> {
    this.records.set(record.key, record);
  }
}

describe("dated security closing prices", () => {
  it("keeps latest cache keys stable and separates dated closes", () => {
    expect(createSecurityQuoteCacheKey(security)).toBe(
      "SECURITY_QUOTE:ETF:USD:NYSE%20ARCA:IVV",
    );
    expect(createSecurityQuoteCacheKey(security, "2026-01-11")).toBe(
      "SECURITY_QUOTE:ETF:USD:NYSE%20ARCA:IVV:2026-01-11",
    );
    expect(createSecurityQuoteCacheKey(security, "2026-01-10")).not.toBe(
      createSecurityQuoteCacheKey(security, "2026-01-11"),
    );
    expect(() => createSecurityQuoteCacheKey(security, "20260111")).toThrow(/YYYY-MM-DD/);
    expect(() => createSecurityQuoteCacheKey(security, "2026-02-30")).toThrow(/YYYY-MM-DD/);
  });

  it("requests the latest close on or before a historical date", async () => {
    const requestUrls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      requestUrls.push(String(input));
      return new Response(
        JSON.stringify({
          rc: 0,
          data: {
            code: "IVV",
            market: 107,
            name: "Anonymous ETF",
            klines: ["2026-01-09,100,101,102,99"],
          },
        }),
      );
    });
    const provider = new EastmoneyUsEodProvider(fetcher, () => new Date("2026-01-12T00:00:00Z"));

    const result = await provider.getSecurityQuote({ security, date: "2026-01-11" });

    const requestUrl = new URL(requestUrls[0]);
    expect(requestUrl.searchParams.get("secid")).toBe("107.IVV");
    expect(requestUrl.searchParams.get("end")).toBe("20260111");
    expect(requestUrl.searchParams.get("lmt")).toBe("1");
    expect(result.price).toBe(101);
    expect(result.marketTimestamp).toBe("2026-01-09T00:00:00.000Z");
    expect(result.isDelayed).toBe(true);
  });

  it("rejects an invalid historical date or a future-dated provider bar", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          rc: 0,
          data: {
            code: "IVV",
            market: 107,
            name: "Anonymous ETF",
            klines: ["2026-01-12,100,101,102,99"],
          },
        }),
      ),
    );
    const provider = new EastmoneyUsEodProvider(fetcher);

    await expect(provider.getSecurityQuote({ security, date: "2026/01/11" })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    await expect(provider.getSecurityQuote({ security, date: "2026-02-30" })).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(provider.getSecurityQuote({ security, date: "2026-01-11" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("caches historical dates permanently without changing latest quote lookup", async () => {
    const cache = new MemoryCache();
    const requests: Array<string | undefined> = [];
    const provider: SecurityQuoteProvider = {
      id: "ANONYMOUS_TEST",
      async getSecurityQuote(request) {
        requests.push(request.date);
        return quote(request.date === "2026-01-11" ? "2026-01-09" : "2026-01-12", 101);
      },
    };
    const service = new CachedSecurityQuoteService(cache, provider, {
      now: () => new Date("2026-01-12T00:00:00Z"),
    });

    const first = await service.getSecurityQuote({ security, date: "2026-01-11" });
    const second = await service.getSecurityQuote({ security, date: "2026-01-11" });
    const latest = await service.getSecurityQuote({ security });

    expect(first.status).toBe("PROVIDER_FRESH");
    expect(first.expiresAt).toBe("9999-12-31T23:59:59.999Z");
    expect(second.status).toBe("CACHE_FRESH");
    expect(second.quote.marketTimestamp).toBe("2026-01-09T00:00:00.000Z");
    expect(latest.status).toBe("PROVIDER_FRESH");
    expect(requests).toEqual(["2026-01-11", undefined]);
    expect(cache.records.size).toBe(2);
  });

  it("does not cache a mismatched or future-dated provider result", async () => {
    const cache = new MemoryCache();
    const provider: SecurityQuoteProvider = {
      id: "ANONYMOUS_TEST",
      async getSecurityQuote() {
        return quote("2026-01-12", 101);
      },
    };
    const service = new CachedSecurityQuoteService(cache, provider, {
      now: () => new Date("2026-01-12T00:00:00Z"),
    });

    await expect(service.getSecurityQuote({ security, date: "2026-01-11" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(cache.records.size).toBe(0);
  });

  it("keeps an explicit stale fallback when a refresh returns a future bar", async () => {
    const cache = new MemoryCache();
    await cache.put({
      key: createSecurityQuoteCacheKey(security, "2026-01-11"),
      value: quote("2026-01-09", 100),
      expiresAt: "2026-01-11T00:00:00Z",
    });
    const provider: SecurityQuoteProvider = {
      id: "ANONYMOUS_TEST",
      async getSecurityQuote() {
        return quote("2026-01-12", 101);
      },
    };
    const service = new CachedSecurityQuoteService(cache, provider, {
      now: () => new Date("2026-01-12T00:00:00Z"),
    });

    const result = await service.getSecurityQuote({ security, date: "2026-01-11" });

    expect(result.status).toBe("CACHE_STALE");
    expect(result.quote.price).toBe(100);
    expect(result.refreshError?.code).toBe("INVALID_RESPONSE");
  });
});
