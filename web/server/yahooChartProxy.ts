import type { Connect, Plugin } from "vite";
import { fetchYahooChartJson, isYahooChartSymbol, YahooChartRequestError } from "./yahooChartRequest.ts";

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
      const body = await fetchYahooChartJson(symbol, fetcher);
      response.statusCode = 200;
      response.end(body);
    } catch (error) {
      fail(error instanceof YahooChartRequestError ? error.status : 502,
        error instanceof YahooChartRequestError ? error.message : "Unable to fetch valid Yahoo Finance daily data.");
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
