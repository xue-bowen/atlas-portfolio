import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "./ledger";
import { selectUsdTwrSnapshotDates } from "./selectUsdTwrSnapshotDates";

describe("selectUsdTwrSnapshotDates", () => {
  it("includes every eligible transaction date and the last completed close", () => {
    const events: LedgerEvent[] = [
      { id: "future", occurredAt: "2026-01-06", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 1 },
      { id: "buy", occurredAt: "2026-01-03", accountId: "anonymous", type: "BUY", symbol: "TEST", quantity: 1, priceUsd: 1, feeUsd: 0 },
      { id: "deposit", occurredAt: "2026-01-01", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 100 },
      { id: "conversion", occurredAt: "2026-01-03", accountId: "anonymous", type: "FX_TO_USD", amountCny: 7, amountUsd: 1 },
    ];
    const before = structuredClone(events);

    expect(selectUsdTwrSnapshotDates(events, "2026-01-05")).toEqual([
      "2026-01-01", "2026-01-03", "2026-01-05",
    ]);
    expect(events).toEqual(before);
  });

  it("waits for a completed close before including a new ledger", () => {
    const events: LedgerEvent[] = [
      { id: "deposit", occurredAt: "2026-01-06", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 100 },
    ];

    expect(selectUsdTwrSnapshotDates(events, "2026-01-05")).toEqual([]);
    expect(selectUsdTwrSnapshotDates(events, "2026-01-06")).toEqual(["2026-01-06"]);
  });

  it("rejects invalid dates", () => {
    expect(() => selectUsdTwrSnapshotDates([], "2026-02-30")).toThrow(/invalid/);
    expect(() => selectUsdTwrSnapshotDates([
      { id: "bad", occurredAt: "2026-02-30", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 1 },
    ], "2026-03-01")).toThrow(/invalid/);
  });
});
