import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { calculateBalances } from "./calculateBalances";
import { validateLedgerTimeline } from "./validateLedgerTimeline";
import { addStockSplitEvent } from "./addStockSplitEvent";
import { removeLedgerEvent } from "./removeLedgerEvent";
import { buildLedgerEdit, ledgerEditValues, replaceLedgerEvent } from "./editLedgerEvent";
import { calculateUsdCashHistory } from "./calculateUsdCashHistory";
import { calculateDailyPortfolioSnapshots, classifyExternalFlow } from "./calculateDailyPortfolioSnapshots";
import { calculateUsdTwrSeries } from "./calculateUsdTwrSeries";
import { calculateCnyPerformanceSeries } from "./calculateCnyPerformanceSeries";
import { parsePortfolioBackup, serializePortfolioBackup } from "../data/ledgerStorage";
import { parseLedgerCsv } from "../data/parseLedgerCsv";
import { IndexedDbLedgerStore } from "../data/indexedDbLedgerStore";
import { loadHistoricalValuationInputs } from "../data/loadHistoricalValuationInputs";
import type { LedgerEvent, StockSplit } from "./ledger";
import type { FxRate, SecurityIdentifier, SecurityQuote } from "./marketData";

const base = { accountId: "anonymous", occurredAt: "2026-01-02" };
const funded: LedgerEvent[] = [
  { ...base, id: "deposit", type: "CNY_DEPOSIT", amountCny: 7000 },
  { ...base, id: "fx", type: "FX_TO_USD", amountCny: 7000, amountUsd: 1000 },
  { ...base, id: "buy", type: "BUY", symbol: "ANON", quantity: 4, priceUsd: 100, feeUsd: 4 },
];
const split: StockSplit = { ...base, occurredAt: "2026-01-05", id: "split", type: "STOCK_SPLIT", symbol: "ANON", newShares: 4, oldShares: 1 };
const sale: LedgerEvent = { ...base, occurredAt: "2026-01-06", id: "sale", type: "SELL", symbol: "ANON", quantity: 5, priceUsd: 30, feeUsd: 1 };
const security: SecurityIdentifier = { symbol: "ANON", exchange: "ANONYMOUS", currency: "USD", assetType: "STOCK" };
const profiles = [{ positionSymbol: "ANON", security }];

describe("share splits in the complete ledger", () => {
  it("preserves cost, cash and income at a split, then allocates the correct cost to later sales", () => {
    const original = structuredClone(funded);
    const before = calculateBalances(funded);
    const after = calculateBalances([...funded, split]);
    expect(after).toEqual({ ...before, positions: [{ symbol: "ANON", quantity: 16, costUsd: 404 }] });
    expect(calculateUsdCashHistory([...funded, split])).toEqual(calculateUsdCashHistory(funded));
    expect(classifyExternalFlow(split)).toBeUndefined();
    const sold = calculateBalances(validateLedgerTimeline([...funded, split, sale]));
    expect(sold.positions[0]).toEqual({ symbol: "ANON", quantity: 11, costUsd: 277.75 });
    expect(sold.usdCash).toBe(745);
    expect(sold.realizedPnlUsd).toBe(22.75);
    expect(sold.totalFeesUsd).toBe(5);
    expect(funded).toEqual(original);
  });

  it("retains fractional shares in a reverse split and permits full liquidation", () => {
    const reverse: StockSplit = { ...split, newShares: 1, oldShares: 10 };
    const after = calculateBalances([...funded, reverse]);
    expect(after.positions[0]).toEqual({ symbol: "ANON", quantity: 0.4, costUsd: 404 });
    const closed = calculateBalances([...funded, reverse, { ...sale, quantity: 0.4, priceUsd: 1100 }]);
    expect(closed.positions).toEqual([]);
    expect(closed.realizedPnlUsd).toBe(35);
    expect(closed.usdCash).toBe(1035);
  });

  it("inserts retroactive splits before same-day trades without reordering existing records", () => {
    const sameDaySale = { ...sale, occurredAt: split.occurredAt, quantity: 1 };
    const events = [...funded, sameDaySale];
    const result = addStockSplitEvent(events, split);
    expect(result.map((event) => event.id)).toEqual(["deposit", "fx", "buy", "split", "sale"]);
    expect(calculateBalances(result).positions[0].quantity).toBe(15);
    expect(events.map((event) => event.id)).toEqual(["deposit", "fx", "buy", "sale"]);
    expect(() => validateLedgerTimeline([...events, split])).toThrow(/precede trades/);
  });

  it.each([[0, 1], [1, 0], [-1, 1], [1.5, 1], [1, 1], [Infinity, 1], [Number.MAX_SAFE_INTEGER + 1, 1]])(
    "rejects invalid ratio %s for %s", (newShares, oldShares) => {
      expect(() => calculateBalances([...funded, { ...split, newShares, oldShares }])).toThrow(/ratio/);
      expect(() => parsePortfolioBackup(JSON.stringify([{ ...split, newShares, oldShares }]))).toThrow();
    },
  );

  it("rejects absent holdings, invalid dates, and duplicate effective-date splits", () => {
    expect(() => calculateBalances([split])).toThrow(/no position/);
    expect(() => calculateBalances([...funded, { ...split, occurredAt: "2026-02-30" }])).toThrow(/date/);
    expect(() => calculateBalances([...funded, split, { ...split, id: "duplicate" }])).toThrow(/one split/);
    expect(() => addStockSplitEvent(funded, { ...split, occurredAt: "2026-01-02" })).toThrow(/no position/);
  });

  it("recalculates after editing and refuses edits or deletions that invalidate later sales", () => {
    const ledger = [...funded, split, sale];
    const edit = buildLedgerEdit(split, { ...ledgerEditValues(split), newShares: "2" });
    const changed = replaceLedgerEvent(ledger, edit);
    expect(calculateBalances(changed).positions[0]).toEqual({ symbol: "ANON", quantity: 3, costUsd: 151.5 });
    expect(calculateBalances(changed).realizedPnlUsd).toBe(-103.5);
    expect(() => removeLedgerEvent(ledger, "split")).toThrow(/insufficient position/);
    expect(() => replaceLedgerEvent(ledger, { ...split, occurredAt: "2026-01-07" })).toThrow(/insufficient position/);
    expect(() => buildLedgerEdit(split, { ...ledgerEditValues(split), newShares: "1.5" })).toThrow(/ratio/);
    expect(calculateBalances(removeLedgerEvent([...funded, split], "split"))).toEqual(calculateBalances(funded));
  });

  it("round-trips schema v3, accepts legacy backups and CSV split ratios, and persists without resetting IndexedDB", async () => {
    const ledger = [...funded, split, sale];
    const text = serializePortfolioBackup(ledger, profiles);
    expect(JSON.parse(text).schemaVersion).toBe(3);
    expect(parsePortfolioBackup(text)).toEqual({ ledger, securityProfiles: profiles });
    for (const schemaVersion of [1, 2]) {
      expect(parsePortfolioBackup(JSON.stringify({ app: "atlas-portfolio", schemaVersion, ledger: funded, securityProfiles: profiles })).ledger).toEqual(funded);
    }
    expect(parseLedgerCsv("id,occurredAt,accountId,type,symbol,newShares,oldShares\nsplit,2026-01-05,anonymous,STOCK_SPLIT,ANON,4,1")).toEqual([split]);
    const name = `atlas-split-test-${crypto.randomUUID()}`;
    const store = new IndexedDbLedgerStore(name);
    await store.write(funded);
    await store.write(ledger);
    await store.close();
    const reopened = new IndexedDbLedgerStore(name);
    expect(await reopened.read()).toEqual(ledger);
    await reopened.close();
  });

  it("keeps NAV and TWR continuous across a pure split using dated ordinary closes", async () => {
    const ledger = [...funded.map((event) => event.type === "BUY" ? { ...event, feeUsd: 0 } : event), split];
    const dates = ["2026-01-02", "2026-01-05"];
    const loaded = await loadHistoricalValuationInputs(ledger, dates, profiles, {
      async getFxRate(request) {
        const rate: FxRate = { kind: "FX_RATE", pair: request.pair, rate: 7, marketTimestamp: `${request.date}T00:00:00Z`, fetchedAt: "2026-01-07T00:00:00Z", provider: "ANONYMOUS_TEST", sourceInstitution: "Anonymous FX", isDelayed: true };
        return { rate };
      },
    }, {
      async getSecurityQuote(request) {
        const quote: SecurityQuote = { kind: "SECURITY_QUOTE", security: request.security, price: request.date === dates[0] ? 100 : 25, marketTimestamp: `${request.date}T00:00:00Z`, fetchedAt: "2026-01-07T00:00:00Z", provider: "ANONYMOUS_TEST", sourceInstitution: "Anonymous ordinary closes", isDelayed: true };
        return { quote };
      },
    });
    if (loaded.status !== "READY") throw new Error("Expected complete split history.");
    const snapshots = calculateDailyPortfolioSnapshots(ledger, loaded.inputs);
    expect(snapshots.map((snapshot) => snapshot.navCny)).toEqual([7000, 7000]);
    expect(snapshots[1].externalFlows).toEqual([]);
    expect(calculateUsdTwrSeries(snapshots).at(-1)!.cumulativeReturn).toBe(0);
    expect(calculateCnyPerformanceSeries(snapshots).at(-1)!.totalPnlCny).toBe(0);
  });
});
