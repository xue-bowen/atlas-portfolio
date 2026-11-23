import {
  fetchYahooChartJson, isYahooChartSymbol, YahooChartRequestError,
} from "../../../web/server/yahooChartRequest.ts";

export interface Env {
  ALLOWED_ORIGINS: string;
  SYMBOL_ALLOWLIST?: string;
  YAHOO_RATE_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

export interface BridgeCache {
  match(key: Request): Promise<Response | undefined>;
  put(key: Request, value: Response): Promise<void>;
}

interface Context { waitUntil(task: Promise<unknown>): void }
interface Dependencies { fetcher?: typeof fetch; cache?: BridgeCache; now?: () => number }

function allowedOrigin(origin: string | null, configured: string): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol)) return false;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) return true;
    return configured.split(",").map((value) => value.trim()).includes(origin);
  } catch {
    return false;
  }
}

export function createYahooChartHandler({ fetcher = fetch, cache, now = Date.now }: Dependencies = {}) {
  return async (request: Request, env: Env, context: Context): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const permitted = allowedOrigin(origin, env.ALLOWED_ORIGINS ?? "");
    const finish = (body: BodyInit | null, status: number, extra?: HeadersInit) => {
      const headers = new Headers(extra);
      headers.set("Content-Type", "application/json; charset=utf-8");
      // Only the internal Cache API stores bodies; browsers re-enter CORS/rate checks.
      headers.set("Cache-Control", "no-store");
      headers.set("Vary", "Origin");
      headers.set("Allow", "GET, OPTIONS");
      if (permitted && origin) {
        headers.set("Access-Control-Allow-Origin", origin);
        headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
        headers.set("Access-Control-Allow-Headers", "Accept");
      }
      return new Response(body, { status, headers });
    };
    const fail = (status: number, message: string) => finish(JSON.stringify({ error: message }), status,
      status === 429 ? { "Retry-After": "60" } : undefined);

    const url = new URL(request.url);
    if (url.pathname !== "/api/yahoo-chart") return fail(400, "Use /api/yahoo-chart.");
    if (!permitted) return fail(403, "This origin is not allowed.");
    if (!["GET", "OPTIONS"].includes(request.method)) return fail(405, "Only GET and OPTIONS are supported.");
    if (request.method === "OPTIONS") {
      const method = request.headers.get("Access-Control-Request-Method");
      if (method && method !== "GET") return fail(405, "Only GET is supported.");
      const requestedHeaders = request.headers.get("Access-Control-Request-Headers");
      if (requestedHeaders?.split(",").some((value) => value.trim().toLowerCase() !== "accept")) {
        return fail(400, "Only the Accept request header is supported.");
      }
      return finish(null, 204);
    }
    const symbol = url.searchParams.get("symbol") ?? "";
    if (!isYahooChartSymbol(symbol) || url.searchParams.getAll("symbol").length !== 1 ||
      [...url.searchParams.keys()].some((key) => key !== "symbol")) {
      return fail(400, "A single US security symbol is required.");
    }
    const symbols = env.SYMBOL_ALLOWLIST?.split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    if (symbols?.length && !symbols.includes(symbol)) return fail(403, "This symbol is not enabled.");

    try {
      // Cloudflare supplies this header; untrusted X-Forwarded-For is never used.
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (!env.YAHOO_RATE_LIMIT) return fail(503, "The bridge rate limiter is not configured.");
      const decision = await env.YAHOO_RATE_LIMIT.limit({ key: `yahoo-chart:${ip}` });
      if (!decision.success) return fail(429, "Too many daily-price requests. Try again shortly.");
    } catch {
      return fail(503, "The bridge rate limiter is unavailable.");
    }

    const key = new URL("/api/yahoo-chart", url.origin);
    key.searchParams.set("symbol", symbol);
    key.searchParams.set("date", new Date(now()).toISOString().slice(0, 10));
    const cacheKey = new Request(key);
    const store = cache ?? (caches as CacheStorage & { default: BridgeCache }).default;
    try {
      const hit = await store.match(cacheKey);
      if (hit?.status === 200) return finish(hit.body, 200);
    } catch {
      // Cache outages must not prevent an otherwise valid upstream response.
    }
    try {
      const body = await fetchYahooChartJson(symbol, fetcher);
      const cached = new Response(body, { headers: {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=900",
      } });
      // Store no Origin, browser credentials, session cookie, or crumb in cache headers/keys.
      context.waitUntil(store.put(cacheKey, cached).catch(() => undefined));
      return finish(body, 200);
    } catch (error) {
      return fail(error instanceof YahooChartRequestError ? error.status : 502,
        error instanceof YahooChartRequestError ? error.message : "Unable to fetch valid Yahoo Finance daily data.");
    }
  };
}

export default { fetch: createYahooChartHandler() };
