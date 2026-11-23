import {
  isCalendarDate,
  MarketDataProviderError,
  type SecurityIdentifier,
} from "../../domain/marketData";
import type {
  BenchmarkAdjustedObservation,
  BenchmarkAdjustedPriceSource,
} from "../loadBenchmarkAdjustedReturns";

const ENDPOINT = "https://push2his.eastmoney.com/api/qt/stock/kline/get";
const usTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function daysBefore(date: string, days: number): string {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - days);
  return day.toISOString().slice(0, 10);
}

function completedUsDate(now: Date): string {
  const parts = Object.fromEntries(usTime.formatToParts(now).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // Conservative for early-close days too: never use the still-trading daily
  // bar. At 16:15 New York time the normal session and delay have elapsed.
  return Number(parts.hour) * 60 + Number(parts.minute) >= 16 * 60 + 15
    ? date : daysBefore(date, 1);
}

/** Benchmark-only forward-adjusted prices; never supplied as holdings quotes. */
export class EastmoneyBenchmarkPriceSource implements BenchmarkAdjustedPriceSource {
  readonly label = "Eastmoney forward-adjusted daily closes";
  private readonly series = new Map<string, Promise<BenchmarkAdjustedObservation[]>>();
  private readonly startDate: string;
  private readonly endDate: string;
  private readonly fetchFunction: typeof fetch;
  private readonly now: () => Date;

  constructor(
    startDate: string,
    endDate: string,
    fetchFunction: typeof fetch = globalThis.fetch.bind(globalThis),
    now: () => Date = () => new Date(),
  ) {
    if (!isCalendarDate(startDate) || !isCalendarDate(endDate) || startDate >= endDate) {
      throw new Error("Eastmoney benchmark history needs two ordered calendar dates.");
    }
    this.startDate = startDate;
    this.endDate = endDate;
    this.fetchFunction = fetchFunction;
    this.now = now;
  }

  private fail(code: MarketDataProviderError["code"], message: string): never {
    throw new MarketDataProviderError("eastmoney-adjusted-benchmarks", code, message);
  }

  private async download(security: SecurityIdentifier, market: number): Promise<BenchmarkAdjustedObservation[]> {
    const begin = daysBefore(this.startDate, 14);
    const end = [this.endDate, completedUsDate(this.now())].sort()[0];
    if (begin > end) return [];
    const parameters = new URLSearchParams({
      secid: `${market}.${security.symbol.trim().toUpperCase()}`,
      klt: "101", fqt: "1", beg: begin.replaceAll("-", ""),
      end: end.replaceAll("-", ""), lmt: "100000",
      fields1: "f1,f2,f3,f4,f5,f6", fields2: "f51,f52,f53",
    });
    let response: Response;
    try {
      response = await this.fetchFunction(`${ENDPOINT}?${parameters}`, {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15000),
      });
    } catch {
      this.fail("NETWORK_ERROR", "Unable to reach Eastmoney adjusted daily prices.");
    }
    if (!response.ok) {
      this.fail(response.status === 429 ? "RATE_LIMITED" : "NETWORK_ERROR",
        `Eastmoney adjusted daily request failed with HTTP ${response.status}.`);
    }
    let body: unknown;
    try { body = await response.json(); } catch {
      this.fail("INVALID_RESPONSE", "Eastmoney adjusted daily prices returned invalid JSON.");
    }
    if (!record(body) || body.rc !== 0 || !record(body.data) ||
      body.data.code !== security.symbol.trim().toUpperCase() || body.data.market !== market ||
      !Array.isArray(body.data.klines)) {
      this.fail("INVALID_RESPONSE", "Eastmoney adjusted series does not match the benchmark.");
    }
    let previousDate = "";
    const prices = body.data.klines.map((row: unknown) => {
      const fields = typeof row === "string" ? row.split(",") : [];
      const date = fields[0];
      const adjustedCloseUsd = Number(fields[2]);
      if (!date || !isCalendarDate(date) || date < begin || date > end || date <= previousDate ||
        !fields[2]?.trim() || !Number.isFinite(adjustedCloseUsd) || adjustedCloseUsd <= 0) {
        this.fail("INVALID_RESPONSE", "Eastmoney adjusted series contains an invalid or unordered close.");
      }
      previousDate = date;
      return { security, date, adjustedCloseUsd };
    });
    if (prices.length && prices.at(-1)!.date < daysBefore(end, 14)) {
      this.fail("NOT_SUPPORTED", "Eastmoney adjusted series does not cover the requested ending period.");
    }
    return prices;
  }

  async getLatestOnOrBefore(security: SecurityIdentifier, date: string): Promise<BenchmarkAdjustedObservation | undefined> {
    if (!isCalendarDate(date) || date < this.startDate || date > this.endDate) {
      this.fail("NOT_SUPPORTED", "The benchmark lookup date is outside the requested period.");
    }
    const symbol = security.symbol.trim().toUpperCase();
    const exchange = security.exchange.trim().toUpperCase();
    const market = symbol === "IVV" && exchange === "NYSE ARCA" ? 107
      : symbol === "QQQ" && exchange === "NASDAQ" ? 105 : undefined;
    if (market === undefined || security.currency !== "USD" || security.assetType !== "ETF") {
      this.fail("NOT_SUPPORTED", "Automatic adjusted benchmarks support only the IVV and QQQ USD ETF profiles.");
    }
    let pending = this.series.get(symbol);
    if (!pending) {
      pending = this.download(security, market);
      this.series.set(symbol, pending);
    }
    const prices = await pending;
    return prices.findLast((price) => price.date <= date);
  }
}
