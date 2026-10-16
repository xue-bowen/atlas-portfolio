import { calculateBalances } from "./calculateBalances";
import type { LedgerEvent } from "./ledger";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";

export interface EditField {
  key: string;
  label: string;
  kind: "number" | "text" | "select";
  allowZero?: boolean;
  options?: string[];
}

const symbol: EditField = { key: "symbol", label: "Symbol", kind: "text" };
const quantity: EditField = {
  key: "quantity",
  label: "Quantity",
  kind: "number",
};
const price: EditField = {
  key: "priceUsd",
  label: "Price (USD per share)",
  kind: "number",
};
const fee: EditField = {
  key: "feeUsd",
  label: "Fee (USD)",
  kind: "number",
  allowZero: true,
};
const cny: EditField = {
  key: "amountCny",
  label: "Amount (CNY)",
  kind: "number",
};
const usd: EditField = {
  key: "amountUsd",
  label: "Amount (USD)",
  kind: "number",
};

export function getLedgerEditFields(event: LedgerEvent): EditField[] {
  switch (event.type) {
    case "CNY_DEPOSIT":
    case "CNY_WITHDRAWAL":
      return [cny];
    case "FX_TO_USD":
    case "FX_TO_CNY":
      return [cny, usd];
    case "BUY":
    case "SELL":
      return [symbol, quantity, price, fee];
    case "IN_KIND_CONTRIBUTION":
      return [symbol, quantity, price];
    case "DIVIDEND":
      return [
        symbol,
        { key: "grossAmountUsd", label: "Gross amount (USD)", kind: "number" },
        {
          key: "withholdingTaxUsd",
          label: "Withholding tax (USD)",
          kind: "number",
          allowZero: true,
        },
      ];
    case "INTEREST":
      return "amountUsd" in event
        ? [usd]
        : [
            {
              key: "currency",
              label: "Currency",
              kind: "select",
              options: ["CNY", "HKD", "USD"],
            },
            {
              key: "amount",
              label: "Amount received after tax",
              kind: "number",
            },
          ];
    case "FEE":
      return [
        usd,
        {
          key: "category",
          label: "Expense category",
          kind: "select",
          options: ["COMMISSION", "ADR_FEE", "OTHER"],
        },
      ];
  }
}

export function ledgerEditValues(event: LedgerEvent): Record<string, string> {
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      value === undefined ? "" : String(value),
    ]),
  );
}

export function buildLedgerEdit(
  original: LedgerEvent,
  values: Record<string, string>,
): LedgerEvent {
  const date = values.occurredAt;
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "") ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    throw new Error("Enter a valid transaction date.");
  }
  const updated: Record<string, unknown> = {
    ...original,
    occurredAt: date,
    note: values.note?.trim() || undefined,
  };
  for (const field of getLedgerEditFields(original)) {
    const raw = values[field.key]?.trim() ?? "";
    if (field.kind === "number") {
      const number = Number(raw);
      if (
        !raw ||
        !Number.isFinite(number) ||
        (field.allowZero ? number < 0 : number <= 0)
      ) {
        throw new Error(`Enter a valid ${field.label.toLowerCase()}.`);
      }
      updated[field.key] = number;
    } else {
      if (!raw || (field.options && !field.options.includes(raw))) {
        throw new Error(`Enter a valid ${field.label.toLowerCase()}.`);
      }
      updated[field.key] = field.key === "symbol" ? raw.toUpperCase() : raw;
    }
  }
  if (
    original.type === "DIVIDEND" &&
    Number(updated.withholdingTaxUsd) > Number(updated.grossAmountUsd)
  ) {
    throw new Error("Withholding tax cannot exceed the gross dividend.");
  }
  // Only fields defined for this event type are editable; identity and metadata survive.
  return updated as unknown as LedgerEvent;
}

export function replaceLedgerEvent(
  events: readonly LedgerEvent[],
  replacement: LedgerEvent,
): LedgerEvent[] {
  const matches = events.filter((event) => event.id === replacement.id);
  if (matches.length !== 1)
    throw new Error("Select exactly one existing transaction to edit.");
  if (
    matches[0].type !== replacement.type ||
    matches[0].accountId !== replacement.accountId
  ) {
    throw new Error(
      "Transaction type and account cannot change during editing.",
    );
  }
  const validated = buildLedgerEdit(matches[0], ledgerEditValues(replacement));
  const ordered = sortLedgerEventsChronologically(
    events.map((event) => (event.id === replacement.id ? validated : event)),
  );
  // Validate the whole timeline before exposing a saveable preview.
  for (let index = 0; index < ordered.length; index += 1) {
    const result = calculateBalances(ordered.slice(0, index + 1));
    const cash = [result.cnyCash, result.hkdCash, result.usdCash];
    if (cash.some((balance) => balance < -1e-8)) {
      throw new Error(
        `Insufficient cash after ${ordered[index].type} on ${ordered[index].occurredAt}.`,
      );
    }
    if (
      ![
        ...cash,
        result.realizedPnlUsd,
        result.totalFeesUsd,
        ...result.positions.flatMap((position) => [
          position.quantity,
          position.costUsd,
        ]),
      ].every(Number.isFinite)
    )
      throw new Error("Transaction amounts are too large.");
  }
  return ordered;
}
