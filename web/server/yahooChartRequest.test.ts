import { describe, expect, it } from "vitest";
import { buildYahooChartUpstreamUrl } from "./yahooChartRequest";

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
