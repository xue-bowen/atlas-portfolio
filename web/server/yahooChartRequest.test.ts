import { describe, expect, it, vi } from "vitest";
import { buildYahooChartUpstreamUrl, fetchYahooChartJson, YAHOO_USER_AGENT } from "./yahooChartRequest";

describe("Yahoo daily chart request", () => {
  it("uses explicit epoch seconds and preserves daily events without a max range", () => {
    const now = Date.parse("2026-11-23T10:00:00.999Z");
    const url = buildYahooChartUpstreamUrl("IVV", now);
    expect(url.origin).toBe("https://query1.finance.yahoo.com");
    expect(url.pathname).toBe("/v8/finance/chart/IVV");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      period1: "0", period2: "1795428000", interval: "1d", events: "div,splits",
    });
  });
  it("rejects arbitrary paths and invalid clocks", () => {
    expect(() => buildYahooChartUpstreamUrl("../QQQ")).toThrow();
    expect(() => buildYahooChartUpstreamUrl("IVV", NaN)).toThrow();
  });
});

const chart = JSON.stringify({ chart: { result: [], error: null } });

describe("shared Yahoo upstream request", () => {
  it("identifies Atlas, uses one deadline, and refuses redirects instead of forwarding credentials", async () => {
    const upstream = vi.fn(async () => new Response(chart));
    expect(await fetchYahooChartJson("QQQ", upstream)).toBe(chart);
    expect(upstream).toHaveBeenCalledOnce();
    const [target, options] = upstream.mock.calls[0] as unknown as [URL, RequestInit];
    expect(target.origin).toBe("https://query1.finance.yahoo.com");
    expect(options).toMatchObject({ headers: { Accept: "application/json", "User-Agent": YAHOO_USER_AGENT }, redirect: "manual" });
    expect(new Headers(options.headers).has("Cookie")).toBe(false);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([401, 403])("retries HTTP %s once with a request-local A3 cookie and encoded crumb", async (status) => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("blocked", { status }))
      .mockResolvedValueOnce(new Response("not found", { status: 404, headers: {
        "Set-Cookie": "A3=anonymous-cookie; Path=/; Secure; HttpOnly",
      } }))
      .mockResolvedValueOnce(new Response("abc/+="))
      .mockResolvedValueOnce(new Response(chart));
    expect(await fetchYahooChartJson("IVV", upstream)).toBe(chart);
    expect(upstream).toHaveBeenCalledTimes(4);
    expect(String(upstream.mock.calls[1][0])).toBe("https://fc.yahoo.com/");
    expect(String(upstream.mock.calls[2][0])).toBe("https://query1.finance.yahoo.com/v1/test/getcrumb");
    const first = new URL(String(upstream.mock.calls[0][0]));
    const retried = new URL(String(upstream.mock.calls[3][0]));
    expect(first.searchParams.has("crumb")).toBe(false);
    expect(retried.searchParams.get("crumb")).toBe("abc/+=");
    expect(retried.searchParams.get("interval")).toBe("1d");
    expect(retried.searchParams.get("range")).toBeNull();
    for (const index of [2, 3]) {
      expect(new Headers(upstream.mock.calls[index][1]?.headers).get("Cookie")).toBe("A3=anonymous-cookie");
      expect(upstream.mock.calls[index][1]?.signal).toBe(upstream.mock.calls[0][1]?.signal);
    }
    // A new refresh starts without a previously obtained cookie or crumb.
    upstream.mockResolvedValueOnce(new Response(chart));
    await fetchYahooChartJson("IVV", upstream);
    expect(new Headers(upstream.mock.calls[4][1]?.headers).has("Cookie")).toBe(false);
    expect(new URL(String(upstream.mock.calls[4][0])).searchParams.has("crumb")).toBe(false);
  });

  it("stops after the single authenticated chart retry", async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(new Response("", { status: 404, headers: { "Set-Cookie": "A3=session; Secure" } }))
      .mockResolvedValueOnce(new Response("crumb"))
      .mockResolvedValueOnce(new Response("blocked", { status: 403 }));
    await expect(fetchYahooChartJson("IVV", upstream)).rejects.toMatchObject({ status: 403 });
    expect(upstream).toHaveBeenCalledTimes(4);
  });

  it("does not retry rate limits or follow upstream redirects", async () => {
    for (const status of [429, 302]) {
      const upstream = vi.fn(async () => new Response("", { status, headers: { Location: "https://example.com/" } }));
      await expect(fetchYahooChartJson("IVV", upstream)).rejects.toMatchObject({ status: status === 429 ? 429 : 502 });
      expect(upstream).toHaveBeenCalledOnce();
    }
  });

  it("rejects a missing anonymous cookie without exposing the upstream body", async () => {
    const upstream = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("blocked", { status: 401 }))
      .mockResolvedValueOnce(new Response("private session details", { status: 404 }));
    await expect(fetchYahooChartJson("IVV", upstream)).rejects.toMatchObject({ status: 401, message: "Yahoo Finance returned HTTP 401." });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it.each(["not JSON", "null", '{"chart":null}', '{"chart":{"error":{"description":"private"},"result":null}}'])(
    "rejects invalid chart JSON (%s)", async (body) => {
      await expect(fetchYahooChartJson("IVV", async () => new Response(body))).rejects.toMatchObject({ status: 502 });
    });

  it("limits actual UTF-8 bytes rather than JavaScript character count", async () => {
    const oversized = JSON.stringify({ chart: { result: [], note: "汉".repeat(2_700_000) } });
    expect(oversized.length).toBeLessThan(8_000_000);
    await expect(fetchYahooChartJson("IVV", async () => new Response(oversized))).rejects.toMatchObject({ status: 502 });
  });

  it("maps transport failure to a generic gateway error without leaking session details", async () => {
    await expect(fetchYahooChartJson("IVV", async () => { throw new Error("secret cookie"); }))
      .rejects.toMatchObject({ status: 502, message: "Unable to fetch valid Yahoo Finance daily data." });
  });
});
