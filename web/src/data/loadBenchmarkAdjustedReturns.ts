import {
  isCalendarDate,
  type SecurityIdentifier,
} from "../domain/marketData";
import type { ImportedMarketPrice } from "./parseMarketPriceCsv";

export type BenchmarkSymbol = "IVV" | "QQQ";

const BENCHMARKS: readonly { symbol: BenchmarkSymbol; security: SecurityIdentifier }[] = [
  {
    symbol: "IVV",
    security: { symbol: "IVV", exchange: "NYSE ARCA", currency: "USD", assetType: "ETF" },
  },
  {
    symbol: "QQQ",
    security: { symbol: "QQQ", exchange: "NASDAQ", currency: "USD", assetType: "ETF" },
  },
];

export interface BenchmarkAdjustedPriceSource {
  readonly label?: string;
  getLatestOnOrBefore(
    security: SecurityIdentifier,
    date: string,
  ): Promise<ImportedMarketPrice | undefined>;
}

export type BenchmarkAdjustedReturn =
  | {
      status: "READY";
      symbol: BenchmarkSymbol;
      adjustedReturn: number;
      startCloseDate: string;
      endCloseDate: string;
      source: string;
    }
  | { status: "UNAVAILABLE"; symbol: BenchmarkSymbol; reason: string };

function validAdjustedClose(
  observation: ImportedMarketPrice | undefined,
  security: SecurityIdentifier,
  requestedDate: string,
): observation is ImportedMarketPrice & { adjustedCloseUsd: number } {
  return Boolean(
    observation &&
    observation.security.symbol.toUpperCase() === security.symbol &&
    observation.security.exchange.toUpperCase() === security.exchange &&
    observation.security.currency === security.currency &&
    observation.security.assetType === security.assetType &&
    isCalendarDate(observation.date) &&
    observation.date <= requestedDate &&
    observation.adjustedCloseUsd !== undefined &&
    Number.isFinite(observation.adjustedCloseUsd) &&
    observation.adjustedCloseUsd > 0,
  );
}

export async function loadBenchmarkAdjustedReturns(
  startDate: string,
  endDate: string,
  source: BenchmarkAdjustedPriceSource,
  automaticSource?: BenchmarkAdjustedPriceSource,
): Promise<BenchmarkAdjustedReturn[]> {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate >= endDate) {
    throw new Error("Benchmark comparison requires two ordered calendar dates.");
  }

  return Promise.all(BENCHMARKS.map(async ({ symbol, security }) => {
    try {
      const loadPair = (selected: BenchmarkAdjustedPriceSource) => Promise.all([
        selected.getLatestOnOrBefore(security, startDate),
        selected.getLatestOnOrBefore(security, endDate),
      ]);
      let selected = source;
      let pair: Awaited<ReturnType<typeof loadPair>> | undefined;
      try {
        pair = await loadPair(source);
      } catch (error) {
        if (!automaticSource) throw error;
      }
      // Both endpoints must use one adjustment series, never mixed providers.
      if (automaticSource && (!pair ||
        !validAdjustedClose(pair[0], security, startDate) ||
        !validAdjustedClose(pair[1], security, endDate) ||
        pair[0].date >= pair[1].date)) {
        selected = automaticSource;
        pair = await loadPair(automaticSource);
      }
      const [start, end] = pair ?? [];
      if (
        !validAdjustedClose(start, security, startDate) ||
        !validAdjustedClose(end, security, endDate)
      ) {
        throw new Error("Dividend-adjusted daily closes are missing for this period.");
      }
      if (start.date >= end.date) {
        throw new Error("The comparison period needs two distinct benchmark closes.");
      }

      const adjustedReturn = end.adjustedCloseUsd / start.adjustedCloseUsd - 1;
      if (!Number.isFinite(adjustedReturn)) {
        throw new Error("Adjusted benchmark return is invalid.");
      }
      return {
        status: "READY",
        symbol,
        adjustedReturn,
        startCloseDate: start.date,
        endCloseDate: end.date,
        source: selected.label ?? "Local imported adjusted closes",
      };
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        symbol,
        reason: error instanceof Error ? error.message : "Adjusted benchmark close unavailable.",
      };
    }
  }));
}
