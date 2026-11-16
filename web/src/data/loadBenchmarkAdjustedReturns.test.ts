import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { SecurityIdentifier } from "../domain/marketData";
import { IndexedDbImportedMarketPriceStore } from "./importedMarketPriceStore";
import { loadBenchmarkAdjustedReturns } from "./loadBenchmarkAdjustedReturns";

const ivv: SecurityIdentifier = {
  symbol: "IVV", exchange: "NYSE ARCA", currency: "USD", assetType: "ETF",
};
const qqq: SecurityIdentifier = {
  symbol: "QQQ", exchange: "NASDAQ", currency: "USD", assetType: "ETF",
};

function testStore(): IndexedDbImportedMarketPriceStore {
  return new IndexedDbImportedMarketPriceStore(`atlas-anonymous-benchmark-${crypto.randomUUID()}`);
}

describe("loadBenchmarkAdjustedReturns", () => {
  it("uses adjusted closes, not raw prices, over the same requested portfolio period", async () => {
    const store = testStore();
    await store.putAll([
      { date: "2026-01-06", security: ivv, closeUsd: 100, adjustedCloseUsd: 99 },
      { date: "2026-01-02", security: ivv, closeUsd: 100, adjustedCloseUsd: 90 },
      { date: "2026-01-06", security: qqq, closeUsd: 200, adjustedCloseUsd: 171 },
      { date: "2026-01-02", security: qqq, closeUsd: 200, adjustedCloseUsd: 180 },
    ]);

    const results = await loadBenchmarkAdjustedReturns("2026-01-02", "2026-01-07", store);
    expect(results).toMatchObject([
      { status: "READY", symbol: "IVV", startCloseDate: "2026-01-02", endCloseDate: "2026-01-06" },
      { status: "READY", symbol: "QQQ", startCloseDate: "2026-01-02", endCloseDate: "2026-01-06" },
    ]);
    if (results[0].status !== "READY" || results[1].status !== "READY") {
      throw new Error("Both adjusted benchmarks should be available.");
    }
    expect(results[0].adjustedReturn).toBeCloseTo(0.1);
    expect(results[1].adjustedReturn).toBeCloseTo(-0.05);
    await store.close();
  });

  it("leaves only the benchmark without adjusted prices unavailable", async () => {
    const store = testStore();
    await store.putAll([
      { date: "2026-01-02", security: ivv, closeUsd: 100, adjustedCloseUsd: 90 },
      { date: "2026-01-06", security: ivv, closeUsd: 105 },
      { date: "2026-01-02", security: qqq, closeUsd: 200, adjustedCloseUsd: 180 },
      { date: "2026-01-06", security: qqq, closeUsd: 210, adjustedCloseUsd: 189 },
    ]);

    const results = await loadBenchmarkAdjustedReturns("2026-01-02", "2026-01-07", store);
    expect(results[0]).toMatchObject({ status: "UNAVAILABLE", symbol: "IVV", reason: expect.stringMatching(/adjusted/) });
    expect(results[1]).toMatchObject({ status: "READY", symbol: "QQQ" });
    if (results[1].status !== "READY") throw new Error("QQQ should be available.");
    expect(results[1].adjustedReturn).toBeCloseTo(0.05);
    await store.close();
  });

  it("rejects a future or repeated close instead of showing a false return", async () => {
    const results = await loadBenchmarkAdjustedReturns("2026-01-02", "2026-01-07", {
      async getLatestOnOrBefore(security, date) {
        if (security.symbol === "IVV") {
          return { date: "2026-01-08", security, closeUsd: 100, adjustedCloseUsd: 90 };
        }
        return { date: "2026-01-02", security, closeUsd: 200, adjustedCloseUsd: date === "2026-01-02" ? 180 : 190 };
      },
    });
    expect(results[0]).toMatchObject({ status: "UNAVAILABLE", symbol: "IVV" });
    expect(results[1]).toMatchObject({ status: "UNAVAILABLE", symbol: "QQQ", reason: expect.stringMatching(/distinct/) });
  });

  it("requires ordered calendar dates", async () => {
    const source = { async getLatestOnOrBefore() { throw new Error("Unexpected lookup."); } };
    await expect(loadBenchmarkAdjustedReturns("2026-02-30", "2026-03-01", source)).rejects.toThrow(/ordered calendar dates/);
    await expect(loadBenchmarkAdjustedReturns("2026-03-01", "2026-03-01", source)).rejects.toThrow(/ordered calendar dates/);
  });
});
