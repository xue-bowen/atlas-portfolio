import type { LedgerEvent } from "./ledger";
import { validateLedgerTimeline } from "./validateLedgerTimeline";

export function removeLedgerEvent(
  events: readonly LedgerEvent[],
  eventId: string,
): LedgerEvent[] {
  const eventIndex = events.findIndex((event) => event.id === eventId);

  if (eventIndex === -1) {
    throw new Error("Transaction not found.");
  }

  const remainingEvents = events.filter((_, index) => index !== eventIndex);
  return validateLedgerTimeline(remainingEvents);
}
