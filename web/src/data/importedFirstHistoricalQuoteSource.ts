import type {
  SecurityQuote,
  SecurityQuoteRequest,
} from "../domain/marketData";
import type { ImportedMarketPrice } from "./parseMarketPriceCsv";

export interface ImportedMarketPriceLookup {
  getLatestOnOrBefore(
    security: SecurityQuoteRequest["security"],
    date: string,
  ): Promise<ImportedMarketPrice | undefined>;
}

export interface HistoricalQuoteFallback {
  getSecurityQuote(request: SecurityQuoteRequest): Promise<{ quote: SecurityQuote }>;
}

export class ImportedFirstHistoricalQuoteSource {
  private readonly importedPrices: ImportedMarketPriceLookup;
  private readonly fallback: HistoricalQuoteFallback;
  private readonly now: () => Date;

  constructor(
    importedPrices: ImportedMarketPriceLookup,
    fallback: HistoricalQuoteFallback,
    now: () => Date = () => new Date(),
  ) {
    this.importedPrices = importedPrices;
    this.fallback = fallback;
    this.now = now;
  }

  async getSecurityQuote(
    request: SecurityQuoteRequest,
  ): Promise<{ quote: SecurityQuote }> {
    if (!request.date) return this.fallback.getSecurityQuote(request);

    const imported = await this.importedPrices.getLatestOnOrBefore(
      request.security,
      request.date,
    );
    if (!imported) return this.fallback.getSecurityQuote(request);

    return {
      quote: {
        kind: "SECURITY_QUOTE",
        security: request.security,
        price: imported.closeUsd,
        marketTimestamp: `${imported.date}T00:00:00.000Z`,
        fetchedAt: this.now().toISOString(),
        provider: "imported-market-price-csv",
        sourceInstitution: "Local CSV supplied by user",
        isDelayed: true,
      },
    };
  }
}
