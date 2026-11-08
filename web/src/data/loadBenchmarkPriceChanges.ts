import {
  isCalendarDate,
  type SecurityIdentifier,
  type SecurityQuote,
  type SecurityQuoteRequest,
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

export interface BenchmarkQuoteSource {
  getSecurityQuote(request: SecurityQuoteRequest): Promise<{ quote: SecurityQuote }>;
}

export type BenchmarkPriceChange =
  | {
      status: "READY";
      symbol: BenchmarkSymbol;
      priceChange: number;
      startCloseDate: string;
      endCloseDate: string;
    }
  | { status: "UNAVAILABLE"; symbol: BenchmarkSymbol; reason: string };

function validClose(
  quote: SecurityQuote,
  security: SecurityIdentifier,
  requestedDate: string,
): boolean {
  const closeDate = quote.marketTimestamp.slice(0, 10);
  return (
    quote.kind === "SECURITY_QUOTE" &&
    quote.security.symbol.toUpperCase() === security.symbol &&
    quote.security.exchange.toUpperCase() === security.exchange &&
    quote.security.currency === security.currency &&
    quote.security.assetType === security.assetType &&
    Number.isFinite(quote.price) &&
    quote.price > 0 &&
    isCalendarDate(closeDate) &&
    Number.isFinite(Date.parse(quote.marketTimestamp)) &&
    closeDate <= requestedDate
  );
}

export async function loadBenchmarkPriceChanges(
  startDate: string,
  endDate: string,
  quoteSource: BenchmarkQuoteSource,
): Promise<BenchmarkPriceChange[]> {
  if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate >= endDate) {
    throw new Error("Benchmark comparison requires two ordered calendar dates.");
  }

  return Promise.all(BENCHMARKS.map(async ({ symbol, security }) => {
    try {
      const [start, end] = await Promise.all([
        quoteSource.getSecurityQuote({ security, date: startDate }),
        quoteSource.getSecurityQuote({ security, date: endDate }),
      ]);
      if (
        !validClose(start.quote, security, startDate) ||
        !validClose(end.quote, security, endDate)
      ) {
        throw new Error("Closing price did not match the requested ETF or date.");
      }

      const startCloseDate = start.quote.marketTimestamp.slice(0, 10);
      const endCloseDate = end.quote.marketTimestamp.slice(0, 10);
      if (startCloseDate > endCloseDate ||
        (startCloseDate === endCloseDate && start.quote.price !== end.quote.price)) {
        throw new Error("Closing-price observation dates are inconsistent.");
      }
      const priceChange = end.quote.price / start.quote.price - 1;
      if (!Number.isFinite(priceChange)) {
        throw new Error("Closing-price change is invalid.");
      }
      return { status: "READY", symbol, priceChange, startCloseDate, endCloseDate };
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        symbol,
        reason: error instanceof Error ? error.message : "Closing price unavailable.",
      };
    }
  }));
}
