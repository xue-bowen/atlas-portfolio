import {
  MarketDataProviderError,
  type FxRate,
  type FxRateProvider,
  type FxRateRequest,
} from "../../domain/marketData";

const FRANKFURTER_RATES_URL = "https://api.frankfurter.dev/v2/rates";

type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

interface FrankfurterProviderRate {
  key: string;
  date: string;
  rate: number;
  excluded?: boolean;
}

interface FrankfurterRate {
  date: string;
  base: string;
  quote: string;
  rate: number;
  providers?: FrankfurterProviderRate[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isProviderRate(value: unknown): value is FrankfurterProviderRate {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value.date)) &&
    isPositiveNumber(value.rate) &&
    (value.excluded === undefined || typeof value.excluded === "boolean")
  );
}

function isFrankfurterRate(value: unknown): value is FrankfurterRate {
  return (
    isRecord(value) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(value.date)) &&
    typeof value.base === "string" &&
    typeof value.quote === "string" &&
    isPositiveNumber(value.rate) &&
    (value.providers === undefined ||
      (Array.isArray(value.providers) && value.providers.every(isProviderRate)))
  );
}

function sourceInstitution(rate: FrankfurterRate): string {
  const contributingProviders = rate.providers
    ?.filter((provider) => provider.excluded !== true)
    .map((provider) => provider.key.trim())
    .filter(Boolean)
    .sort();

  if (!contributingProviders?.length) {
    return "Frankfurter blended institutional sources";
  }

  return `Frankfurter blend (${contributingProviders.join(", ")})`;
}

function errorForResponse(status: number): MarketDataProviderError {
  if (status === 429) {
    return new MarketDataProviderError(
      "frankfurter-v2",
      "RATE_LIMITED",
      "Frankfurter rate limit reached.",
    );
  }

  if (status === 400 || status === 404 || status === 422) {
    return new MarketDataProviderError(
      "frankfurter-v2",
      "NOT_SUPPORTED",
      "Frankfurter does not support this FX rate request.",
    );
  }

  return new MarketDataProviderError(
    "frankfurter-v2",
    "NETWORK_ERROR",
    `Frankfurter request failed with HTTP ${status}.`,
  );
}

export class FrankfurterFxProvider implements FxRateProvider {
  readonly id = "frankfurter-v2";
  private readonly fetchFunction: FetchFunction;
  private readonly now: () => Date;

  constructor(
    fetchFunction: FetchFunction = window.fetch.bind(window),
    now: () => Date = () => new Date(),
  ) {
    this.fetchFunction = fetchFunction;
    this.now = now;
  }

  async getFxRate(request: FxRateRequest): Promise<FxRate> {
    if (
      request.date !== undefined &&
      !/^\d{4}-\d{2}-\d{2}$/.test(request.date)
    ) {
      throw new MarketDataProviderError(
        this.id,
        "NOT_SUPPORTED",
        "Frankfurter FX dates must use YYYY-MM-DD format.",
      );
    }

    const parameters = new URLSearchParams({
      base: request.pair.baseCurrency,
      quotes: request.pair.quoteCurrency,
      expand: "providers",
    });

    if (request.date) {
      parameters.set("date", request.date);
    }

    let response: Response;

    try {
      response = await this.fetchFunction(
        `${FRANKFURTER_RATES_URL}?${parameters.toString()}`,
        { headers: { Accept: "application/json" } },
      );
    } catch {
      throw new MarketDataProviderError(
        this.id,
        "NETWORK_ERROR",
        "Unable to reach Frankfurter.",
      );
    }

    if (!response.ok) {
      throw errorForResponse(response.status);
    }

    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "Frankfurter returned invalid JSON.",
      );
    }

    if (!Array.isArray(responseBody)) {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "Frankfurter returned an unexpected FX response.",
      );
    }

    const matchingRate = responseBody.find(
      (value): value is FrankfurterRate =>
        isFrankfurterRate(value) &&
        value.base === request.pair.baseCurrency &&
        value.quote === request.pair.quoteCurrency,
    );

    if (!matchingRate) {
      throw new MarketDataProviderError(
        this.id,
        "INVALID_RESPONSE",
        "Frankfurter response did not contain the requested FX pair.",
      );
    }

    return {
      kind: "FX_RATE",
      pair: request.pair,
      rate: matchingRate.rate,
      marketTimestamp: `${matchingRate.date}T00:00:00.000Z`,
      fetchedAt: this.now().toISOString(),
      provider: this.id,
      sourceInstitution: sourceInstitution(matchingRate),
      isDelayed: true,
    };
  }
}
