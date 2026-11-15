import { describe, expect, it } from "vitest";
import { parseMarketPriceCsv } from "./parseMarketPriceCsv";

const header = "date,symbol,exchange,assetType,closeUsd,adjustedCloseUsd";

describe("parseMarketPriceCsv", () => {
  it("accepts out-of-order daily closes and optional adjusted prices", () => {
    expect(parseMarketPriceCsv(`${header}\n2026-01-06,QQQ,NASDAQ,ETF,520.25,519.75\n2026-01-02,IVV,NYSE ARCA,ETF,600.5,\n`)).toEqual([
      {
        date: "2026-01-06",
        security: { symbol: "QQQ", exchange: "NASDAQ", assetType: "ETF", currency: "USD" },
        closeUsd: 520.25,
        adjustedCloseUsd: 519.75,
      },
      {
        date: "2026-01-02",
        security: { symbol: "IVV", exchange: "NYSE ARCA", assetType: "ETF", currency: "USD" },
        closeUsd: 600.5,
      },
    ]);
  });

  it("rejects duplicate observations and invalid prices without changing stored data", () => {
    expect(() => parseMarketPriceCsv(`${header}\n2026-01-02,IVV,NYSE ARCA,ETF,600,599\n2026-01-02,ivv,NYSE ARCA,ETF,601,600`)).toThrow(/duplicates/);
    expect(() => parseMarketPriceCsv(`${header}\n2026-01-02,IVV,NYSE ARCA,ETF,0,599`)).toThrow(/closeUsd/);
    expect(() => parseMarketPriceCsv(`${header}\n2026-02-30,IVV,NYSE ARCA,ETF,600,599`)).toThrow(/invalid date/);
  });

  it("handles BOM, CRLF, and quoted fields", () => {
    expect(parseMarketPriceCsv(`\uFEFF${header}\r\n2026-01-02,IVV,"NYSE ARCA",ETF,600,599\r\n`)[0].security.exchange).toBe("NYSE ARCA");
  });
});
