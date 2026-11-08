import type { LedgerEvent } from "../domain/ledger";
import { validateLedgerTimeline } from "../domain/validateLedgerTimeline";
import { parsePortfolioBackup } from "./ledgerStorage";

const DATABASE_NAME = "atlas-portfolio-ledger";
const DATABASE_VERSION = 1;
const STORE_NAME = "ledger-state";
const PERSONAL_LEDGER_KEY = "personal";
const RECORD_SCHEMA_VERSION = 1;

interface LedgerRecord {
  key: typeof PERSONAL_LEDGER_KEY;
  schemaVersion: typeof RECORD_SCHEMA_VERSION;
  events: LedgerEvent[];
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Ledger request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Ledger transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Ledger transaction failed."));
  });
}

function validateRecord(value: unknown): LedgerEvent[] {
  if (
    typeof value !== "object" || value === null ||
    !Object.hasOwn(value, "key") || !Object.hasOwn(value, "schemaVersion") ||
    !Object.hasOwn(value, "events")
  ) {
    throw new Error("IndexedDB ledger record is invalid.");
  }
  const record = value as Record<string, unknown>;
  if (
    record.key !== PERSONAL_LEDGER_KEY ||
    record.schemaVersion !== RECORD_SCHEMA_VERSION ||
    !Array.isArray(record.events)
  ) {
    throw new Error("IndexedDB ledger schema is unsupported.");
  }

  return validateLedgerTimeline(
    parsePortfolioBackup(JSON.stringify(record.events)).ledger,
  );
}

export class IndexedDbLedgerStore {
  private databasePromise: Promise<IDBDatabase> | undefined;
  private readonly databaseName: string;
  private readonly factory: IDBFactory;

  constructor(
    databaseName = DATABASE_NAME,
    factory: IDBFactory = globalThis.indexedDB,
  ) {
    this.databaseName = databaseName;
    this.factory = factory;
  }

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (!this.factory) {
        reject(new Error("IndexedDB is unavailable in this browser."));
        return;
      }
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          this.databasePromise = undefined;
        };
        resolve(database);
      };
      request.onerror = () => reject(request.error ?? new Error("Unable to open ledger storage."));
      request.onblocked = () => reject(new Error("Ledger storage upgrade is blocked by another tab."));
    }).catch((error: unknown) => {
      this.databasePromise = undefined;
      throw error;
    });
    return this.databasePromise;
  }

  async read(): Promise<LedgerEvent[] | undefined> {
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionComplete(transaction);
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).get(PERSONAL_LEDGER_KEY) as IDBRequest<LedgerRecord | undefined>,
    );
    await completed;
    return record === undefined ? undefined : validateRecord(record);
  }

  async write(events: readonly LedgerEvent[]): Promise<LedgerEvent[]> {
    const orderedEvents = validateLedgerTimeline(events);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    const record: LedgerRecord = {
      key: PERSONAL_LEDGER_KEY,
      schemaVersion: RECORD_SCHEMA_VERSION,
      events: orderedEvents,
    };
    transaction.objectStore(STORE_NAME).put(record);
    await completed;
    return orderedEvents;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }
}
