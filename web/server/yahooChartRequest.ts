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
