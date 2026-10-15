import { calculateBalances } from "./calculateBalances";
import type { LedgerEvent } from "./ledger";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";

export function removeLedgerEvent(
  events: readonly LedgerEvent[],
  eventId: string,
): LedgerEvent[] {
  const eventIndex = events.findIndex((event) => event.id === eventId);

  if (eventIndex === -1) {
    throw new Error("Transaction not found.");
  }

  const remainingEvents = events.filter((_, index) => index !== eventIndex);
  const orderedEvents = sortLedgerEventsChronologically(remainingEvents);

  calculateBalances(orderedEvents);
  return orderedEvents;
}
