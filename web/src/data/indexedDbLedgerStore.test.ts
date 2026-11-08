import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { LedgerEvent } from "../domain/ledger";
import { IndexedDbLedgerStore } from "./indexedDbLedgerStore";

function testStore(): { name: string; store: IndexedDbLedgerStore } {
  const name = `atlas-anonymous-ledger-test-${crypto.randomUUID()}`;
  return { name, store: new IndexedDbLedgerStore(name) };
}

describe("IndexedDbLedgerStore", () => {
  it("distinguishes no personal ledger from an initialized empty one", async () => {
    const { name, store } = testStore();
    expect(await store.read()).toBeUndefined();
    await store.write([]);
    await store.close();

    const reopened = new IndexedDbLedgerStore(name);
    expect(await reopened.read()).toEqual([]);
    await reopened.close();
  });

  it("stores a validated chronological timeline across database connections", async () => {
    const { name, store } = testStore();
    const events: LedgerEvent[] = [
      { id: "exchange", occurredAt: "2026-01-02", accountId: "anonymous", type: "FX_TO_USD", amountCny: 70, amountUsd: 10 },
      { id: "deposit", occurredAt: "2026-01-01", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 100 },
    ];
    const original = structuredClone(events);

    expect((await store.write(events)).map((event) => event.id)).toEqual(["deposit", "exchange"]);
    expect(events).toEqual(original);
    await store.close();

    const reopened = new IndexedDbLedgerStore(name);
    expect((await reopened.read())?.map((event) => event.id)).toEqual(["deposit", "exchange"]);
    await reopened.close();
  });

  it("rejects an invalid backfill without replacing the previous ledger", async () => {
    const { store } = testStore();
    const deposit: LedgerEvent = {
      id: "deposit", occurredAt: "2026-01-02", accountId: "anonymous", type: "CNY_DEPOSIT", amountCny: 100,
    };
    await store.write([deposit]);

    await expect(store.write([
      { id: "early-withdrawal", occurredAt: "2026-01-01", accountId: "anonymous", type: "CNY_WITHDRAWAL", amountCny: 10 },
      deposit,
    ])).rejects.toThrow();
    expect(await store.read()).toEqual([deposit]);
    await store.close();
  });

  it("rejects a corrupt persisted record instead of displaying demo data", async () => {
    const { name, store } = testStore();
    await store.write([]);
    await store.close();

    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction("ledger-state", "readwrite");
      transaction.objectStore("ledger-state").put({ key: "personal", schemaVersion: 2, events: [] });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();

    const reopened = new IndexedDbLedgerStore(name);
    await expect(reopened.read()).rejects.toThrow(/unsupported/);
    await reopened.close();
  });
});
