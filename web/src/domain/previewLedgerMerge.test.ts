import { describe, expect, it } from "vitest";
import { previewLedgerMerge } from "./previewLedgerMerge";
import type { LedgerEvent } from "./ledger";

const deposit: LedgerEvent = {
  id: "deposit-1",
  occurredAt: "2026-01-02",
  accountId: "anonymous",
  type: "CNY_DEPOSIT",
  amountCny: 1000,
};

describe("previewLedgerMerge", () => {
  it("sorts backfilled events and skips exact repeated IDs", () => {
    const earlier: LedgerEvent = { ...deposit, id: "deposit-0", occurredAt: "2026-01-01", amountCny: 300 };
    const preview = previewLedgerMerge([deposit], [deposit, earlier, earlier]);

    expect(preview.added).toEqual([earlier]);
    expect(preview.skippedCount).toBe(2);
    expect(preview.ledger.map((event) => event.id)).toEqual(["deposit-0", "deposit-1"]);
  });

  it("rejects a repeated ID with different details", () => {
    expect(() => previewLedgerMerge([deposit], [{ ...deposit, amountCny: 500 }]))
      .toThrow(/deposit-1 has different details/);
  });

  it("rejects an invalid merged timeline before saving", () => {
    const withdrawal: LedgerEvent = {
      id: "withdrawal-1",
      occurredAt: "2026-01-01",
      accountId: "anonymous",
      type: "CNY_WITHDRAWAL",
      amountCny: 100,
    };
    expect(() => previewLedgerMerge([deposit], [withdrawal])).toThrow();
  });
});
