import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { SecurityIdentifier } from "../domain/marketData";
import { IndexedDbImportedMarketPriceStore } from "./importedMarketPriceStore";
import type { ImportedMarketPrice } from "./parseMarketPriceCsv";

const ivv: SecurityIdentifier = {
  symbol: "IVV", exchange: "NYSE ARCA", currency: "USD", assetType: "ETF",
};
const qqq: SecurityIdentifier = {
  symbol: "QQQ", exchange: "NASDAQ", currency: "USD", assetType: "ETF",
};

function testStore(): { name: string; store: IndexedDbImportedMarketPriceStore } {
  const name = `atlas-anonymous-prices-test-${crypto.randomUUID()}`;
  return { name, store: new IndexedDbImportedMarketPriceStore(name) };
}

describe("IndexedDbImportedMarketPriceStore", () => {
  it("persists out-of-order prices and finds the latest close before a non-trading day", async () => {
    const { name, store } = testStore();
    const prices: ImportedMarketPrice[] = [
      { date: "2026-01-06", security: ivv, closeUsd: 603, adjustedCloseUsd: 602 },
      { date: "2026-01-02", security: ivv, closeUsd: 600, adjustedCloseUsd: 599 },
      { date: "2026-01-02", security: qqq, closeUsd: 520 },
    ];
    expect(await store.putAll(prices)).toBe(3);
    await store.close();

    const reopened = new IndexedDbImportedMarketPriceStore(name);
    expect(await reopened.getLatestOnOrBefore(ivv, "2026-01-05")).toEqual(prices[1]);
    expect(await reopened.getLatestOnOrBefore(ivv, "2026-01-06")).toEqual(prices[0]);
    expect(await reopened.getLatestOnOrBefore(ivv, "2026-01-01")).toBeUndefined();
    expect(await reopened.getLatestOnOrBefore(qqq, "2026-01-06")).toEqual(prices[2]);
    await reopened.close();
  });

  it("rejects an invalid batch before changing previously imported prices", async () => {
    const { store } = testStore();
    const original: ImportedMarketPrice = { date: "2026-01-02", security: ivv, closeUsd: 600 };
    await store.putAll([original]);

    await expect(store.putAll([
      { ...original, closeUsd: 601 },
      { date: "2026-01-06", security: ivv, closeUsd: 0 },
    ])).rejects.toThrow(/invalid/);
    expect(await store.getLatestOnOrBefore(ivv, "2026-01-06")).toEqual(original);

    await expect(store.putAll([original, original])).rejects.toThrow(/duplicate/);
    expect(await store.getLatestOnOrBefore(ivv, "2026-01-06")).toEqual(original);
    await store.close();
  });

  it("updates an existing date while preserving other securities", async () => {
    const { store } = testStore();
    await store.putAll([
      { date: "2026-01-02", security: ivv, closeUsd: 600 },
      { date: "2026-01-02", security: qqq, closeUsd: 520 },
    ]);
    const corrected: ImportedMarketPrice = {
      date: "2026-01-02", security: ivv, closeUsd: 601, adjustedCloseUsd: 600,
    };
    await store.putAll([corrected]);
    expect(await store.getLatestOnOrBefore(ivv, "2026-01-02")).toEqual(corrected);
    expect((await store.getLatestOnOrBefore(qqq, "2026-01-02"))?.closeUsd).toBe(520);
    await store.close();
  });
});
