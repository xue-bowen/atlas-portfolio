import type { LedgerEvent } from "./ledger";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";

export interface UsdCashTransaction {
  id: string;
  occurredAt: string;
  eventType: LedgerEvent["type"];
  description: string;
  inflowUsd: number;
  outflowUsd: number;
  balanceUsd: number;
}

interface UsdCashMovement {
  amountUsd: number;
  description: string;
}

function getUsdCashMovement(
  event: LedgerEvent,
): UsdCashMovement | undefined {
  switch (event.type) {
    case "FX_TO_USD":
      return {
        amountUsd: event.amountUsd,
        description: "CNY converted to USD",
      };

    case "FX_TO_CNY":
      return {
        amountUsd: -event.amountUsd,
        description: "USD converted to CNY",
      };

    case "BUY":
      return {
        amountUsd: -(event.quantity * event.priceUsd + event.feeUsd),
        description: `Buy ${event.quantity} ${event.symbol}`,
      };

    case "SELL":
      return {
        amountUsd: event.quantity * event.priceUsd - event.feeUsd,
        description: `Sell ${event.quantity} ${event.symbol}`,
      };

    case "DIVIDEND":
      return {
        amountUsd: event.grossAmountUsd - event.withholdingTaxUsd,
        description: `${event.symbol} dividend received after tax`,
      };

    case "INTEREST":
      if ("amountUsd" in event) {
        return {
          amountUsd: event.amountUsd,
          description: "USD interest received after tax",
        };
      }

      return event.currency === "USD"
        ? {
            amountUsd: event.amount,
            description: "USD interest received after tax",
          }
        : undefined;

    case "FEE":
      return {
        amountUsd: -event.amountUsd,
        description:
          event.category === "ADR_FEE"
            ? "ADR custody fee"
            : event.category === "COMMISSION"
              ? "Commission"
              : "Other USD expense",
      };

    case "CNY_DEPOSIT":
    case "CNY_WITHDRAWAL":
    case "IN_KIND_CONTRIBUTION":
    case "STOCK_SPLIT":
      return undefined;
  }
}

export function calculateUsdCashHistory(
  events: LedgerEvent[],
): UsdCashTransaction[] {
  let balanceUsd = 0;

  return sortLedgerEventsChronologically(events)
    .flatMap((event) => {
      const movement = getUsdCashMovement(event);

      if (!movement) {
        return [];
      }

      balanceUsd += movement.amountUsd;

      return [
        {
          id: event.id,
          occurredAt: event.occurredAt,
          eventType: event.type,
          description: movement.description,
          inflowUsd: Math.max(movement.amountUsd, 0),
          outflowUsd: Math.max(-movement.amountUsd, 0),
          balanceUsd,
        },
      ];
    });
}
