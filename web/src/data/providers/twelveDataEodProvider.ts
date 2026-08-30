import {
  MarketDataProviderError,
  type MarketDataErrorCode,
  type SecurityQuote,
  type SecurityQuoteProvider,
  type SecurityQuoteRequest,
} from "../../domain/marketData";

const TWELVE_DATA_EOD_URL = "https://api.twelvedata.com/eod";

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface TwelveDataEodResponse {
  symbol: string;
  exchange: string;
  mic_code: string;
  currency: string;
  datetime: string;
  close: string;
}

interface TwelveDataErrorResponse {
  code: number;
  message: string;
  status: "error";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTwelveDataErrorResponse(
  value: unknown,
): value is TwelveDataErrorResponse {
  return (
    isRecord(value) &&
    typeof value.code === "number" &&
    typeof value.message === "string" &&
    value.status === "error"
  );
}

function isTwelveDataEodResponse(
  value: unknown,
): value is TwelveDataEodResponse {
  return (
    isRecord(value) &&
    typeof value.symbol === "string" &&
    typeof value.exchange === "string" &&
    typeof value.mic_code === "string" &&
    typeof value.currency === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value.datetime)) &&
    typeof value.close === "string"
  );
}

function errorCodeForStatus(status: number): MarketDataErrorCode {
  if (status === 401) {
    return "AUTHENTICATION_ERROR";
  }

  if (status === 429) {
    return "RATE_LIMITED";
  }

  if (status === 400 || status === 403 || status === 404 || status === 414) {
    return "NOT_SUPPORTED";
  }

  return "NETWORK_ERROR";
}

function providerError(
  status: number,
  message?: string,
): MarketDataProviderError {
  return new MarketDataProviderError(
    "twelve-data-eod",
    errorCodeForStatus(status),
    message?.trim() || `Twelve Data request failed with HTTP ${status}.`,
  );
}

export class TwelveDataEodProvider implements SecurityQuoteProvider {
  readonly id = "twelve-data-eod";
  private readonly apiKey: string;
  private readonly fetchFunction: FetchFunction;
  private readonly now: () => Date;

  constructor(
    apiKey: string,
    fetchFunction: FetchFunction = window.fetch.bind(window),
    now: () => Date = () => new Date(),
  ) {
    this.apiKey = apiKey.trim();
    this.fetchFunction = fetchFunction;
    this.now = now;
  }

  async getSecurityQuote(
    request: SecurityQuoteRequest,
  ): Promise<SecurityQuote> {
    if (!this.apiKey) {
      throw new MarketDataProviderError(
        this.id,
        "AUTHENTICATION_ERROR",
        "A Twelve Data API key is required.",
      );
    }

    const symbol = request.security.symbol.trim().toUpperCase();
    const exchange = request.security.exchange.trim().toUpperCase();

    if (!symbol || !exchange) {
      throw new MarketDataProviderError(
        this.id,
        "NOT_SUPPORTED",
        "Twelve Data EOD requests require a symbol and exchange.",
      );
    }

    const parameters = new URLSearchParams({ symbol, exchange });
    let response: Response;

    try {
      response = await this.fetchFunction(
        `${TWELVE_DATA_EOD_URL}?${parameters.toString()}`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `apikey ${this.apiKey}`,
          },
        },
      );
    } catch {
      throw new MarketDataProviderError(
        this.id,
        "NETWORK_ERROR",
        "Unable to reach Twelve Data.",
      );
    }

    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      if (!response.ok) {
        throw providerError(response.status);
      }

      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "Twelve Data returned invalid JSON.",
      );
    }

    if (!response.ok || isTwelveDataErrorResponse(responseBody)) {
      const status = isTwelveDataErrorResponse(responseBody)
        ? responseBody.code
        : response.status;
      const message = isTwelveDataErrorResponse(responseBody)
        ? responseBody.message
        : undefined;

      throw providerError(status, message);
    }

    if (!isTwelveDataEodResponse(responseBody)) {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "Twelve Data returned an unexpected EOD response.",
      );
    }

    const price = Number(responseBody.close);

    if (
      responseBody.symbol.trim().toUpperCase() !== symbol ||
      responseBody.currency.trim().toUpperCase() !== request.security.currency ||
      !Number.isFinite(price) ||
      price <= 0
    ) {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "Twelve Data EOD response did not match the requested security.",
      );
    }

    const sourceExchange = responseBody.exchange.trim();
    const sourceMicCode = responseBody.mic_code.trim();
    const sourceInstitution = [sourceExchange, sourceMicCode]
      .filter(Boolean)
      .join(" / ");

    return {
      kind: "SECURITY_QUOTE",
      security: request.security,
      price,
      marketTimestamp: `${responseBody.datetime}T00:00:00.000Z`,
      fetchedAt: this.now().toISOString(),
      provider: this.id,
      sourceInstitution: sourceInstitution
        ? `Twelve Data EOD feed (${sourceInstitution})`
        : "Twelve Data EOD feed",
      isDelayed: true,
    };
  }
}
