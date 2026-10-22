import { calculateBalances } from "./calculateBalances";
import type { LedgerEvent } from "./ledger";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";

export function validateLedgerTimeline(
  events: readonly LedgerEvent[],
): LedgerEvent[] {
  const orderedEvents = sortLedgerEventsChronologically(events);

  calculateBalances(orderedEvents, { validateTimeline: true });
  return orderedEvents;
}
