import type { LedgerEvent } from "../domain/ledger";
import { sortLedgerEventsChronologically } from "../domain/sortLedgerEvents";
import type { IndexedDbLedgerStore } from "./indexedDbLedgerStore";
import {
  LEGACY_LEDGER_STORAGE_KEY,
  LEGACY_PERSONAL_LEDGER_KEY,
  parsePortfolioBackup,
} from "./ledgerStorage";
import { sampleLedger } from "./sampleLedger";

export const LEDGER_MIGRATION_MARKER_KEY = "atlas-portfolio-ledger-indexeddb-v1";

export type LedgerLoadResult =
  | { status: "DEMO"; ledger: LedgerEvent[] }
  | { status: "PERSONAL"; ledger: LedgerEvent[] };

export interface LegacyLedgerStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export async function loadOrMigrateLedger(
  store: Pick<IndexedDbLedgerStore, "read" | "write">,
  legacy: LegacyLedgerStorage,
): Promise<LedgerLoadResult> {
  const storedLedger = await store.read();
  if (storedLedger !== undefined) {
    legacy.setItem(LEDGER_MIGRATION_MARKER_KEY, "true");
    return { status: "PERSONAL", ledger: storedLedger };
  }

  if (legacy.getItem(LEDGER_MIGRATION_MARKER_KEY) === "true") {
    throw new Error(
      "The IndexedDB personal ledger is missing after migration. Restore a JSON backup before entering new transactions.",
    );
  }

  const rawLedger = legacy.getItem(LEGACY_LEDGER_STORAGE_KEY);
  const wasPersonal = legacy.getItem(LEGACY_PERSONAL_LEDGER_KEY) === "true";
  if (rawLedger === null) {
    if (wasPersonal) {
      throw new Error(
        "The legacy personal-ledger flag exists but its transactions are missing. Restore a JSON backup.",
      );
    }
    return { status: "DEMO", ledger: sortLedgerEventsChronologically(sampleLedger) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLedger);
  } catch {
    throw new Error("The legacy ledger JSON is invalid. Restore a JSON backup.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("The legacy ledger is not a transaction array. Restore a JSON backup.");
  }

  const validatedLedger = parsePortfolioBackup(rawLedger).ledger;
  const migratedLedger = await store.write(validatedLedger);
  legacy.setItem(LEDGER_MIGRATION_MARKER_KEY, "true");
  return { status: "PERSONAL", ledger: migratedLedger };
}
