export function isYahooChartSymbol(symbol: string): boolean {
  return /^[A-Z][A-Z0-9-]{0,19}$/.test(symbol);
}

/** Explicit time bounds keep Yahoo from silently reducing max history to months. */
export function buildYahooChartUpstreamUrl(symbol: string, nowMs = Date.now()): URL {
  if (!isYahooChartSymbol(symbol) || !Number.isFinite(nowMs) || nowMs < 1000) {
    throw new Error("A valid symbol and current timestamp are required.");
  }
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.search = new URLSearchParams({
    period1: "0", period2: String(Math.floor(nowMs / 1000)), interval: "1d", events: "div,splits",
  }).toString();
  return url;
}

export const YAHOO_USER_AGENT = "AtlasPortfolio/0.1 (+https://github.com/xue-bowen/atlas-portfolio)";
const MAX_CHART_BYTES = 8_000_000;

export class YahooChartRequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "YahooChartRequestError";
    this.status = status;
  }
}

function upstreamError(status: number): YahooChartRequestError {
  return new YahooChartRequestError([401, 403, 429].includes(status) ? status : 502,
    `Yahoo Finance returned HTTP ${status}.`);
}

/** Count bytes while streaming, including when Content-Length is absent or false. */
async function readLimitedText(response: Response, limit: number): Promise<string> {
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body?.cancel();
    throw new YahooChartRequestError(502, "Yahoo Finance response exceeds the daily-series limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new YahooChartRequestError(502, "Yahoo Finance response exceeds the daily-series limit.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Anonymous Yahoo session only; browser credentials never enter this function. */
export async function fetchYahooChartJson(symbol: string, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const url = buildYahooChartUpstreamUrl(symbol);
    // One deadline covers chart, anonymous session setup, and the single retry.
    const signal = AbortSignal.timeout(10_000);
    const headers = { Accept: "application/json", "User-Agent": YAHOO_USER_AGENT };
    const request = (target: URL | string, cookie?: string) => fetcher(target instanceof URL ? new URL(target) : target, {
      headers: { ...headers, ...(cookie ? { Cookie: cookie } : {}) }, signal, redirect: "manual",
    });
    let response = await request(url);
    if (response.status === 401 || response.status === 403) {
      const rejectedStatus = response.status;
      await response.body?.cancel();
      const session = await request("https://fc.yahoo.com/");
      // fc.yahoo.com may return 404 while setting its anonymous A3 cookie.
      const cookieHeaders = typeof session.headers.getSetCookie === "function"
        ? session.headers.getSetCookie() : [session.headers.get("set-cookie") ?? ""];
      const cookie = cookieHeaders.map((value) => /(?:^|,\s*)A3=([^;,\s]+)/.exec(value)?.[1])
        .find((value) => value && value.length <= 8192);
      await session.body?.cancel();
      if (session.status === 429) throw upstreamError(429);
      if (!cookie) throw upstreamError(rejectedStatus);
      const cookieHeader = `A3=${cookie}`;
      const crumbResponse = await request("https://query1.finance.yahoo.com/v1/test/getcrumb", cookieHeader);
      if (!crumbResponse.ok) {
        await crumbResponse.body?.cancel();
        throw upstreamError(crumbResponse.status);
      }
      const crumb = (await readLimitedText(crumbResponse, 4096)).trim();
      if (!/^[!-~]{1,256}$/.test(crumb) || /[<>]/.test(crumb)) {
        throw upstreamError(rejectedStatus);
      }
      url.searchParams.set("crumb", crumb);
      response = await request(url, cookieHeader);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw upstreamError(response.status);
    }
    const body = await readLimitedText(response, MAX_CHART_BYTES);
    const parsed: unknown = JSON.parse(body);
    if (!record(parsed) || !record(parsed.chart) || parsed.chart.error || !Array.isArray(parsed.chart.result)) {
      throw new YahooChartRequestError(502, "Yahoo Finance did not return chart JSON.");
    }
    return JSON.stringify(parsed);
  } catch (error) {
    if (error instanceof YahooChartRequestError) throw error;
    throw new YahooChartRequestError(502, "Unable to fetch valid Yahoo Finance daily data.");
  }
}
