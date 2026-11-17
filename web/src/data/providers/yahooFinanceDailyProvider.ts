import {
  isCalendarDate,
  MarketDataProviderError,
  type SecurityIdentifier,
  type SecurityQuote,
  type SecurityQuoteProvider,
  type SecurityQuoteRequest,
} from "../../domain/marketData";
import type { ImportedMarketPrice } from "../parseMarketPriceCsv";

type FetchFunction = typeof globalThis.fetch;
interface DailySeries {
  prices: ImportedMarketPrice[];
  fetchedAt: string;
}

const exchanges: Record<string, readonly string[]> = {
  NASDAQ: ["NMS", "NGM", "NCM", "NASDAQ"],
  NYSE: ["NYQ", "NYSE"],
  "NYSE ARCA": ["PCX", "NYSEARCA"],
  ARCA: ["PCX", "NYSEARCA"],
  "NYSE AMERICAN": ["ASE", "AMEX"],
  AMEX: ["ASE", "AMEX"],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const usDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
});

function usDate(seconds: number): string {
  return usDateFormat.format(new Date(seconds * 1000));
}

/** Yahoo chart responses are fetched through a same-origin server bridge. */
export class YahooFinanceDailyProvider implements SecurityQuoteProvider {
  readonly id = "yahoo-finance-daily";
  readonly label = "Yahoo Finance adjusted daily closes";
  private readonly series = new Map<string, Promise<DailySeries>>();
  private readonly endpoint: string;
  private readonly fetchFunction: FetchFunction;
  private readonly now: () => Date;

  constructor(
    endpoint = "/api/yahoo-chart",
    fetchFunction: FetchFunction = globalThis.fetch.bind(globalThis),
    now: () => Date = () => new Date(),
  ) {
    this.endpoint = endpoint;
    this.fetchFunction = fetchFunction;
    this.now = now;
  }

  private failure(code: MarketDataProviderError["code"], message: string): never {
    throw new MarketDataProviderError(this.id, code, message);
  }

  private load(security: SecurityIdentifier): Promise<DailySeries> {
    const symbol = security.symbol.trim().toUpperCase();
    const exchange = security.exchange.trim().toUpperCase();
    const allowedExchanges = exchanges[exchange];
    if (security.currency !== "USD" || !allowedExchanges ||
      !["STOCK", "ETF"].includes(security.assetType) ||
      !/^[A-Z][A-Z0-9.-]{0,19}$/.test(symbol)) {
      this.failure("NOT_SUPPORTED", "Yahoo daily prices require a supported US stock/ETF profile in USD.");
    }
    const key = `${exchange}:${security.assetType}:${symbol}`;
    let pending = this.series.get(key);
    if (!pending) {
      pending = this.fetchSeries(security, symbol.replaceAll(".", "-"), allowedExchanges);
      // One provider instance represents one refresh/calculation batch. Retain
      // failures too, so every historical date does not retry a rejected feed.
      this.series.set(key, pending);
    }
    return pending;
  }

  private async fetchSeries(
    security: SecurityIdentifier,
    yahooSymbol: string,
    allowedExchanges: readonly string[],
  ): Promise<DailySeries> {
    let response: Response;
    try {
      const separator = this.endpoint.includes("?") ? "&" : "?";
      response = await this.fetchFunction(
        `${this.endpoint}${separator}symbol=${encodeURIComponent(yahooSymbol)}`,
        { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000) },
      );
    } catch {
      this.failure("NETWORK_ERROR", "Unable to reach the Yahoo Finance daily-price bridge.");
    }
    if (!response.ok) {
      this.failure(
        response.status === 429 ? "RATE_LIMITED" :
          response.status === 401 || response.status === 403 ? "AUTHENTICATION_ERROR" : "NETWORK_ERROR",
        `Yahoo Finance daily request failed with HTTP ${response.status}.`,
      );
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.failure("INVALID_RESPONSE", "Yahoo Finance returned invalid JSON.");
    }
    if (!record(body) || !record(body.chart) || body.chart.error ||
      !Array.isArray(body.chart.result) || body.chart.result.length !== 1) {
      this.failure("INVALID_RESPONSE", "Yahoo Finance did not return a daily series.");
    }
    const result: unknown = body.chart.result[0];
    if (!record(result) || !record(result.meta) || !record(result.indicators)) {
      this.failure("INVALID_RESPONSE", "Yahoo Finance returned an invalid daily series.");
    }
    const meta = result.meta;
    const quote: unknown = Array.isArray(result.indicators.quote) ? result.indicators.quote[0] : undefined;
    const adjustment: unknown = Array.isArray(result.indicators.adjclose) ? result.indicators.adjclose[0] : undefined;
    const adjusted = record(adjustment) ? adjustment.adjclose : undefined;
    const timestamps = result.timestamp;
    if (meta.symbol !== yahooSymbol || meta.currency !== "USD" ||
      !allowedExchanges.includes(String(meta.exchangeName).toUpperCase()) ||
      meta.instrumentType !== (security.assetType === "ETF" ? "ETF" : "EQUITY") ||
      (meta.dataGranularity !== undefined && meta.dataGranularity !== "1d") ||
      (meta.exchangeTimezoneName !== undefined && meta.exchangeTimezoneName !== "America/New_York") ||
      !Array.isArray(timestamps) || !record(quote) || !Array.isArray(quote.close) ||
      timestamps.length !== quote.close.length ||
      (adjusted !== undefined && (!Array.isArray(adjusted) || adjusted.length !== timestamps.length))) {
      this.failure("INVALID_RESPONSE", "Yahoo Finance series does not match the requested security or daily rows.");
    }

    const fetchedAt = this.now().toISOString();
    const nowSeconds = Date.parse(fetchedAt) / 1000;
    const today = usDate(nowSeconds);
    const regular = record(meta.currentTradingPeriod) && record(meta.currentTradingPeriod.regular)
      ? meta.currentTradingPeriod.regular : undefined;
    const todayComplete = regular && positive(regular.end) &&
      usDate(regular.end) === today && nowSeconds >= regular.end + 15 * 60;

    const splitValues = record(result.events) && record(result.events.splits)
      ? Object.values(result.events.splits) : [];
    const splits = splitValues.map((split) => {
      if (!record(split) || !positive(split.date) ||
        split.date > 8e12 || !positive(split.numerator) || !positive(split.denominator) ||
        !positive(split.numerator / split.denominator)) {
        this.failure("INVALID_RESPONSE", "Yahoo Finance returned an invalid split event.");
      }
      const date = usDate(split.date);
      if (!isCalendarDate(date)) this.failure("INVALID_RESPONSE", "Yahoo Finance returned an invalid split date.");
      return { date, ratio: split.numerator / split.denominator };
    });
    if (new Set(splits.map((split) => split.date)).size !== splits.length) {
      this.failure("INVALID_RESPONSE", "Yahoo Finance returned duplicate split events.");
    }

    const prices: ImportedMarketPrice[] = [];
    let previousTimestamp = -Infinity;
    let previousDate = "";
    for (let index = 0; index < timestamps.length; index++) {
      const timestamp: unknown = timestamps[index];
      if (typeof timestamp !== "number" || !Number.isSafeInteger(timestamp) ||
        timestamp <= previousTimestamp || Math.abs(timestamp) > 8e12) {
        this.failure("INVALID_RESPONSE", "Yahoo Finance daily timestamps must be valid and strictly ordered.");
      }
      previousTimestamp = timestamp;
      const date = usDate(timestamp);
      if (!isCalendarDate(date) || date <= previousDate) {
        this.failure("INVALID_RESPONSE", "Yahoo Finance returned duplicate or invalid trading dates.");
      }
      previousDate = date;
      // A daily chart may include the still-trading session as its final row.
      if (date > today || (date === today && !todayComplete)) continue;
      const close: unknown = quote.close[index];
      if (close === null) continue;
      const adjustedClose: unknown = Array.isArray(adjusted) ? adjusted[index] : undefined;
      if (!positive(close) || (adjustedClose !== undefined && adjustedClose !== null && !positive(adjustedClose))) {
        this.failure("INVALID_RESPONSE", "Yahoo Finance returned an invalid daily closing price.");
      }
      // Yahoo Close is split-adjusted. Ledger quantities need the as-traded
      // historical price; Adj Close remains adjusted for benchmark ratios.
      const splitFactor = splits.filter((split) => split.date > date && split.date <= today)
        .reduce((factor, split) => factor * split.ratio, 1);
      const closeUsd = close * splitFactor;
      if (!positive(closeUsd)) this.failure("INVALID_RESPONSE", "Yahoo historical split conversion overflowed.");
      prices.push({
        date, security, closeUsd,
        ...(positive(adjustedClose) ? { adjustedCloseUsd: adjustedClose } : {}),
      });
    }
    if (!prices.length) this.failure("NOT_SUPPORTED", "Yahoo Finance has no completed daily closes for this security.");
    return { prices, fetchedAt };
  }

  async getLatestOnOrBefore(security: SecurityIdentifier, date: string): Promise<ImportedMarketPrice | undefined> {
    if (!isCalendarDate(date)) this.failure("NOT_SUPPORTED", "Yahoo historical dates must use YYYY-MM-DD.");
    const series = await this.load(security);
    return series.prices.findLast((price) => price.date <= date);
  }

  async getSecurityQuote(request: SecurityQuoteRequest): Promise<SecurityQuote> {
    if (request.date !== undefined && !isCalendarDate(request.date)) {
      this.failure("NOT_SUPPORTED", "Yahoo historical dates must use YYYY-MM-DD.");
    }
    const series = await this.load(request.security);
    const price = request.date
      ? series.prices.findLast((price) => price.date <= request.date!)
      : series.prices.at(-1);
    if (!price) this.failure("NOT_SUPPORTED", "Yahoo Finance has no completed close on or before the requested date.");
    return {
      kind: "SECURITY_QUOTE", security: request.security, price: price.closeUsd,
      marketTimestamp: `${price.date}T00:00:00.000Z`, fetchedAt: series.fetchedAt,
      provider: this.id, sourceInstitution: "Yahoo Finance daily chart", isDelayed: true,
    };
  }
}
