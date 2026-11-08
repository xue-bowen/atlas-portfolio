import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../domain/ledger";
import { IndexedDbLedgerStore } from "./indexedDbLedgerStore";
import { LEGACY_LEDGER_STORAGE_KEY, LEGACY_PERSONAL_LEDGER_KEY } from "./ledgerStorage";
import {
  LEDGER_MIGRATION_MARKER_KEY,
  loadOrMigrateLedger,
  type LegacyLedgerStorage,
} from "./migrateLegacyLedger";

class MemoryStorage implements LegacyLedgerStorage {
  readonly entries = new Map<string, string>();
  getItem(key: string): string | null { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string): void { this.entries.set(key, value); }
}

function testStore(): IndexedDbLedgerStore {
  return new IndexedDbLedgerStore(`atlas-anonymous-migration-${crypto.randomUUID()}`);
}

const deposit: LedgerEvent = {
  id: "deposit", occurredAt: "2026-01-01", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 100,
};
const exchange: LedgerEvent = {
  id: "exchange", occurredAt: "2026-01-02", accountId: "anonymous", type: "FX_TO_USD", amountCny: 70, amountUsd: 10,
};

describe("loadOrMigrateLedger", () => {
  it("shows anonymous demo data only when no personal storage exists", async () => {
    const store = testStore();
    const result = await loadOrMigrateLedger(store, new MemoryStorage());
    expect(result.status).toBe("DEMO");
    expect(result.ledger.length).toBeGreaterThan(0);
    expect(await store.read()).toBeUndefined();
    await store.close();
  });

  it("migrates and orders a valid legacy ledger without deleting its old copy", async () => {
    const store = testStore();
    const legacy = new MemoryStorage();
    const raw = JSON.stringify([exchange, deposit]);
    legacy.setItem(LEGACY_LEDGER_STORAGE_KEY, raw);
    legacy.setItem(LEGACY_PERSONAL_LEDGER_KEY, "true");

    const result = await loadOrMigrateLedger(store, legacy);
    expect(result).toEqual({ status: "PERSONAL", ledger: [deposit, exchange] });
    expect(await store.read()).toEqual([deposit, exchange]);
    expect(legacy.getItem(LEGACY_LEDGER_STORAGE_KEY)).toBe(raw);
    expect(legacy.getItem(LEDGER_MIGRATION_MARKER_KEY)).toBe("true");
    await store.close();
  });

  it("uses the IndexedDB ledger ahead of stale legacy data", async () => {
    const store = testStore();
    await store.write([deposit]);
    const legacy = new MemoryStorage();
    legacy.setItem(LEGACY_LEDGER_STORAGE_KEY, JSON.stringify([exchange, deposit]));

    expect(await loadOrMigrateLedger(store, legacy)).toEqual({ status: "PERSONAL", ledger: [deposit] });
    expect(legacy.getItem(LEDGER_MIGRATION_MARKER_KEY)).toBe("true");
    await store.close();
  });

  it("rejects invalid legacy history before writing IndexedDB", async () => {
    const store = testStore();
    const legacy = new MemoryStorage();
    legacy.setItem(LEGACY_LEDGER_STORAGE_KEY, JSON.stringify([
      { id: "early-withdrawal", occurredAt: "2025-12-31", accountId: "anonymous", type: "CNY_WITHDRAWAL", amountCny: 1 },
      deposit,
    ]));

    await expect(loadOrMigrateLedger(store, legacy)).rejects.toThrow();
    expect(await store.read()).toBeUndefined();
    expect(legacy.getItem(LEDGER_MIGRATION_MARKER_KEY)).toBeNull();
    await store.close();
  });

  it("rejects lost IndexedDB data instead of remigrating an old copy", async () => {
    const store = testStore();
    const legacy = new MemoryStorage();
    legacy.setItem(LEDGER_MIGRATION_MARKER_KEY, "true");
    legacy.setItem(LEGACY_LEDGER_STORAGE_KEY, JSON.stringify([deposit]));

    await expect(loadOrMigrateLedger(store, legacy)).rejects.toThrow(/missing after migration/);
    expect(await store.read()).toBeUndefined();
    await store.close();
  });

  it("rejects a personal flag with no legacy ledger", async () => {
    const store = testStore();
    const legacy = new MemoryStorage();
    legacy.setItem(LEGACY_PERSONAL_LEDGER_KEY, "true");
    await expect(loadOrMigrateLedger(store, legacy)).rejects.toThrow(/transactions are missing/);
    await store.close();
  });
});
