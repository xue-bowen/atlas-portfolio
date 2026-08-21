import type { Currency } from "./ledger";

export type MarketDataAssetType = "STOCK" | "ETF";

export interface SecurityIdentifier {
  symbol: string;
  exchange: string;
  currency: Currency;
  assetType: MarketDataAssetType;
}

export interface FxPair {
  baseCurrency: Currency;
  quoteCurrency: Currency;
}

interface MarketDataObservation {
  marketTimestamp: string;
  fetchedAt: string;
  provider: string;
  sourceInstitution: string;
  isDelayed: boolean;
}

export interface SecurityQuote extends MarketDataObservation {
  kind: "SECURITY_QUOTE";
  security: SecurityIdentifier;
  price: number;
}

export interface FxRate extends MarketDataObservation {
  kind: "FX_RATE";
  pair: FxPair;
  rate: number;
}

export type MarketDataValue = SecurityQuote | FxRate;

export interface SecurityQuoteRequest {
  security: SecurityIdentifier;
}

export interface FxRateRequest {
  pair: FxPair;
  date?: string;
}

export interface MarketDataProvider {
  readonly id: string;
}

export interface SecurityQuoteProvider extends MarketDataProvider {
  getSecurityQuote(request: SecurityQuoteRequest): Promise<SecurityQuote>;
}

export interface FxRateProvider extends MarketDataProvider {
  getFxRate(request: FxRateRequest): Promise<FxRate>;
}

export type MarketDataErrorCode =
  | "NOT_SUPPORTED"
  | "RATE_LIMITED"
  | "DAILY_BUDGET_EXCEEDED"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE";

export class MarketDataProviderError extends Error {
  readonly provider: string;
  readonly code: MarketDataErrorCode;

  constructor(
    provider: string,
    code: MarketDataErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MarketDataProviderError";
    this.provider = provider;
    this.code = code;
  }
}
