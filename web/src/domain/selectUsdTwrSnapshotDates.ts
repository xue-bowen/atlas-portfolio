import type { LedgerEvent } from "./ledger";
import { isCalendarDate } from "./marketData";

export function selectUsdTwrSnapshotDates(
  events: readonly LedgerEvent[],
  latestCompletedDate: string,
): string[] {
  if (!isCalendarDate(latestCompletedDate)) {
    throw new Error("Latest completed close date is invalid.");
  }

  const eligibleDates = events.map((event) => {
    if (!isCalendarDate(event.occurredAt)) {
      throw new Error(`Ledger event ${event.id} date is invalid.`);
    }
    return event.occurredAt;
  }).filter((date) => date <= latestCompletedDate);

  if (eligibleDates.length === 0) {
    return [];
  }

  return [...new Set([...eligibleDates, latestCompletedDate])].sort(
    (left, right) => left.localeCompare(right),
  );
}
