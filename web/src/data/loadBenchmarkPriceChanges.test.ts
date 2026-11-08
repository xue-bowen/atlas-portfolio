import { describe, expect, it } from "vitest";
import type { SecurityQuote, SecurityQuoteRequest } from "../domain/marketData";
import { loadBenchmarkPriceChanges } from "./loadBenchmarkPriceChanges";

function quote(request: SecurityQuoteRequest, price: number, closeDate: string): SecurityQuote {
  return {
    kind: "SECURITY_QUOTE",
    security: request.security,
    price,
    marketTimestamp: `${closeDate}T00:00:00.000Z`,
    fetchedAt: "2026-01-08T00:00:00.000Z",
    provider: "ANONYMOUS_TEST",
    sourceInstitution: "Anonymous reference source",
    isDelayed: true,
  };
}

describe("loadBenchmarkPriceChanges", () => {
  it("compares IVV and QQQ closes on the same requested portfolio dates", async () => {
    const requests: SecurityQuoteRequest[] = [];
    const results = await loadBenchmarkPriceChanges("2026-01-02", "2026-01-07", {
      async getSecurityQuote(request) {
        requests.push(request);
        const first = request.date === "2026-01-02";
        const ivv = request.security.symbol === "IVV";
        return {
          quote: quote(request, ivv ? (first ? 100 : 110) : first ? 200 : 190,
            first ? "2026-01-02" : "2026-01-06"),
        };
      },
    });

    expect(requests.map(({ security, date }) => [security.symbol, security.exchange, date]))
      .toEqual([
        ["IVV", "NYSE ARCA", "2026-01-02"],
        ["IVV", "NYSE ARCA", "2026-01-07"],
        ["QQQ", "NASDAQ", "2026-01-02"],
        ["QQQ", "NASDAQ", "2026-01-07"],
      ]);
    expect(results[0]).toMatchObject({
      status: "READY", symbol: "IVV", startCloseDate: "2026-01-02", endCloseDate: "2026-01-06",
    });
    expect(results[1]).toMatchObject({
      status: "READY", symbol: "QQQ", startCloseDate: "2026-01-02", endCloseDate: "2026-01-06",
    });
    if (results[0].status !== "READY" || results[1].status !== "READY") {
      throw new Error("Both anonymous benchmarks should be available.");
    }
    expect(results[0].priceChange).toBeCloseTo(0.1);
    expect(results[1].priceChange).toBeCloseTo(-0.05);
  });

  it("keeps the other benchmark available when one quote fails", async () => {
    const results = await loadBenchmarkPriceChanges("2026-01-02", "2026-01-07", {
      async getSecurityQuote(request) {
        if (request.security.symbol === "QQQ") throw new Error("Quote missing.");
        return { quote: quote(request, request.date === "2026-01-02" ? 100 : 105,
          request.date!) };
      },
    });

    expect(results[0]).toMatchObject({ status: "READY", symbol: "IVV" });
    expect(results[1]).toEqual({ status: "UNAVAILABLE", symbol: "QQQ", reason: "Quote missing." });
  });

  it("rejects a future or mismatched close without hiding the other benchmark", async () => {
    const results = await loadBenchmarkPriceChanges("2026-01-02", "2026-01-07", {
      async getSecurityQuote(request) {
        if (request.security.symbol === "IVV" && request.date === "2026-01-02") {
          return { quote: quote(request, 100, "2026-01-08") };
        }
        return { quote: quote(request, 100, request.date!) };
      },
    });

    expect(results[0]).toMatchObject({ status: "UNAVAILABLE", symbol: "IVV" });
    expect(results[1]).toMatchObject({ status: "READY", symbol: "QQQ", priceChange: 0 });
  });

  it("requires a valid, increasing comparison period", async () => {
    await expect(loadBenchmarkPriceChanges("2026-02-30", "2026-03-01", {
      getSecurityQuote: async () => { throw new Error("Unexpected quote request."); },
    })).rejects.toThrow(/ordered calendar dates/);
    await expect(loadBenchmarkPriceChanges("2026-03-01", "2026-03-01", {
      getSecurityQuote: async () => { throw new Error("Unexpected quote request."); },
    })).rejects.toThrow(/ordered calendar dates/);
  });
});
