import type { Connect, Plugin } from "vite";
import { buildYahooChartUpstreamUrl, isYahooChartSymbol } from "./yahooChartRequest.ts";

/** Fixed upstream and query: this endpoint cannot proxy arbitrary URLs. */
export function createYahooChartMiddleware(fetcher: typeof fetch = fetch): Connect.NextHandleFunction {
  return async (request, response, next) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/api/yahoo-chart") return next();
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const fail = (status: number, message: string) => {
      response.statusCode = status;
      response.end(JSON.stringify({ error: message }));
    };
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      return fail(405, "Only GET is supported.");
    }
    const symbol = url.searchParams.get("symbol") ?? "";
    if (!isYahooChartSymbol(symbol) ||
      [...url.searchParams.keys()].some((key) => key !== "symbol") ||
      url.searchParams.getAll("symbol").length !== 1) {
      return fail(400, "A single US security symbol is required.");
    }
    try {
      const upstream = buildYahooChartUpstreamUrl(symbol);
      const result = await fetcher(upstream, {
        headers: { Accept: "application/json" }, signal: AbortSignal.timeout(10000),
      });
      if (!result.ok) return fail([401, 403, 429].includes(result.status) ? result.status : 502,
        `Yahoo Finance returned HTTP ${result.status}.`);
      const body = await result.text();
      if (body.length > 8_000_000) return fail(502, "Yahoo Finance response exceeds the daily-series limit.");
      const parsed: unknown = JSON.parse(body);
      if (typeof parsed !== "object" || parsed === null || !("chart" in parsed)) {
        return fail(502, "Yahoo Finance did not return chart JSON.");
      }
      response.statusCode = 200;
      response.end(JSON.stringify(parsed));
    } catch {
      fail(502, "Unable to fetch valid Yahoo Finance daily data.");
    }
  };
}

export function yahooChartProxy(): Plugin {
  return {
    name: "atlas-yahoo-daily-bridge",
    configureServer(server) { server.middlewares.use(createYahooChartMiddleware()); },
    configurePreviewServer(server) { server.middlewares.use(createYahooChartMiddleware()); },
  };
}
