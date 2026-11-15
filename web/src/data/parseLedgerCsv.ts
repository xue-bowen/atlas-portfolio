import { parsePortfolioBackup } from "./ledgerStorage";
import type { LedgerEvent } from "../domain/ledger";
import { parseCsvRows } from "./parseCsvRows";

const columns = new Set([
  "id", "occurredAt", "accountId", "type", "amountCny", "amountUsd",
  "symbol", "quantity", "priceUsd", "feeUsd", "grossAmountUsd",
  "withholdingTaxUsd", "currency", "amount", "category", "source", "note",
]);
const requiredColumns = ["id", "occurredAt", "accountId", "type"];
const numericColumns = new Set([
  "amountCny", "amountUsd", "quantity", "priceUsd", "feeUsd",
  "grossAmountUsd", "withholdingTaxUsd", "amount",
]);

export function parseLedgerCsv(source: string): LedgerEvent[] {
  const rows = parseCsvRows(source);
  const headers = rows.shift()?.map((header) => header.trim());
  if (!headers || rows.length === 0) {
    throw new Error("CSV needs a header and at least one transaction.");
  }
  if (new Set(headers).size !== headers.length || headers.some((header) => !columns.has(header))) {
    throw new Error("CSV has a duplicate or unsupported column name.");
  }
  if (requiredColumns.some((column) => !headers.includes(column))) {
    throw new Error("CSV needs id, occurredAt, accountId, and type columns.");
  }

  const events = rows.map((values, index) => {
    if (values.length !== headers.length) {
      throw new Error(`CSV row ${index + 2} has ${values.length} fields; expected ${headers.length}.`);
    }
    const event: Record<string, unknown> = {};
    headers.forEach((header, columnIndex) => {
      const value = values[columnIndex];
      if (value.trim() === "") return;
      if (numericColumns.has(header)) {
        const number = Number(value.trim());
        if (!Number.isFinite(number)) {
          throw new Error(`CSV row ${index + 2} has an invalid ${header}.`);
        }
        event[header] = number;
      } else {
        event[header] = value;
      }
    });
    return event;
  });

  return parsePortfolioBackup(JSON.stringify(events)).ledger;
}
