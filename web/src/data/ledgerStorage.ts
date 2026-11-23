import { sampleLedger } from "./sampleLedger";
import type { LedgerEvent } from "../domain/ledger";
import type { PositionSecurityMapping } from "../domain/calculateHoldingsValuation";
import { sortLedgerEventsChronologically } from "../domain/sortLedgerEvents";
import { validateLedgerTimeline } from "../domain/validateLedgerTimeline";
import { parseSecurityProfiles } from "./securityProfileStorage";
import { isValidStockSplitRatio } from "../domain/stockSplit";

export const LEGACY_LEDGER_STORAGE_KEY = "atlas-portfolio-ledger";
export const LEGACY_PERSONAL_LEDGER_KEY = "atlas-portfolio-personal-ledger-initialized";
const STORAGE_KEY = LEGACY_LEDGER_STORAGE_KEY;
const PERSONAL_LEDGER_KEY = LEGACY_PERSONAL_LEDGER_KEY;
const BACKUP_APP_NAME = "atlas-portfolio";
const BACKUP_SCHEMA_VERSION = 3;

interface PortfolioBackup {
  app: typeof BACKUP_APP_NAME;
  schemaVersion: typeof BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  ledger: LedgerEvent[];
  securityProfiles: PositionSecurityMapping[];
}

export interface PortfolioBackupData {
  ledger: LedgerEvent[];
  securityProfiles: PositionSecurityMapping[];
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

    case "STOCK_SPLIT":
      return isString(value.symbol) && value.symbol.trim().length > 0 &&
        isValidStockSplitRatio(value.newShares, value.oldShares);

    case "IN_KIND_CONTRIBUTION":
      return (
        value.source === "CASHBACK_REWARD" &&
        value.currency === "USD" &&
        isString(value.symbol) &&
        isPositiveNumber(value.quantity) &&
        isPositiveNumber(value.priceUsd)
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

function parseBackupData(
  parsedBackup: unknown,
): PortfolioBackupData | undefined {
  if (Array.isArray(parsedBackup)) {
    return { ledger: parsedBackup, securityProfiles: [] };
  }

  if (
    isRecord(parsedBackup) &&
    parsedBackup.app === BACKUP_APP_NAME &&
    Array.isArray(parsedBackup.ledger)
  ) {
    if (parsedBackup.schemaVersion === 1) {
      return { ledger: parsedBackup.ledger, securityProfiles: [] };
    }

    if (parsedBackup.schemaVersion === 2 || parsedBackup.schemaVersion === BACKUP_SCHEMA_VERSION) {
      return {
        ledger: parsedBackup.ledger,
        securityProfiles: parseSecurityProfiles(parsedBackup.securityProfiles),
      };
    }
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
      return sortLedgerEventsChronologically(parsedLedger as LedgerEvent[]);
    }
  } catch {
    // 如果本地保存的数据损坏，则安全地回退到匿名示例账本。
  }

  return sortLedgerEventsChronologically(sampleLedger);
}

export function saveLedger(events: LedgerEvent[]): LedgerEvent[] {
  const orderedEvents = validateLedgerTimeline(events);

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(orderedEvents));
  return orderedEvents;
}

export function serializePortfolioBackup(
  events: LedgerEvent[],
  securityProfiles: PositionSecurityMapping[],
): string {
  const backup: PortfolioBackup = {
    app: BACKUP_APP_NAME,
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    ledger: sortLedgerEventsChronologically(events),
    securityProfiles: parseSecurityProfiles(securityProfiles),
  };

  return JSON.stringify(backup, null, 2);
}

export function parsePortfolioBackup(backupText: string): PortfolioBackupData {
  const parsedBackup: unknown = JSON.parse(backupText);
  const backup = parseBackupData(parsedBackup);

  if (!backup || !backup.ledger.every(isLedgerEvent)) {
    throw new Error("Invalid Atlas Portfolio backup.");
  }

  return {
    ...backup,
    ledger: sortLedgerEventsChronologically(backup.ledger),
  };
}

export function hasInitializedPersonalLedger(): boolean {
  return window.localStorage.getItem(PERSONAL_LEDGER_KEY) === "true";
}

export function savePersonalLedger(events: LedgerEvent[]): LedgerEvent[] {
  const orderedEvents = saveLedger(events);

  window.localStorage.setItem(PERSONAL_LEDGER_KEY, "true");
  return orderedEvents;
}

export function initializeEmptyPersonalLedger(): LedgerEvent[] {
  const emptyLedger: LedgerEvent[] = [];

  return savePersonalLedger(emptyLedger);
}

export function resetLedger(): void {
  window.localStorage.removeItem(STORAGE_KEY);
  window.localStorage.removeItem(PERSONAL_LEDGER_KEY);
}
