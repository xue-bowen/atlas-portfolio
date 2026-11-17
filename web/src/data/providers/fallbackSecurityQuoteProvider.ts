import { MarketDataProviderError, type SecurityQuoteProvider, type SecurityQuoteRequest } from "../../domain/marketData";

export class FallbackSecurityQuoteProvider implements SecurityQuoteProvider {
  readonly id = "automatic-daily-quotes";
  private readonly primary: SecurityQuoteProvider;
  private readonly fallback: SecurityQuoteProvider;

  constructor(
    primary: SecurityQuoteProvider,
    fallback: SecurityQuoteProvider,
  ) {
    this.primary = primary;
    this.fallback = fallback;
  }

  async getSecurityQuote(request: SecurityQuoteRequest) {
    try {
      return await this.primary.getSecurityQuote(request);
    } catch (primaryError) {
      try {
        return await this.fallback.getSecurityQuote(request);
      } catch (fallbackError) {
        throw new MarketDataProviderError(this.id, "NETWORK_ERROR",
          `${this.primary.id}: ${primaryError instanceof Error ? primaryError.message : "Request failed"} ` +
          `${this.fallback.id}: ${fallbackError instanceof Error ? fallbackError.message : "Request failed"}`);
      }
    }
  }
}
