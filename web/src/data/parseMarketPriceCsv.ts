import {
  isCalendarDate,
  type SecurityIdentifier,
} from "../domain/marketData";
import { parseCsvRows } from "./parseCsvRows";

export interface ImportedMarketPrice {
  date: string;
  security: SecurityIdentifier;
  closeUsd: number;
  adjustedCloseUsd?: number;
}

const requiredColumns = ["date", "symbol", "exchange", "assetType", "closeUsd"];
const supportedColumns = new Set([...requiredColumns, "adjustedCloseUsd"]);

function positivePrice(value: string, rowNumber: number, column: string): number {
  const price = Number(value.trim());
  if (!value.trim() || !Number.isFinite(price) || price <= 0) {
    throw new Error(`Market-price CSV row ${rowNumber} has an invalid ${column}.`);
  }
  return price;
}

export function parseMarketPriceCsv(source: string): ImportedMarketPrice[] {
  const rows = parseCsvRows(source);
  const headers = rows.shift()?.map((header) => header.trim());
  if (!headers || rows.length === 0) {
    throw new Error("Market-price CSV needs a header and at least one daily close.");
  }
  if (new Set(headers).size !== headers.length || headers.some((header) => !supportedColumns.has(header))) {
    throw new Error("Market-price CSV has a duplicate or unsupported column name.");
  }
  if (requiredColumns.some((column) => !headers.includes(column))) {
    throw new Error("Market-price CSV needs date, symbol, exchange, assetType, and closeUsd columns.");
  }

  const seen = new Set<string>();
  return rows.map((values, index) => {
    const rowNumber = index + 2;
    if (values.length !== headers.length) {
      throw new Error(`Market-price CSV row ${rowNumber} has ${values.length} fields; expected ${headers.length}.`);
    }
    const record = Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
    const date = record.date;
    const symbol = record.symbol.toUpperCase();
    const exchange = record.exchange.toUpperCase();
    const assetType = record.assetType.toUpperCase();
    if (!isCalendarDate(date) || !symbol || !exchange || (assetType !== "STOCK" && assetType !== "ETF")) {
      throw new Error(`Market-price CSV row ${rowNumber} has an invalid date or security identifier.`);
    }
    const key = `${date}:${symbol}:${exchange}:${assetType}`;
    if (seen.has(key)) {
      throw new Error(`Market-price CSV row ${rowNumber} duplicates ${key}.`);
    }
    seen.add(key);

    return {
      date,
      security: { symbol, exchange, assetType, currency: "USD" as const },
      closeUsd: positivePrice(record.closeUsd, rowNumber, "closeUsd"),
      ...(record.adjustedCloseUsd
        ? { adjustedCloseUsd: positivePrice(record.adjustedCloseUsd, rowNumber, "adjustedCloseUsd") }
        : {}),
    };
  });
}
