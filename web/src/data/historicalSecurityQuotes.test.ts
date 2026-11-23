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

  it.each([
    ["2026-01-06T21:14:59Z", "20260105", "2026-01-05"],
    ["2026-01-06T21:15:00Z", "20260106", "2026-01-06"],
  ])("caps latest ordinary closes at the completed session at %s", async (clock, end, date) => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      expect(url.searchParams.get("end")).toBe(end);
      expect(url.searchParams.get("fqt")).toBe("0");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ rc: 0, data: {
        code: "IVV", market: 107, name: "Anonymous ETF", klines: [`${date},100,101`],
      } }));
    });
    const provider = new EastmoneyUsEodProvider(fetcher, () => new Date(clock));
    expect((await provider.getSecurityQuote({ security })).marketTimestamp).toBe(`${date}T00:00:00.000Z`);
  });

  it("rejects an unfinished requested date before it can become a permanent historical cache entry", async () => {
    const fetcher = vi.fn();
    const provider = new EastmoneyUsEodProvider(fetcher, () => new Date("2026-01-06T21:10:00Z"));
    await expect(provider.getSecurityQuote({ security, date: "2026-01-06" }))
      .rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects an unfinished daily bar even if the source ignores the ending date", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ rc: 0, data: {
      code: "IVV", market: 107, name: "Anonymous ETF", klines: ["2026-01-06,100,101"],
    } })));
    const provider = new EastmoneyUsEodProvider(fetcher, () => new Date("2026-01-06T20:00:00Z"));
    await expect(provider.getSecurityQuote({ security })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
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

  it.each(["2026-01-05", "2026-01-06"])("re-fetches old unfinished-date cache entries containing a %s bar", async (barDate) => {
    const cache = new MemoryCache();
    const key = createSecurityQuoteCacheKey(security, "2026-01-06");
    await cache.put({ key, expiresAt: "9999-12-31T23:59:59.999Z", value: {
      ...quote(barDate, 100), provider: "eastmoney-us-eod", fetchedAt: "2026-01-06T21:10:00Z",
    } });
    const provider: SecurityQuoteProvider = {
      id: "eastmoney-us-eod",
      getSecurityQuote: vi.fn(async () => ({
        ...quote("2026-01-06", 101), provider: "eastmoney-us-eod", fetchedAt: "2026-01-07T00:00:00Z",
      })),
    };
    const service = new CachedSecurityQuoteService(cache, provider, { now: () => new Date("2026-01-07T00:00:00Z") });
    const result = await service.getSecurityQuote({ security, date: "2026-01-06" });
    expect(result.status).toBe("PROVIDER_FRESH");
    expect(result.quote.price).toBe(101);
    expect(provider.getSecurityQuote).toHaveBeenCalledTimes(1);
  });

  it("never returns an old intraday bar as stale fallback when the source fails", async () => {
    const cache = new MemoryCache();
    await cache.put({ key: createSecurityQuoteCacheKey(security), expiresAt: "9999-12-31T23:59:59.999Z", value: {
      ...quote("2026-01-06", 100), provider: "eastmoney-us-eod", fetchedAt: "2026-01-06T20:00:00Z",
    } });
    const provider: SecurityQuoteProvider = {
      id: "eastmoney-us-eod", async getSecurityQuote() { throw new Error("Anonymous outage"); },
    };
    const service = new CachedSecurityQuoteService(cache, provider);
    await expect(service.getSecurityQuote({ security })).rejects.toThrow("Anonymous outage");
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
