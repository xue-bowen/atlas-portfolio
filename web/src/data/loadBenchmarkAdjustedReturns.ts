import {
  isCalendarDate,
  type SecurityIdentifier,
} from "../domain/marketData";

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

export interface BenchmarkAdjustedObservation {
  security: SecurityIdentifier;
  date: string;
  adjustedCloseUsd?: number;
}

export interface BenchmarkAdjustedPriceSource {
  readonly label?: string;
  getLatestOnOrBefore(
    security: SecurityIdentifier,
    date: string,
  ): Promise<BenchmarkAdjustedObservation | undefined>;
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
  observation: BenchmarkAdjustedObservation | undefined,
  security: SecurityIdentifier,
  requestedDate: string,
): observation is BenchmarkAdjustedObservation & { adjustedCloseUsd: number } {
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
  automaticSource?: BenchmarkAdjustedPriceSource | readonly BenchmarkAdjustedPriceSource[],
): Promise<BenchmarkAdjustedReturn[]> {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate >= endDate) {
    throw new Error("Benchmark comparison requires two ordered calendar dates.");
  }

  const alternatives = !automaticSource ? [] : "getLatestOnOrBefore" in automaticSource
    ? [automaticSource] : automaticSource;
  const candidates = [source, ...alternatives];

  return Promise.all(BENCHMARKS.map(async ({ symbol, security }) => {
    const failures: string[] = [];
    for (const selected of candidates) {
      try {
        const [start, end] = await Promise.all([
          selected.getLatestOnOrBefore(security, startDate),
          selected.getLatestOnOrBefore(security, endDate),
        ]);
        // Retry the entire pair with the next source. Adjustment bases from
        // separate providers must never be combined in one return ratio.
        if (!validAdjustedClose(start, security, startDate) ||
          !validAdjustedClose(end, security, endDate)) {
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
          status: "READY" as const,
          symbol,
          adjustedReturn,
          startCloseDate: start.date,
          endCloseDate: end.date,
          source: selected.label ?? "Local imported adjusted closes",
        };
      } catch (error) {
        failures.push(`${selected.label ?? "Local imported adjusted closes"}: ${
          error instanceof Error ? error.message : "Adjusted benchmark close unavailable."
        }`);
      }
    }
    return { status: "UNAVAILABLE" as const, symbol, reason: failures.join(" ") };
  }));
}
