import type { LedgerEvent, StockSplit } from "./ledger";
import { validateLedgerTimeline } from "./validateLedgerTimeline";

/** An effective-date split precedes that day's trades; existing order survives. */
export function addStockSplitEvent(events: readonly LedgerEvent[], split: StockSplit): LedgerEvent[] {
  const index = events.findIndex((event) => event.occurredAt === split.occurredAt);
  return validateLedgerTimeline(index < 0 ? [...events, split]
    : [...events.slice(0, index), split, ...events.slice(index)]);
}
