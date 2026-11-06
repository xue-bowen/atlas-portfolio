import {
  isCalendarDate,
  MarketDataProviderError,
  type MarketDataErrorCode,
  type SecurityQuote,
  type SecurityQuoteProvider,
  type SecurityQuoteRequest,
} from "../domain/marketData";
import {
  createSecurityQuoteCacheKey,
  type MarketDataCacheHit,
  type MarketDataCacheRecord,
} from "./marketDataCache";

export const DEFAULT_SECURITY_QUOTE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PERMANENT_HISTORICAL_QUOTE_EXPIRY = "9999-12-31T23:59:59.999Z";

export type SecurityQuoteResolutionStatus =
  | "PROVIDER_FRESH"
  | "CACHE_FRESH"
  | "CACHE_STALE";

export interface SecurityQuoteRefreshError {
  provider: string;
  code: MarketDataErrorCode | "UNKNOWN_ERROR";
  message: string;
}

export interface SecurityQuoteResolution {
  quote: SecurityQuote;
  status: SecurityQuoteResolutionStatus;
  cacheKey: string;
  expiresAt: string;
  refreshError?: SecurityQuoteRefreshError;
}

export interface SecurityQuoteCache {
  get(key: string, now?: Date): Promise<MarketDataCacheHit | undefined>;
  put(record: MarketDataCacheRecord): Promise<void>;
}

export interface SecurityQuoteLookupOptions {
  forceRefresh?: boolean;
}

interface CachedSecurityQuoteServiceOptions {
  quoteTtlMs?: number;
  now?: () => Date;
}

function dateInMilliseconds(date: Date, fieldName: string): number {
  const milliseconds = date.getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return milliseconds;
}

function normalized(value: string): string {
  return value.trim().toUpperCase();
}

function matchingCachedSecurityQuote(
  hit: MarketDataCacheHit | undefined,
  request: SecurityQuoteRequest,
): SecurityQuote | undefined {
  if (
    hit?.value.kind !== "SECURITY_QUOTE" ||
    normalized(hit.value.security.symbol) !==
      normalized(request.security.symbol) ||
    normalized(hit.value.security.exchange) !==
      normalized(request.security.exchange) ||
    hit.value.security.currency !== request.security.currency ||
    hit.value.security.assetType !== request.security.assetType ||
    !Number.isFinite(hit.value.price) ||
    hit.value.price <= 0 ||
    !isCalendarDate(hit.value.marketTimestamp.slice(0, 10)) ||
    !Number.isFinite(Date.parse(hit.value.marketTimestamp)) ||
    (request.date !== undefined &&
      hit.value.marketTimestamp.slice(0, 10) > request.date)
  ) {
    return undefined;
  }

  return hit.value;
}

function refreshError(
  error: unknown,
  provider: SecurityQuoteProvider,
): SecurityQuoteRefreshError {
  if (error instanceof MarketDataProviderError) {
    return {
      provider: error.provider,
      code: error.code,
      message: error.message,
    };
  }

  return {
    provider: provider.id,
    code: "UNKNOWN_ERROR",
    message:
      error instanceof Error
        ? error.message
        : "Unknown security quote refresh error.",
  };
}

export class CachedSecurityQuoteService {
  private readonly cache: SecurityQuoteCache;
  private readonly provider: SecurityQuoteProvider;
  private readonly quoteTtlMs: number;
  private readonly now: () => Date;
  private readonly inFlightRequests = new Map<
    string,
    Promise<SecurityQuoteResolution>
  >();

  constructor(
    cache: SecurityQuoteCache,
    provider: SecurityQuoteProvider,
    options: CachedSecurityQuoteServiceOptions = {},
  ) {
    const quoteTtlMs =
      options.quoteTtlMs ?? DEFAULT_SECURITY_QUOTE_CACHE_TTL_MS;

    if (!Number.isFinite(quoteTtlMs) || quoteTtlMs <= 0) {
      throw new Error("quoteTtlMs must be a positive number.");
    }

    this.cache = cache;
    this.provider = provider;
    this.quoteTtlMs = quoteTtlMs;
    this.now = options.now ?? (() => new Date());
  }

  async getSecurityQuote(
    request: SecurityQuoteRequest,
    options: SecurityQuoteLookupOptions = {},
  ): Promise<SecurityQuoteResolution> {
    const cacheKey = createSecurityQuoteCacheKey(request.security, request.date);
    const forceRefresh = options.forceRefresh === true;
    const inFlightKey = `${cacheKey}:${forceRefresh ? "FORCE" : "DEFAULT"}`;
    const existingRequest = this.inFlightRequests.get(inFlightKey);

    if (existingRequest) {
      return existingRequest;
    }

    const pendingRequest = this.resolveSecurityQuote(
      request,
      cacheKey,
      forceRefresh,
    );
    this.inFlightRequests.set(inFlightKey, pendingRequest);

    try {
      return await pendingRequest;
    } finally {
      if (this.inFlightRequests.get(inFlightKey) === pendingRequest) {
        this.inFlightRequests.delete(inFlightKey);
      }
    }
  }

  private async resolveSecurityQuote(
    request: SecurityQuoteRequest,
    cacheKey: string,
    forceRefresh: boolean,
  ): Promise<SecurityQuoteResolution> {
    const cacheLookupTime = this.now();
    dateInMilliseconds(cacheLookupTime, "now");

    const cacheHit = await this.cache.get(cacheKey, cacheLookupTime);
    const cachedQuote = matchingCachedSecurityQuote(cacheHit, request);

    if (
      !forceRefresh &&
      cachedQuote &&
      cacheHit?.freshness === "FRESH"
    ) {
      return {
        quote: cachedQuote,
        status: "CACHE_FRESH",
        cacheKey,
        expiresAt: cacheHit.expiresAt,
      };
    }

    let providerQuote: SecurityQuote;

    try {
      providerQuote = await this.provider.getSecurityQuote(request);
      if (
        providerQuote.kind !== "SECURITY_QUOTE" ||
        normalized(providerQuote.security.symbol) !== normalized(request.security.symbol) ||
        normalized(providerQuote.security.exchange) !== normalized(request.security.exchange) ||
        providerQuote.security.currency !== request.security.currency ||
        providerQuote.security.assetType !== request.security.assetType ||
        !Number.isFinite(providerQuote.price) ||
        providerQuote.price <= 0 ||
        !isCalendarDate(providerQuote.marketTimestamp.slice(0, 10)) ||
        !Number.isFinite(Date.parse(providerQuote.marketTimestamp)) ||
        (request.date !== undefined &&
          providerQuote.marketTimestamp.slice(0, 10) > request.date)
      ) {
        throw new MarketDataProviderError(
          this.provider.id,
          "INVALID_RESPONSE",
          "The closing price does not match the requested security or date.",
        );
      }
    } catch (error) {
      if (cachedQuote && cacheHit) {
        return {
          quote: cachedQuote,
          status:
            cacheHit.freshness === "FRESH" ? "CACHE_FRESH" : "CACHE_STALE",
          cacheKey,
          expiresAt: cacheHit.expiresAt,
          refreshError: refreshError(error, this.provider),
        };
      }

      throw error;
    }

    const expiresAt = request.date
      ? PERMANENT_HISTORICAL_QUOTE_EXPIRY
      : new Date(
          dateInMilliseconds(this.now(), "now") + this.quoteTtlMs,
        ).toISOString();

    await this.cache.put({
      key: cacheKey,
      value: providerQuote,
      expiresAt,
    });

    return {
      quote: providerQuote,
      status: "PROVIDER_FRESH",
      cacheKey,
      expiresAt,
    };
  }
}
