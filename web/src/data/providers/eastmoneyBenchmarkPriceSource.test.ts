import { describe, expect, it, vi } from "vitest";
import type { SecurityIdentifier } from "../../domain/marketData";
import { EastmoneyBenchmarkPriceSource } from "./eastmoneyBenchmarkPriceSource";
import { loadBenchmarkAdjustedReturns } from "../loadBenchmarkAdjustedReturns";

const ivv: SecurityIdentifier = { symbol: "IVV", exchange: "NYSE ARCA", currency: "USD", assetType: "ETF" };
const now = () => new Date("2026-01-08T22:00:00Z");
function anonymousSeries(symbol = "IVV") {
  return { rc: 0, data: { code: symbol, market: symbol === "QQQ" ? 105 : 107,
    klines: symbol === "QQQ" ? ["2026-01-02,200,180", "2026-01-06,200,171"]
      : ["2026-01-02,100,90", "2026-01-06,100,99"] } };
}

describe("Eastmoney adjusted benchmark prices", () => {
  it("shares one forward-adjusted request across both dates and carries weekends backward", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify(anonymousSeries())));
    const source = new EastmoneyBenchmarkPriceSource("2026-01-04", "2026-01-07", fetcher, now);
    const [start, end] = await Promise.all([
      source.getLatestOnOrBefore(ivv, "2026-01-04"),
      source.getLatestOnOrBefore(ivv, "2026-01-07"),
    ]);
    expect(start).toMatchObject({ date: "2026-01-02", adjustedCloseUsd: 90 });
    expect(end).toMatchObject({ date: "2026-01-06", adjustedCloseUsd: 99 });
    expect(start).not.toHaveProperty("closeUsd");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetcher.mock.calls as unknown[][])[0][0]));
    expect(url.searchParams.get("fqt")).toBe("1");
    expect(url.searchParams.get("klt")).toBe("101");
    expect(url.searchParams.get("secid")).toBe("107.IVV");
    expect(url.searchParams.get("end")).toBe("20260107");
  });

  it("computes adjusted returns after an unavailable earlier automatic provider", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const symbol = new URL(String(input)).searchParams.get("secid")!.split(".")[1];
      return new Response(JSON.stringify(anonymousSeries(symbol)));
    });
    const eastmoney = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-01-07", fetcher, now);
    const results = await loadBenchmarkAdjustedReturns("2026-01-02", "2026-01-07", {
      async getLatestOnOrBefore() { return undefined; },
    }, [
      { label: "Anonymous blocked provider", async getLatestOnOrBefore() { throw new Error("HTTP 403"); } },
      eastmoney,
    ]);
    expect(results).toMatchObject([
      { status: "READY", symbol: "IVV", source: eastmoney.label },
      { status: "READY", symbol: "QQQ", source: eastmoney.label },
    ]);
    if (results[0].status !== "READY" || results[1].status !== "READY") throw new Error("Both benchmarks should be ready.");
    expect(results[0].adjustedReturn).toBeCloseTo(0.1);
    expect(results[1].adjustedReturn).toBeCloseTo(-0.05);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("caps the range before today's unfinished US session, including the closing delay", async () => {
    for (const [clock, expectedEnd] of [["2026-01-06T20:00:00Z", "20260105"],
      ["2026-01-06T21:10:00Z", "20260105"], ["2026-01-06T21:20:00Z", "20260106"]]) {
      const fetcher = vi.fn(async (input: RequestInfo | URL) => {
        expect(new URL(String(input)).searchParams.get("end")).toBe(expectedEnd);
        const body = anonymousSeries();
        if (expectedEnd === "20260105") body.data.klines.pop();
        return new Response(JSON.stringify(body));
      });
      const source = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-01-07", fetcher, () => new Date(clock));
      const result = await source.getLatestOnOrBefore(ivv, "2026-01-07");
      expect(result?.date).toBe(expectedEnd === "20260105" ? "2026-01-02" : "2026-01-06");
    }
  });

  it.each(["symbol", "market", "duplicate", "future", "price", "date", "unordered"])("rejects an invalid %s response", async (kind) => {
    const body = anonymousSeries();
    if (kind === "symbol") body.data.code = "WRONG";
    if (kind === "market") body.data.market = 105;
    if (kind === "duplicate") body.data.klines[1] = body.data.klines[0];
    if (kind === "future") body.data.klines[1] = "2026-01-08,100,99";
    if (kind === "price") body.data.klines[1] = "2026-01-06,100,0";
    if (kind === "date") body.data.klines[1] = "2026-02-30,100,99";
    if (kind === "unordered") body.data.klines.reverse();
    const source = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-01-07", async () => new Response(JSON.stringify(body)), now);
    await expect(source.getLatestOnOrBefore(ivv, "2026-01-07")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a truncated or old ending series rather than claiming full-period coverage", async () => {
    const source = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-03-07", async () => new Response(JSON.stringify(anonymousSeries())), () => new Date("2026-03-08T22:00:00Z"));
    await expect(source.getLatestOnOrBefore(ivv, "2026-03-07")).rejects.toMatchObject({ code: "NOT_SUPPORTED", message: expect.stringMatching(/cover/) });
  });

  it("does not substitute a future close when the start is outside the available history", async () => {
    const body = anonymousSeries();
    body.data.klines.shift();
    const source = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-01-07", async () => new Response(JSON.stringify(body)), now);
    expect(await source.getLatestOnOrBefore(ivv, "2026-01-02")).toBeUndefined();
  });

  it("keeps one typed failure per calculation batch without retrying every date", async () => {
    const fetcher = vi.fn(async () => new Response("busy", { status: 429 }));
    const source = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-01-07", fetcher, now);
    const requests = ["2026-01-02", "2026-01-07"].map((date) => source.getLatestOnOrBefore(ivv, date));
    expect((await Promise.allSettled(requests)).every((result) => result.status === "rejected")).toBe(true);
    await expect(source.getLatestOnOrBefore(ivv, "2026-01-07")).rejects.toMatchObject({ code: "RATE_LIMITED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid periods, dates, and other securities without network calls", async () => {
    const fetcher = vi.fn();
    expect(() => new EastmoneyBenchmarkPriceSource("2026-02-30", "2026-03-07", fetcher, now)).toThrow(/ordered/);
    const source = new EastmoneyBenchmarkPriceSource("2026-01-02", "2026-01-07", fetcher, now);
    await expect(source.getLatestOnOrBefore(ivv, "2026-01-08")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    await expect(source.getLatestOnOrBefore({ ...ivv, symbol: "OTHER" }, "2026-01-07")).rejects.toMatchObject({ code: "NOT_SUPPORTED" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
