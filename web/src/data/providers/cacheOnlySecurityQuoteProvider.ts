import {
  MarketDataProviderError,
  type SecurityQuote,
  type SecurityQuoteProvider,
} from "../../domain/marketData";

export class CacheOnlySecurityQuoteProvider
  implements SecurityQuoteProvider
{
  readonly id = "cache-only";

  async getSecurityQuote(): Promise<SecurityQuote> {
    throw new MarketDataProviderError(
      this.id,
      "NOT_SUPPORTED",
      "No live security quote provider is configured yet.",
    );
  }
}
