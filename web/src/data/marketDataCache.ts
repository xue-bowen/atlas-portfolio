import {
  isCalendarDate,
  type FxPair,
  type MarketDataValue,
  type SecurityIdentifier,
} from "../domain/marketData";

const DATABASE_NAME = "atlas-portfolio-market-data";
const DATABASE_VERSION = 1;
const CACHE_STORE_NAME = "market-data-cache";

export type MarketDataCacheFreshness = "FRESH" | "STALE";

export interface MarketDataCacheRecord {
  key: string;
  value: MarketDataValue;
  expiresAt: string;
}

export interface MarketDataCacheHit extends MarketDataCacheRecord {
  freshness: MarketDataCacheFreshness;
}

function normalizedIdentifierPart(value: string, fieldName: string): string {
  const normalized = value.trim().toUpperCase();

  if (!normalized) {
    throw new Error(`${fieldName} is required to create a market-data cache key.`);
  }

  return encodeURIComponent(normalized);
}

function normalizedFxDate(date?: string): string {
  if (date === undefined) {
    return "LATEST";
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("FX cache date must use YYYY-MM-DD format.");
  }

  return date;
}

function timestampInMilliseconds(timestamp: string, fieldName: string): number {
  const milliseconds = Date.parse(timestamp);

  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${fieldName} must be a valid timestamp.`);
  }

  return milliseconds;
}

export function createSecurityQuoteCacheKey(
  security: SecurityIdentifier,
  date?: string,
): string {
  if (date !== undefined && !isCalendarDate(date)) {
    throw new Error("Security quote cache date must use YYYY-MM-DD format.");
  }

  return [
    "SECURITY_QUOTE",
    security.assetType,
    security.currency,
    normalizedIdentifierPart(security.exchange, "Security exchange"),
    normalizedIdentifierPart(security.symbol, "Security symbol"),
    ...(date ? [date] : []),
  ].join(":");
}

export function createFxRateCacheKey(pair: FxPair, date?: string): string {
  return [
    "FX_RATE",
    pair.baseCurrency,
    pair.quoteCurrency,
    normalizedFxDate(date),
  ].join(":");
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) {
        database.createObjectStore(CACHE_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => {
      const database = request.result;

      database.onversionchange = () => database.close();
      resolve(database);
    };

    request.onerror = () => {
      reject(request.error ?? new Error("Unable to open the market-data cache."));
    };

    request.onblocked = () => {
      reject(new Error("Market-data cache upgrade is blocked by another tab."));
    };
  });
}

export class IndexedDbMarketDataCache {
  private databasePromise: Promise<IDBDatabase> | undefined;

  private database(): Promise<IDBDatabase> {
    this.databasePromise ??= openDatabase().catch((error: unknown) => {
      this.databasePromise = undefined;
      throw error;
    });
    return this.databasePromise;
  }

  async put(record: MarketDataCacheRecord): Promise<void> {
    if (!record.key.trim()) {
      throw new Error("Market-data cache key is required.");
    }

    timestampInMilliseconds(record.expiresAt, "expiresAt");

    const database = await this.database();
    const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);

    transaction.objectStore(CACHE_STORE_NAME).put(record);
    await completed;
  }

  async get(
    key: string,
    now: Date = new Date(),
  ): Promise<MarketDataCacheHit | undefined> {
    const database = await this.database();
    const transaction = database.transaction(CACHE_STORE_NAME, "readonly");
    const completed = transactionComplete(transaction);
    const record = await requestResult(
      transaction
        .objectStore(CACHE_STORE_NAME)
        .get(key) as IDBRequest<MarketDataCacheRecord | undefined>,
    );
    await completed;

    if (!record) {
      return undefined;
    }

    const expiresAt = timestampInMilliseconds(record.expiresAt, "expiresAt");

    return {
      ...record,
      freshness: now.getTime() < expiresAt ? "FRESH" : "STALE",
    };
  }

  async delete(key: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);

    transaction.objectStore(CACHE_STORE_NAME).delete(key);
    await completed;
  }

  async clear(): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(CACHE_STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);

    transaction.objectStore(CACHE_STORE_NAME).clear();
    await completed;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) {
      return;
    }

    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }
}
