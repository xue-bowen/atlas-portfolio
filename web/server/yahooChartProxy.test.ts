import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createYahooChartMiddleware } from "./yahooChartProxy";

async function withBridge(upstream: typeof fetch, check: (base: string) => Promise<void>) {
  const middleware = createYahooChartMiddleware(upstream);
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  try {
    await check(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

describe("local Yahoo daily bridge", () => {
  it("uses a fixed upstream and forwards only a validated symbol, without browser credentials", async () => {
    const upstream = vi.fn(async () => new Response(JSON.stringify({ chart: { result: [] } })));
    await withBridge(upstream, async (base) => {
      const result = await fetch(`${base}/api/yahoo-chart?symbol=IVV`, { headers: { Cookie: "anonymous=1" } });
      expect(result.status).toBe(200);
      expect(result.headers.get("cache-control")).toBe("no-store");
    });
    const [url, options] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.origin).toBe("https://query1.finance.yahoo.com");
    expect(url.pathname).toBe("/v8/finance/chart/IVV");
    expect(url.searchParams.get("interval")).toBe("1d");
    expect(url.searchParams.get("events")).toBe("div,splits");
    expect(url.searchParams.get("range")).toBeNull();
    expect(url.searchParams.get("period1")).toBe("0");
    expect(Number(url.searchParams.get("period2"))).toBeGreaterThan(1_700_000_000);
    expect(options.headers).toEqual({ Accept: "application/json" });
  });

  it("rejects extra URLs, duplicate symbols, and non-GET requests before contacting Yahoo", async () => {
    const upstream = vi.fn();
    await withBridge(upstream, async (base) => {
      for (const path of ["?symbol=IVV&url=https://example.com", "?symbol=IVV&symbol=QQQ", "?symbol=../QQQ"]) {
        expect((await fetch(`${base}/api/yahoo-chart${path}`)).status).toBe(400);
      }
      expect((await fetch(`${base}/api/yahoo-chart?symbol=IVV`, { method: "POST" })).status).toBe(405);
      expect((await fetch(`${base}/unrelated`)).status).toBe(404);
    });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("surfaces a blocked upstream without returning its HTML or pretending a price exists", async () => {
    await withBridge(async () => new Response("<html>blocked</html>", { status: 403 }), async (base) => {
      const result = await fetch(`${base}/api/yahoo-chart?symbol=IVV`);
      expect(result.status).toBe(403);
      expect(await result.json()).toEqual({ error: "Yahoo Finance returned HTTP 403." });
    });
  });

  it("reports a gateway failure for invalid JSON", async () => {
    await withBridge(async () => new Response("not JSON"), async (base) => {
      expect((await fetch(`${base}/api/yahoo-chart?symbol=IVV`)).status).toBe(502);
    });
  });
});
