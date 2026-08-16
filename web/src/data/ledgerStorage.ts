import { sampleLedger } from "./sampleLedger";
import type { LedgerEvent } from "../domain/ledger";

const STORAGE_KEY = "atlas-portfolio-ledger";
const PERSONAL_LEDGER_KEY = "atlas-portfolio-personal-ledger-initialized";

export function loadLedger(): LedgerEvent[] {
  const storedLedger = window.localStorage.getItem(STORAGE_KEY);

  if (!storedLedger) {
    return sampleLedger;
  }

  try {
    const parsedLedger: unknown = JSON.parse(storedLedger);

    if (Array.isArray(parsedLedger)) {
      return parsedLedger as LedgerEvent[];
    }
  } catch {
    // 如果本地保存的数据损坏，则安全地回退到匿名示例账本。
  }

  return sampleLedger;
}

export function saveLedger(events: LedgerEvent[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
}

export function hasInitializedPersonalLedger(): boolean {
  return window.localStorage.getItem(PERSONAL_LEDGER_KEY) === "true";
}

export function initializeEmptyPersonalLedger(): LedgerEvent[] {
  const emptyLedger: LedgerEvent[] = [];

  saveLedger(emptyLedger);
  window.localStorage.setItem(PERSONAL_LEDGER_KEY, "true");

  return emptyLedger;
}

export function resetLedger(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(PERSONAL_LEDGER_KEY);
}