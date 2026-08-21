import { sampleLedger } from "./sampleLedger";
import type { LedgerEvent } from "../domain/ledger";

const STORAGE_KEY = "atlas-portfolio-ledger";
const PERSONAL_LEDGER_KEY = "atlas-portfolio-personal-ledger-initialized";
const BACKUP_APP_NAME = "atlas-portfolio";
const BACKUP_SCHEMA_VERSION = 1;

interface LedgerBackup {
  app: typeof BACKUP_APP_NAME;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  ledger: LedgerEvent[];
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hasBaseLedgerFields(event: UnknownRecord): boolean {
  return (
    isString(event.id) &&
    isString(event.occurredAt) &&
    /^\d{4}-\d{2}-\d{2}$/.test(event.occurredAt) &&
    isString(event.accountId) &&
    (event.note === undefined || isString(event.note))
  );
}

function isLedgerEvent(value: unknown): value is LedgerEvent {
  if (!isRecord(value) || !hasBaseLedgerFields(value)) {
    return false;
  }

  switch (value.type) {
    case "CNY_DEPOSIT":
    case "CNY_WITHDRAWAL":
      return isPositiveNumber(value.amountCny);

    case "FX_TO_USD":
      return (
        isPositiveNumber(value.amountCny) && isPositiveNumber(value.amountUsd)
      );

    case "FX_TO_CNY":
      return (
        isPositiveNumber(value.amountUsd) && isPositiveNumber(value.amountCny)
      );

    case "BUY":
    case "SELL":
      return (
        isString(value.symbol) &&
        isPositiveNumber(value.quantity) &&
        isPositiveNumber(value.priceUsd) &&
        isNonNegativeNumber(value.feeUsd)
      );

    case "DIVIDEND":
      return (
        isString(value.symbol) &&
        isPositiveNumber(value.grossAmountUsd) &&
        isNonNegativeNumber(value.withholdingTaxUsd)
      );

    case "INTEREST":
      return (
        isPositiveNumber(value.amountUsd) ||
        ((value.currency === "CNY" ||
          value.currency === "HKD" ||
          value.currency === "USD") &&
          isPositiveNumber(value.amount))
      );

    case "FEE":
      return (
        isPositiveNumber(value.amountUsd) &&
        (value.category === "COMMISSION" ||
          value.category === "ADR_FEE" ||
          value.category === "OTHER")
      );

    default:
      return false;
  }
}

function parseBackupLedger(parsedBackup: unknown): LedgerEvent[] | undefined {
  if (Array.isArray(parsedBackup)) {
    return parsedBackup;
  }

  if (
    isRecord(parsedBackup) &&
    parsedBackup.app === BACKUP_APP_NAME &&
    parsedBackup.schemaVersion === BACKUP_SCHEMA_VERSION &&
    Array.isArray(parsedBackup.ledger)
  ) {
    return parsedBackup.ledger;
  }

  return undefined;
}

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

export function serializeLedgerBackup(events: LedgerEvent[]): string {
  const backup: LedgerBackup = {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ledger: events,
  };

  return JSON.stringify(backup, null, 2);
}

export function parseLedgerBackup(backupText: string): LedgerEvent[] {
  const parsedBackup: unknown = JSON.parse(backupText);
  const ledger = parseBackupLedger(parsedBackup);

  if (!ledger || !ledger.every(isLedgerEvent)) {
    throw new Error("Invalid Atlas Portfolio ledger backup.");
  }

  return ledger;
}

export function hasInitializedPersonalLedger(): boolean {
  return window.localStorage.getItem(PERSONAL_LEDGER_KEY) === "true";
}

export function savePersonalLedger(events: LedgerEvent[]): void {
  saveLedger(events);
  window.localStorage.setItem(PERSONAL_LEDGER_KEY, "true");
}

export function initializeEmptyPersonalLedger(): LedgerEvent[] {
  const emptyLedger: LedgerEvent[] = [];

  savePersonalLedger(emptyLedger);

  return emptyLedger;
}

export function resetLedger(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(PERSONAL_LEDGER_KEY);
}
