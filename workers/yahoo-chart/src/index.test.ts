import { describe, expect, it, vi } from "vitest";
import { createYahooChartHandler, type BridgeCache, type Env } from "./index";

const origin = "https://xue-bowen.github.io";
const chart = JSON.stringify({ chart: { result: [], error: null } });

function setup(fetcher: typeof fetch = async () => new Response(chart)) {
  let clock = Date.parse("2026-11-23T12:00:00Z");
  const entries = new Map<string, { response: Response; expires: number }>();
  const cache: BridgeCache = {
    async match(key) {
      const entry = entries.get(key.url);
      return entry && entry.expires > clock ? entry.response.clone() : undefined;
    },
    async put(key, response) {
      entries.set(key.url, { response: response.clone(), expires: clock + 900_000 });
    },
  };
  const tasks: Promise<unknown>[] = [];
  const context = { waitUntil(task: Promise<unknown>) { tasks.push(task); } };
  const limiter = vi.fn(async () => ({ success: true }));
  const env: Env = { ALLOWED_ORIGINS: `${origin},https://atlas.example`, YAHOO_RATE_LIMIT: { limit: limiter } };
  const handle = createYahooChartHandler({ fetcher, cache, now: () => clock });
  const request = (path = "?symbol=IVV", options: RequestInit = {}) => {
    const headers = new Headers({ Origin: origin, "CF-Connecting-IP": "192.0.2.1" });
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
    return handle(new Request(`https://bridge.example/api/yahoo-chart${path}`, {
      ...options, headers,
    }), env, context);
  };
  return { handle, request, env, limiter, entries, cache, context,
    advance(ms: number) { clock += ms; }, async flush() { await Promise.all(tasks); } };
}

describe("Yahoo Cloudflare bridge", () => {
  it("echoes only approved origins, including loopback preview ports", async () => {
    const upstream = vi.fn(async () => new Response(chart));
    const bridge = setup(upstream);
    for (const allowed of [origin, "https://atlas.example", "http://localhost:5293", "http://127.0.0.1:5294"]) {
      const response = await bridge.request("?symbol=IVV", { headers: { Origin: allowed } });
      expect(response.status).toBe(200);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(allowed);
      expect(response.headers.get("Vary")).toBe("Origin");
      expect(response.headers.has("Access-Control-Allow-Credentials")).toBe(false);
      await bridge.flush();
    }
    for (const denied of ["https://evil.example", "http://localhost.evil.example", "null", "", `${origin}/fake`]) {
      const response = await bridge.request("?symbol=IVV", { headers: { Origin: denied } });
      expect(response.status).toBe(403);
      expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    }
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("handles preflight without fetching, and rejects unsupported methods/headers", async () => {
    const upstream = vi.fn();
    const bridge = setup(upstream);
    const preflight = await bridge.request("?symbol=IVV", { method: "OPTIONS", headers: {
      "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "accept",
    } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    for (const options of [
      { method: "POST" }, { method: "OPTIONS", headers: { "Access-Control-Request-Method": "POST" } },
    ]) {
      const response = await bridge.request("?symbol=IVV", options);
      expect(response.status).toBe(405);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
    expect((await bridge.request("", { method: "OPTIONS", headers: { "Access-Control-Request-Headers": "Authorization" } })).status).toBe(400);
    expect((await bridge.request("", { method: "OPTIONS", headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
    expect(bridge.limiter).not.toHaveBeenCalled();
  });

  it("rejects invalid paths, extra parameters, duplicate symbols, and optional symbol restrictions", async () => {
    const upstream = vi.fn();
    const bridge = setup(upstream);
    for (const path of ["", "?symbol=../QQQ", "?symbol=IVV&symbol=QQQ", "?symbol=IVV&url=https://evil.example", "?symbol=IVV&crumb=secret"]) {
      const response = await bridge.request(path);
      expect(response.status).toBe(400);
      expect(response.headers.get("Access-Control-Allow-Origin")).toBe(origin);
    }
    expect((await bridge.handle(new Request("https://bridge.example/wrong", { headers: { Origin: origin } }), bridge.env, bridge.context)).status).toBe(400);
    bridge.env.SYMBOL_ALLOWLIST = "IVV, QQQ";
    expect((await bridge.request("?symbol=MSFT")).status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("drops browser cookies and authorization, fixes the upstream host and daily parameters", async () => {
    const upstream = vi.fn(async () => new Response(chart, { headers: { "Set-Cookie": "private=upstream" } }));
    const bridge = setup(upstream);
    const result = await bridge.request("?symbol=IVV", { headers: { Cookie: "real-browser=secret", Authorization: "private" } });
    expect(result.status).toBe(200);
    expect(result.headers.has("Set-Cookie")).toBe(false);
    const [target, options] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(target.origin).toBe("https://query1.finance.yahoo.com");
    expect(target.pathname).toBe("/v8/finance/chart/IVV");
    expect(target.searchParams.get("period1")).toBe("0");
    expect(target.searchParams.get("interval")).toBe("1d");
    expect(target.searchParams.has("range")).toBe(false);
    const headers = new Headers(options.headers);
    expect(headers.has("Cookie")).toBe(false);
    expect(headers.has("Authorization")).toBe(false);
    expect(headers.get("User-Agent")).toContain("AtlasPortfolio");
    await bridge.flush();
    expect([...bridge.entries.values()][0].response.headers.has("Set-Cookie")).toBe(false);
  });

  it.each([401, 403])("completes one anonymous session retry after upstream HTTP %s", async (status) => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("blocked", { status }))
      .mockResolvedValueOnce(new Response("", { status: 404, headers: { "Set-Cookie": "A3=anonymous; Secure" } }))
      .mockResolvedValueOnce(new Response("anonymous-crumb"))
      .mockResolvedValueOnce(new Response(chart));
    const bridge = setup(upstream);
    const result = await bridge.request();
    expect(result.status).toBe(200);
    expect(await result.text()).toBe(chart);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(upstream.mock.calls.map(([url]) => new URL(String(url)).hostname)).toEqual([
      "query1.finance.yahoo.com", "fc.yahoo.com", "query1.finance.yahoo.com", "query1.finance.yahoo.com",
    ]);
    await bridge.flush();
    expect([...bridge.entries.keys()][0]).not.toContain("crumb");
  });

  it("caches a successful body for fifteen minutes and reapplies CORS on hits", async () => {
    const upstream = vi.fn(async () => new Response(chart));
    const bridge = setup(upstream);
    await bridge.request(); await bridge.flush();
    const [key, entry] = [...bridge.entries][0];
    expect(key).toBe("https://bridge.example/api/yahoo-chart?symbol=IVV&date=2026-11-23");
    expect(entry.response.headers.get("Cache-Control")).toBe("public, max-age=900");
    expect(entry.response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    bridge.advance(899_000);
    const hit = await bridge.request("?symbol=IVV", { headers: { Origin: "https://atlas.example" } });
    expect(hit.headers.get("Access-Control-Allow-Origin")).toBe("https://atlas.example");
    expect(hit.headers.get("Cache-Control")).toBe("no-store");
    expect(upstream).toHaveBeenCalledOnce();
    bridge.advance(1_001);
    await bridge.request(); await bridge.flush();
    expect(upstream).toHaveBeenCalledTimes(2);
    await bridge.request("?symbol=QQQ"); await bridge.flush();
    expect(upstream).toHaveBeenCalledTimes(3);
    bridge.advance(86_400_000);
    await bridge.request();
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("does not cache errors, loop on 429, or disclose invalid upstream bodies", async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("not JSON"))
      .mockResolvedValueOnce(new Response("slow down", { status: 429 }))
      .mockResolvedValueOnce(new Response(chart));
    const bridge = setup(upstream);
    expect((await bridge.request()).status).toBe(502);
    expect((await bridge.request()).status).toBe(429);
    await bridge.flush();
    expect(bridge.entries.size).toBe(0);
    expect((await bridge.request()).status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(3);
  });

  it("limits by trusted IP even for cache hits, and fails closed if the binding fails", async () => {
    const upstream = vi.fn(async () => new Response(chart));
    const bridge = setup(upstream);
    await bridge.request(); await bridge.flush();
    bridge.limiter.mockResolvedValueOnce({ success: false });
    const denied = await bridge.request("?symbol=IVV", { headers: { "X-Forwarded-For": "198.51.100.9" } });
    expect(denied.status).toBe(429);
    expect(denied.headers.get("Retry-After")).toBe("60");
    expect(bridge.limiter).toHaveBeenLastCalledWith({ key: "yahoo-chart:192.0.2.1" });
    expect(upstream).toHaveBeenCalledOnce();
    bridge.limiter.mockRejectedValueOnce(new Error("limiter down"));
    expect((await bridge.request()).status).toBe(503);
  });

  it("still serves a valid response if the cache is unavailable", async () => {
    const bridge = setup();
    bridge.cache.match = async () => { throw new Error("cache down"); };
    bridge.cache.put = async () => { throw new Error("cache down"); };
    expect((await bridge.request()).status).toBe(200);
    await bridge.flush();
  });
});
