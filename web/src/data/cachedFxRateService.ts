import {
  MarketDataProviderError,
  type FxRate,
  type FxRateProvider,
  type FxRateRequest,
  type MarketDataErrorCode,
} from "../domain/marketData";
import {
  createFxRateCacheKey,
  type MarketDataCacheHit,
  type MarketDataCacheRecord,
} from "./marketDataCache";

export const DEFAULT_LATEST_FX_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
export const PERMANENT_MARKET_DATA_EXPIRY = "9999-12-31T23:59:59.999Z";

export type FxRateResolutionStatus =
  | "PROVIDER_FRESH"
  | "CACHE_FRESH"
  | "CACHE_STALE";

export interface FxRateRefreshError {
  provider: string;
  code: MarketDataErrorCode | "UNKNOWN_ERROR";
  message: string;
}

export interface FxRateResolution {
  rate: FxRate;
  status: FxRateResolutionStatus;
  cacheKey: string;
  expiresAt: string;
  refreshError?: FxRateRefreshError;
}

export interface FxRateCache {
  get(key: string, now?: Date): Promise<MarketDataCacheHit | undefined>;
  put(record: MarketDataCacheRecord): Promise<void>;
}

export interface FxRateLookupOptions {
  forceRefresh?: boolean;
}

interface CachedFxRateServiceOptions {
  latestTtlMs?: number;
  now?: () => Date;
}

function dateInMilliseconds(date: Date, fieldName: string): number {
  const milliseconds = date.getTime();

  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${fieldName} must be a valid date.`);
  }

  return milliseconds;
}

function matchingCachedFxRate(
  hit: MarketDataCacheHit | undefined,
  request: FxRateRequest,
): FxRate | undefined {
  if (
    hit?.value.kind !== "FX_RATE" ||
    hit.value.pair.baseCurrency !== request.pair.baseCurrency ||
    hit.value.pair.quoteCurrency !== request.pair.quoteCurrency
  ) {
    return undefined;
  }

  return hit.value;
}

function refreshError(
  error: unknown,
  provider: FxRateProvider,
): FxRateRefreshError {
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
    message: error instanceof Error ? error.message : "Unknown FX refresh error.",
  };
}

export class CachedFxRateService {
  private readonly cache: FxRateCache;
  private readonly provider: FxRateProvider;
  private readonly latestTtlMs: number;
  private readonly now: () => Date;
  private readonly inFlightRequests = new Map<
    string,
    Promise<FxRateResolution>
  >();

  constructor(
    cache: FxRateCache,
    provider: FxRateProvider,
    options: CachedFxRateServiceOptions = {},
  ) {
    const latestTtlMs =
      options.latestTtlMs ?? DEFAULT_LATEST_FX_CACHE_TTL_MS;

    if (!Number.isFinite(latestTtlMs) || latestTtlMs <= 0) {
      throw new Error("latestTtlMs must be a positive number.");
    }

    this.cache = cache;
    this.provider = provider;
    this.latestTtlMs = latestTtlMs;
    this.now = options.now ?? (() => new Date());
  }

  async getFxRate(
    request: FxRateRequest,
    options: FxRateLookupOptions = {},
  ): Promise<FxRateResolution> {
    const cacheKey = createFxRateCacheKey(request.pair, request.date);
    const forceRefresh = options.forceRefresh === true;
    const inFlightKey = `${cacheKey}:${forceRefresh ? "FORCE" : "DEFAULT"}`;
    const existingRequest = this.inFlightRequests.get(inFlightKey);

    if (existingRequest) {
      return existingRequest;
    }

    const pendingRequest = this.resolveFxRate(
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

  private async resolveFxRate(
    request: FxRateRequest,
    cacheKey: string,
    forceRefresh: boolean,
  ): Promise<FxRateResolution> {
    const cacheLookupTime = this.now();
    dateInMilliseconds(cacheLookupTime, "now");

    const cacheHit = await this.cache.get(cacheKey, cacheLookupTime);
    const cachedRate = matchingCachedFxRate(cacheHit, request);

    if (
      !forceRefresh &&
      cachedRate &&
      cacheHit?.freshness === "FRESH"
    ) {
      return {
        rate: cachedRate,
        status: "CACHE_FRESH",
        cacheKey,
        expiresAt: cacheHit.expiresAt,
      };
    }

    let providerRate: FxRate;

    try {
      providerRate = await this.provider.getFxRate(request);
    } catch (error) {
      if (cachedRate && cacheHit) {
        return {
          rate: cachedRate,
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
      ? PERMANENT_MARKET_DATA_EXPIRY
      : new Date(
          dateInMilliseconds(this.now(), "now") + this.latestTtlMs,
        ).toISOString();

    await this.cache.put({
      key: cacheKey,
      value: providerRate,
      expiresAt,
    });

    return {
      rate: providerRate,
      status: "PROVIDER_FRESH",
      cacheKey,
      expiresAt,
    };
  }
}
