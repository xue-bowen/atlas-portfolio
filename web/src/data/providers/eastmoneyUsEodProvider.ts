import {
  MarketDataProviderError,
  type MarketDataErrorCode,
  type SecurityQuote,
  type SecurityQuoteProvider,
  type SecurityQuoteRequest,
} from "../../domain/marketData";

const EASTMONEY_US_DAILY_URL =
  "https://push2his.eastmoney.com/api/qt/stock/kline/get";

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface EastmoneyDailyData {
  code: string;
  market: number;
  name: string;
  klines: string[];
}

interface EastmoneyDailyResponse {
  rc: number;
  data: EastmoneyDailyData | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEastmoneyDailyResponse(
  value: unknown,
): value is EastmoneyDailyResponse {
  if (!isRecord(value) || typeof value.rc !== "number") {
    return false;
  }

  if (value.data === null) {
    return true;
  }

  return (
    isRecord(value.data) &&
    typeof value.data.code === "string" &&
    typeof value.data.market === "number" &&
    typeof value.data.name === "string" &&
    Array.isArray(value.data.klines) &&
    value.data.klines.every((item) => typeof item === "string")
  );
}

function marketIdForExchange(exchange: string): number | undefined {
  const normalized = exchange.trim().toUpperCase();

  if (normalized.includes("NASDAQ")) {
    return 105;
  }

  if (
    normalized.includes("NYSE ARCA") ||
    normalized === "ARCA" ||
    normalized.includes("AMEX") ||
    normalized.includes("NYSE AMERICAN")
  ) {
    return 107;
  }

  if (normalized === "NYSE" || normalized.includes("NEW YORK STOCK EXCHANGE")) {
    return 106;
  }

  return undefined;
}

function errorCodeForStatus(status: number): MarketDataErrorCode {
  if (status === 429) {
    return "RATE_LIMITED";
  }

  if (status === 400 || status === 403 || status === 404) {
    return "NOT_SUPPORTED";
  }

  return "NETWORK_ERROR";
}

export class EastmoneyUsEodProvider implements SecurityQuoteProvider {
  readonly id = "eastmoney-us-eod";
  private readonly fetchFunction: FetchFunction;
  private readonly now: () => Date;

  constructor(
    fetchFunction: FetchFunction = window.fetch.bind(window),
    now: () => Date = () => new Date(),
  ) {
    this.fetchFunction = fetchFunction;
    this.now = now;
  }

  async getSecurityQuote(
    request: SecurityQuoteRequest,
  ): Promise<SecurityQuote> {
    if (request.security.currency !== "USD") {
      throw new MarketDataProviderError(
        this.id,
        "NOT_SUPPORTED",
        "Eastmoney US daily quotes require a USD security profile.",
      );
    }

    const symbol = request.security.symbol.trim().toUpperCase();
    const marketId = marketIdForExchange(request.security.exchange);

    if (!symbol || marketId === undefined) {
      throw new MarketDataProviderError(
        this.id,
        "NOT_SUPPORTED",
        "Automatic closing prices currently support NASDAQ, NYSE, NYSE Arca, and NYSE American profiles.",
      );
    }

    const parameters = new URLSearchParams({
      secid: `${marketId}.${symbol}`,
      klt: "101",
      fqt: "0",
      lmt: "10",
      end: "20500101",
      fields1: "f1,f2,f3,f4,f5,f6",
      fields2: "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61",
    });
    let response: Response;

    try {
      response = await this.fetchFunction(
        `${EASTMONEY_US_DAILY_URL}?${parameters.toString()}`,
        { headers: { Accept: "application/json" } },
      );
    } catch {
      throw new MarketDataProviderError(
        this.id,
        "NETWORK_ERROR",
        "Unable to reach the public daily-price source.",
      );
    }

    if (!response.ok) {
      throw new MarketDataProviderError(
        this.id,
        errorCodeForStatus(response.status),
        `Public daily-price request failed with HTTP ${response.status}.`,
      );
    }

    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "The public daily-price source returned invalid JSON.",
      );
    }

    if (
      !isEastmoneyDailyResponse(responseBody) ||
      responseBody.rc !== 0 ||
      !responseBody.data ||
      responseBody.data.klines.length === 0 ||
      responseBody.data.code.trim().toUpperCase() !== symbol ||
      responseBody.data.market !== marketId
    ) {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "The public daily-price response did not match the requested security.",
      );
    }

    const latestDailyBar = responseBody.data.klines.at(-1)?.split(",");
    const marketDate = latestDailyBar?.[0];
    const price = Number(latestDailyBar?.[2]);

    if (
      !marketDate ||
      !/^\d{4}-\d{2}-\d{2}$/.test(marketDate) ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "The public daily-price source returned an invalid closing price.",
      );
    }

    return {
      kind: "SECURITY_QUOTE",
      security: request.security,
      price,
      marketTimestamp: `${marketDate}T00:00:00.000Z`,
      fetchedAt: this.now().toISOString(),
      provider: this.id,
      sourceInstitution: `Eastmoney public US daily data (${responseBody.data.name})`,
      isDelayed: true,
    };
  }
}
