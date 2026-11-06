import { calculateBalances } from "../domain/calculateBalances";
import type {
  DailyPortfolioValuationInput,
} from "../domain/calculateDailyPortfolioSnapshots";
import type { PositionSecurityMapping } from "../domain/calculateHoldingsValuation";
import type { LedgerEvent } from "../domain/ledger";
import {
  isCalendarDate,
  type FxRate,
  type FxRateRequest,
  type SecurityQuote,
  type SecurityQuoteRequest,
} from "../domain/marketData";

export interface HistoricalFxSource {
  getFxRate(request: FxRateRequest): Promise<{ rate: FxRate }>;
}

export interface HistoricalQuoteSource {
  getSecurityQuote(request: SecurityQuoteRequest): Promise<{ quote: SecurityQuote }>;
}

export interface HistoricalValuationIssue {
  date: string;
  kind: "USD_CNY" | "HKD_CNY" | "SECURITY_PROFILE" | "SECURITY_QUOTE";
  symbol?: string;
  message: string;
}

export type HistoricalValuationInputResult =
  | { status: "READY"; inputs: DailyPortfolioValuationInput[] }
  | { status: "UNAVAILABLE"; issues: HistoricalValuationIssue[] };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Market data unavailable.";
}

function validFxRate(
  rate: FxRate,
  baseCurrency: "USD" | "HKD",
  date: string,
): boolean {
  return (
    rate.kind === "FX_RATE" &&
    rate.pair.baseCurrency === baseCurrency &&
    rate.pair.quoteCurrency === "CNY" &&
    Number.isFinite(rate.rate) &&
    rate.rate > 0 &&
    isCalendarDate(rate.marketTimestamp.slice(0, 10)) &&
    Number.isFinite(Date.parse(rate.marketTimestamp)) &&
    rate.marketTimestamp.slice(0, 10) <= date
  );
}

function validQuote(
  quote: SecurityQuote,
  mapping: PositionSecurityMapping,
  date: string,
): boolean {
  return (
    quote.kind === "SECURITY_QUOTE" &&
    quote.security.symbol.toUpperCase() === mapping.security.symbol.toUpperCase() &&
    quote.security.exchange.toUpperCase() === mapping.security.exchange.toUpperCase() &&
    quote.security.currency === mapping.security.currency &&
    quote.security.assetType === mapping.security.assetType &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    isCalendarDate(quote.marketTimestamp.slice(0, 10)) &&
    Number.isFinite(Date.parse(quote.marketTimestamp)) &&
    quote.marketTimestamp.slice(0, 10) <= date
  );
}

export async function loadHistoricalValuationInputs(
  events: readonly LedgerEvent[],
  dates: readonly string[],
  securityProfiles: readonly PositionSecurityMapping[],
  fxSource: HistoricalFxSource,
  quoteSource: HistoricalQuoteSource,
): Promise<HistoricalValuationInputResult> {
  const orderedDates = [...dates].sort((left, right) => left.localeCompare(right));
  const seenDates = new Set<string>();
  const issues: HistoricalValuationIssue[] = [];
  const inputs: DailyPortfolioValuationInput[] = [];
  const profileBySymbol = new Map(
    securityProfiles.map((profile) => [
      profile.positionSymbol.toUpperCase(),
      profile,
    ]),
  );

  for (const date of orderedDates) {
    if (!isCalendarDate(date)) {
      throw new Error(`Historical valuation date ${date} is invalid.`);
    }
    if (seenDates.has(date)) {
      throw new Error(`Historical valuation date ${date} appears more than once.`);
    }
    seenDates.add(date);

    const eventsThroughDate = events.filter((event) => event.occurredAt <= date);
    const balances = calculateBalances(eventsThroughDate);
    const mappings: PositionSecurityMapping[] = [];

    for (const position of balances.positions) {
      const profile = profileBySymbol.get(position.symbol.toUpperCase());
      if (profile) {
        mappings.push(profile);
      } else {
        issues.push({
          date,
          kind: "SECURITY_PROFILE",
          symbol: position.symbol,
          message: `Security profile for ${position.symbol} is missing on ${date}.`,
        });
      }
    }

    const rateRequests = [
      { baseCurrency: "USD" as const, kind: "USD_CNY" as const },
      ...(balances.hkdCash !== 0
        ? [{ baseCurrency: "HKD" as const, kind: "HKD_CNY" as const }]
        : []),
    ];
    const rateResults = await Promise.allSettled(
      rateRequests.map(({ baseCurrency }) =>
        fxSource.getFxRate({
          pair: { baseCurrency, quoteCurrency: "CNY" },
          date,
        }),
      ),
    );
    const quoteResults = await Promise.allSettled(
      mappings.map((mapping) =>
        quoteSource.getSecurityQuote({ security: mapping.security, date }),
      ),
    );
    let usdCnyRate: FxRate | undefined;
    let hkdCnyRate: FxRate | undefined;
    const securityQuotes: SecurityQuote[] = [];

    rateResults.forEach((result, index) => {
      const request = rateRequests[index];
      if (
        result.status === "rejected" ||
        !validFxRate(result.value.rate, request.baseCurrency, date)
      ) {
        issues.push({
          date,
          kind: request.kind,
          message:
            result.status === "rejected"
              ? errorMessage(result.reason)
              : `${request.baseCurrency}/CNY rate is invalid on ${date}.`,
        });
        return;
      }

      if (request.baseCurrency === "USD") {
        usdCnyRate = result.value.rate;
      } else {
        hkdCnyRate = result.value.rate;
      }
    });

    quoteResults.forEach((result, index) => {
      const mapping = mappings[index];
      if (
        result.status === "rejected" ||
        !validQuote(result.value.quote, mapping, date)
      ) {
        issues.push({
          date,
          kind: "SECURITY_QUOTE",
          symbol: mapping.positionSymbol,
          message:
            result.status === "rejected"
              ? errorMessage(result.reason)
              : `Closing price for ${mapping.positionSymbol} is invalid on ${date}.`,
        });
        return;
      }
      securityQuotes.push(result.value.quote);
    });

    inputs.push({
      date,
      securityMappings: mappings,
      securityQuotes,
      usdCnyRate,
      hkdCnyRate,
    });
  }

  return issues.length > 0
    ? { status: "UNAVAILABLE", issues }
    : { status: "READY", inputs };
}
