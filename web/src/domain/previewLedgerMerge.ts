import type { LedgerEvent } from "./ledger";
import { validateLedgerTimeline } from "./validateLedgerTimeline";

export interface LedgerMergePreview {
  ledger: LedgerEvent[];
  added: LedgerEvent[];
  skippedCount: number;
}

function eventContents(event: LedgerEvent): string {
  return JSON.stringify(
    Object.entries(event)
      .filter(([, value]) => value !== undefined)
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

export function previewLedgerMerge(
  existing: readonly LedgerEvent[],
  incoming: readonly LedgerEvent[],
): LedgerMergePreview {
  const byId = new Map(existing.map((event) => [event.id, event]));
  const added: LedgerEvent[] = [];
  let skippedCount = 0;

  for (const event of incoming) {
    const previous = byId.get(event.id);
    if (previous) {
      if (eventContents(previous) !== eventContents(event)) {
        throw new Error(`Event ID ${event.id} has different details in the current ledger and import.`);
      }
      skippedCount += 1;
      continue;
    }

    byId.set(event.id, event);
    added.push(event);
  }

  return {
    ledger: validateLedgerTimeline([...existing, ...added]),
    added,
    skippedCount,
  };
}
