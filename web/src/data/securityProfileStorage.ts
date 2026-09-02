import type { PositionSecurityMapping } from "../domain/calculateHoldingsValuation";
import type { SecurityIdentifier } from "../domain/marketData";

const STORAGE_KEY = "atlas-portfolio-security-profiles";
const STORAGE_APP_NAME = "atlas-portfolio";
const STORAGE_SCHEMA_VERSION = 1;

interface StoredSecurityProfileRegistry {
  app: typeof STORAGE_APP_NAME;
  schemaVersion: typeof STORAGE_SCHEMA_VERSION;
  profiles: PositionSecurityMapping[];
}

export type SecurityProfileRegistryLoadResult =
  | {
      status: "EMPTY" | "LOADED";
      profiles: PositionSecurityMapping[];
    }
  | {
      status: "INVALID";
      profiles: [];
      error: string;
    };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function normalized(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string.`);
  }

  const result = value.trim().toUpperCase();

  if (!result) {
    throw new Error(`${fieldName} is required.`);
  }

  return result;
}

function parseSecurityIdentifier(value: unknown): SecurityIdentifier {
  if (!isRecord(value)) {
    throw new Error("Security identifier must be an object.");
  }

  if (value.currency !== "USD") {
    throw new Error("Security profile quote currency must be USD.");
  }

  if (value.assetType !== "STOCK" && value.assetType !== "ETF") {
    throw new Error("Security profile asset type must be STOCK or ETF.");
  }

  return {
    symbol: normalized(value.symbol, "Security symbol"),
    exchange: normalized(value.exchange, "Security exchange"),
    currency: value.currency,
    assetType: value.assetType,
  };
}

function securityKey(security: SecurityIdentifier): string {
  return [
    security.assetType,
    security.currency,
    security.exchange,
    security.symbol,
  ].join(":");
}

export function parseSecurityProfiles(
  value: unknown,
): PositionSecurityMapping[] {
  if (!Array.isArray(value)) {
    throw new Error("Security profiles must be an array.");
  }

  const positionSymbols = new Set<string>();
  const securityIdentifiers = new Set<string>();

  return value.map((profile, index) => {
    if (!isRecord(profile)) {
      throw new Error(`Security profile ${index + 1} must be an object.`);
    }

    const positionSymbol = normalized(
      profile.positionSymbol,
      `Security profile ${index + 1} position symbol`,
    );
    const security = parseSecurityIdentifier(profile.security);
    const identifierKey = securityKey(security);

    if (positionSymbols.has(positionSymbol)) {
      throw new Error(
        `Position ${positionSymbol} has more than one security profile.`,
      );
    }

    if (securityIdentifiers.has(identifierKey)) {
      throw new Error(
        `Security ${security.symbol} is mapped to more than one position symbol.`,
      );
    }

    positionSymbols.add(positionSymbol);
    securityIdentifiers.add(identifierKey);

    return { positionSymbol, security };
  });
}

function parseStoredRegistry(value: unknown): PositionSecurityMapping[] {
  if (
    !isRecord(value) ||
    value.app !== STORAGE_APP_NAME ||
    value.schemaVersion !== STORAGE_SCHEMA_VERSION
  ) {
    throw new Error("Unsupported security profile registry.");
  }

  return parseSecurityProfiles(value.profiles);
}

export function loadSecurityProfileRegistry(): SecurityProfileRegistryLoadResult {
  const storedRegistry = window.localStorage.getItem(STORAGE_KEY);

  if (!storedRegistry) {
    return { status: "EMPTY", profiles: [] };
  }

  try {
    return {
      status: "LOADED",
      profiles: parseStoredRegistry(JSON.parse(storedRegistry)),
    };
  } catch (error) {
    return {
      status: "INVALID",
      profiles: [],
      error:
        error instanceof Error
          ? error.message
          : "Invalid security profile registry.",
    };
  }
}

export function saveSecurityProfiles(
  profiles: PositionSecurityMapping[],
): PositionSecurityMapping[] {
  const normalizedProfiles = parseSecurityProfiles(profiles);
  const registry: StoredSecurityProfileRegistry = {
    app: STORAGE_APP_NAME,
    schemaVersion: STORAGE_SCHEMA_VERSION,
    profiles: normalizedProfiles,
  };

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(registry));
  return normalizedProfiles;
}

export function clearSecurityProfiles(): void {
  window.localStorage.removeItem(STORAGE_KEY);
}
