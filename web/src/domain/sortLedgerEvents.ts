import type { LedgerEvent } from "./ledger";

export function sortLedgerEventsChronologically(
  events: readonly LedgerEvent[],
): LedgerEvent[] {
  return events
    .map((event, originalIndex) => ({ event, originalIndex }))
    .sort(
      (a, b) =>
        a.event.occurredAt.localeCompare(b.event.occurredAt) ||
        a.originalIndex - b.originalIndex,
    )
    .map(({ event }) => event);
}
