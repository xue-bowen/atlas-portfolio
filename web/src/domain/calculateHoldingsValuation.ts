import type { PositionBalance } from "./calculateBalances";
import type { SecurityIdentifier, SecurityQuote } from "./marketData";

export interface PositionSecurityMapping {
  positionSymbol: string;
  security: SecurityIdentifier;
}

export type HoldingsValuationStatus =
  | "VALUED"
  | "MISSING_SECURITY_IDENTIFIER"
  | "MISSING_QUOTE"
  | "UNSUPPORTED_QUOTE_CURRENCY";

interface HoldingsValuationPositionBase extends PositionBalance {
  averageCostUsd: number;
  status: HoldingsValuationStatus;
}

export interface ValuedHolding extends HoldingsValuationPositionBase {
  status: "VALUED";
  security: SecurityIdentifier;
  quote: SecurityQuote;
  marketValueUsd: number;
  unrealizedPnlUsd: number;
}

export interface UncoveredHolding extends HoldingsValuationPositionBase {
  status: Exclude<HoldingsValuationStatus, "VALUED">;
  security?: SecurityIdentifier;
}

export type HoldingsValuationPosition = ValuedHolding | UncoveredHolding;

export interface HoldingsValuation {
  positions: HoldingsValuationPosition[];
  valuedPositions: ValuedHolding[];
  uncoveredPositions: UncoveredHolding[];
  coveredMarketValueUsd: number;
  totalMarketValueUsd?: number;
  coveredCostUsd: number;
  totalCostUsd: number;
  coveredPositionCount: number;
  totalPositionCount: number;
}

function normalized(value: string, fieldName: string): string {
  const result = value.trim().toUpperCase();

  if (!result) {
    throw new Error(`${fieldName} is required.`);
  }

  return result;
}

function securityKey(security: SecurityIdentifier): string {
  return [
    security.assetType,
    security.currency,
    normalized(security.exchange, "Security exchange"),
    normalized(security.symbol, "Security symbol"),
  ].join(":");
}

function validatePosition(position: PositionBalance): void {
  normalized(position.symbol, "Position symbol");

  if (!Number.isFinite(position.quantity) || position.quantity <= 0) {
    throw new Error(
      `Position quantity for ${position.symbol} must be a positive number.`,
    );
  }

  if (!Number.isFinite(position.costUsd) || position.costUsd < 0) {
    throw new Error(
      `Position USD cost for ${position.symbol} must be a non-negative number.`,
    );
  }
}

function createPositionMappingIndex(
  mappings: PositionSecurityMapping[],
): Map<string, SecurityIdentifier> {
  const index = new Map<string, SecurityIdentifier>();

  for (const mapping of mappings) {
    const positionSymbol = normalized(
      mapping.positionSymbol,
      "Mapped position symbol",
    );
    securityKey(mapping.security);

    if (index.has(positionSymbol)) {
      throw new Error(
        `Position ${positionSymbol} has more than one security identifier mapping.`,
      );
    }

    index.set(positionSymbol, mapping.security);
  }

  return index;
}

function createQuoteIndex(quotes: SecurityQuote[]): Map<string, SecurityQuote> {
  const index = new Map<string, SecurityQuote>();

  for (const quote of quotes) {
    const key = securityKey(quote.security);

    if (!Number.isFinite(quote.price) || quote.price <= 0) {
      throw new Error(
        `Quote price for ${quote.security.symbol} must be a positive number.`,
      );
    }

    if (index.has(key)) {
      throw new Error(
        `Security ${quote.security.symbol} has more than one matching quote.`,
      );
    }

    index.set(key, quote);
  }

  return index;
}

export function calculateHoldingsValuation(
  positions: PositionBalance[],
  mappings: PositionSecurityMapping[],
  quotes: SecurityQuote[],
): HoldingsValuation {
  const positionSymbols = new Set<string>();

  for (const position of positions) {
    validatePosition(position);
    const positionSymbol = normalized(position.symbol, "Position symbol");

    if (positionSymbols.has(positionSymbol)) {
      throw new Error(`Position ${positionSymbol} appears more than once.`);
    }

    positionSymbols.add(positionSymbol);
  }

  const mappingIndex = createPositionMappingIndex(mappings);
  const quoteIndex = createQuoteIndex(quotes);

  const valuedPositions: ValuedHolding[] = [];
  const uncoveredPositions: UncoveredHolding[] = [];
  const valuationPositions: HoldingsValuationPosition[] = [];

  for (const position of positions) {
    const averageCostUsd = position.costUsd / position.quantity;
    const security = mappingIndex.get(
      normalized(position.symbol, "Position symbol"),
    );

    if (!security) {
      const uncovered: UncoveredHolding = {
        ...position,
        averageCostUsd,
        status: "MISSING_SECURITY_IDENTIFIER",
      };
      uncoveredPositions.push(uncovered);
      valuationPositions.push(uncovered);
      continue;
    }

    if (security.currency !== "USD") {
      const uncovered: UncoveredHolding = {
        ...position,
        averageCostUsd,
        status: "UNSUPPORTED_QUOTE_CURRENCY",
        security,
      };
      uncoveredPositions.push(uncovered);
      valuationPositions.push(uncovered);
      continue;
    }

    const quote = quoteIndex.get(securityKey(security));

    if (!quote) {
      const uncovered: UncoveredHolding = {
        ...position,
        averageCostUsd,
        status: "MISSING_QUOTE",
        security,
      };
      uncoveredPositions.push(uncovered);
      valuationPositions.push(uncovered);
      continue;
    }

    const marketValueUsd = position.quantity * quote.price;
    const valued: ValuedHolding = {
      ...position,
      averageCostUsd,
      status: "VALUED",
      security,
      quote,
      marketValueUsd,
      unrealizedPnlUsd: marketValueUsd - position.costUsd,
    };
    valuedPositions.push(valued);
    valuationPositions.push(valued);
  }

  const coveredMarketValueUsd = valuedPositions.reduce(
    (total, position) => total + position.marketValueUsd,
    0,
  );
  const coveredCostUsd = valuedPositions.reduce(
    (total, position) => total + position.costUsd,
    0,
  );
  const totalCostUsd = positions.reduce(
    (total, position) => total + position.costUsd,
    0,
  );

  return {
    positions: valuationPositions,
    valuedPositions,
    uncoveredPositions,
    coveredMarketValueUsd,
    totalMarketValueUsd:
      uncoveredPositions.length === 0 ? coveredMarketValueUsd : undefined,
    coveredCostUsd,
    totalCostUsd,
    coveredPositionCount: valuedPositions.length,
    totalPositionCount: positions.length,
  };
}
