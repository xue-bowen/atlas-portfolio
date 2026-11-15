import { parsePortfolioBackup } from "./ledgerStorage";
import type { LedgerEvent } from "../domain/ledger";

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

function csvRows(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let state: "START" | "PLAIN" | "QUOTED" | "AFTER_QUOTE" = "START";

  function finishField() {
    row.push(field);
    field = "";
    state = "START";
  }

  function finishRow() {
    finishField();
    rows.push(row);
    row = [];
  }

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === "QUOTED") {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          state = "AFTER_QUOTE";
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === ",") {
      finishField();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
    } else if (character === '"' && state === "START") {
      state = "QUOTED";
    } else if (state === "AFTER_QUOTE" && character !== " " && character !== "\t") {
      throw new Error(`Invalid CSV quoting near row ${rows.length + 1}.`);
    } else if (character === '"') {
      throw new Error(`Invalid CSV quoting near row ${rows.length + 1}.`);
    } else if (state !== "AFTER_QUOTE") {
      field += character;
      state = "PLAIN";
    }
  }

  if (state === "QUOTED") throw new Error("CSV has an unclosed quoted field.");
  if (row.length > 0 || field !== "" || state === "AFTER_QUOTE") finishRow();
  return rows;
}

export function parseLedgerCsv(source: string): LedgerEvent[] {
  const rows = csvRows(source);
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
