import {
  isCalendarDate,
  type SecurityIdentifier,
} from "../domain/marketData";
import {
  createSecurityQuoteCacheKey,
} from "./marketDataCache";
import type { ImportedMarketPrice } from "./parseMarketPriceCsv";

const DATABASE_NAME = "atlas-portfolio-imported-market-prices";
const DATABASE_VERSION = 1;
const STORE_NAME = "daily-prices";
const SECURITY_DATE_INDEX = "security-date";

interface StoredMarketPrice extends ImportedMarketPrice {
  key: string;
  securityKey: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Market-price request failed."));
  });
}

function transactionComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("Market-price transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("Market-price transaction failed."));
  });
}

function validateAndStore(price: ImportedMarketPrice): StoredMarketPrice {
  const { security } = price;
  if (
    !isCalendarDate(price.date) ||
    security.currency !== "USD" ||
    (security.assetType !== "STOCK" && security.assetType !== "ETF") ||
    !security.symbol.trim() || !security.exchange.trim() ||
    !Number.isFinite(price.closeUsd) || price.closeUsd <= 0 ||
    (price.adjustedCloseUsd !== undefined &&
      (!Number.isFinite(price.adjustedCloseUsd) || price.adjustedCloseUsd <= 0))
  ) {
    throw new Error("Imported market price is invalid.");
  }

  const securityKey = createSecurityQuoteCacheKey(security);
  return {
    ...price,
    security: {
      ...security,
      symbol: security.symbol.trim().toUpperCase(),
      exchange: security.exchange.trim().toUpperCase(),
    },
    key: createSecurityQuoteCacheKey(security, price.date),
    securityKey,
  };
}

export class IndexedDbImportedMarketPriceStore {
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
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex(SECURITY_DATE_INDEX, ["securityKey", "date"]);
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
      request.onerror = () => reject(request.error ?? new Error("Unable to open imported market prices."));
      request.onblocked = () => reject(new Error("Imported market-price storage is blocked by another tab."));
    }).catch((error: unknown) => {
      this.databasePromise = undefined;
      throw error;
    });
    return this.databasePromise;
  }

  async putAll(prices: readonly ImportedMarketPrice[]): Promise<number> {
    const records = prices.map(validateAndStore);
    const keys = new Set(records.map((record) => record.key));
    if (keys.size !== records.length) {
      throw new Error("Imported market prices contain duplicate date/security rows.");
    }
    if (records.length === 0) return 0;

    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const completed = transactionComplete(transaction);
    const store = transaction.objectStore(STORE_NAME);
    for (const record of records) store.put(record);
    await completed;
    return records.length;
  }

  async getLatestOnOrBefore(
    security: SecurityIdentifier,
    date: string,
  ): Promise<ImportedMarketPrice | undefined> {
    if (!isCalendarDate(date)) {
      throw new Error("Market-price lookup date must use YYYY-MM-DD format.");
    }
    const securityKey = createSecurityQuoteCacheKey(security);
    const database = await this.database();
    const transaction = database.transaction(STORE_NAME, "readonly");
    const completed = transactionComplete(transaction);
    const range = IDBKeyRange.bound([securityKey, ""], [securityKey, date]);
    const record = await requestResult(
      transaction.objectStore(STORE_NAME).index(SECURITY_DATE_INDEX)
        .openCursor(range, "prev") as IDBRequest<IDBCursorWithValue | null>,
    );
    await completed;
    if (!record) return undefined;
    const { key: _key, securityKey: _securityKey, ...price } = record.value as StoredMarketPrice;
    void _key;
    void _securityKey;
    return price;
  }

  async close(): Promise<void> {
    if (!this.databasePromise) return;
    const database = await this.databasePromise;
    database.close();
    this.databasePromise = undefined;
  }
}
