import type { LedgerEvent } from "./ledger";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";

export interface PositionBalance {
  symbol: string;
  quantity: number;
  costUsd: number;
}

export interface PortfolioBalances {
  cnyCash: number;
  hkdCash: number;
  usdCash: number;
  positions: PositionBalance[];
  realizedPnlUsd: number;
  totalFeesUsd: number;
}

export function calculateBalances(
  events: LedgerEvent[],
): PortfolioBalances {
  let cnyCash = 0;
  let hkdCash = 0;
  let usdCash = 0;
  let realizedPnlUsd = 0;
  let totalFeesUsd = 0;

  const positions = new Map<string, PositionBalance>();

  const orderedEvents = sortLedgerEventsChronologically(events);

  for (const event of orderedEvents) {
    switch (event.type) {
      case "CNY_DEPOSIT":
        cnyCash += event.amountCny;
        break;

      case "CNY_WITHDRAWAL":
        cnyCash -= event.amountCny;
        break;

      case "FX_TO_USD":
        cnyCash -= event.amountCny;
        usdCash += event.amountUsd;
        break;

      case "FX_TO_CNY":
        usdCash -= event.amountUsd;
        cnyCash += event.amountCny;
        break;

      case "BUY": {
        const tradeCost = event.quantity * event.priceUsd + event.feeUsd;
        usdCash -= tradeCost;
        totalFeesUsd += event.feeUsd;

        const position = positions.get(event.symbol) ?? {
          symbol: event.symbol,
          quantity: 0,
          costUsd: 0,
        };

        position.quantity += event.quantity;
        position.costUsd += tradeCost;
        positions.set(event.symbol, position);
        break;
      }

      case "IN_KIND_CONTRIBUTION": {
        const contributionValueUsd = event.quantity * event.priceUsd;
        const position = positions.get(event.symbol) ?? {
          symbol: event.symbol,
          quantity: 0,
          costUsd: 0,
        };

        position.quantity += event.quantity;
        position.costUsd += contributionValueUsd;
        positions.set(event.symbol, position);
        break;
      }

      case "SELL": {
        const position = positions.get(event.symbol);

        if (!position || position.quantity < event.quantity) {
          throw new Error(
            `Cannot sell ${event.quantity} ${event.symbol}: insufficient position.`,
          );
        }

        const averageCostUsd = position.costUsd / position.quantity;
        const soldCostUsd = averageCostUsd * event.quantity;
        const saleProceedsUsd = event.quantity * event.priceUsd - event.feeUsd;

        position.quantity -= event.quantity;
        position.costUsd -= soldCostUsd;
        usdCash += saleProceedsUsd;
        realizedPnlUsd += saleProceedsUsd - soldCostUsd;
        totalFeesUsd += event.feeUsd;

        if (position.quantity === 0) {
          positions.delete(event.symbol);
        } else {
          positions.set(event.symbol, position);
        }
        break;
      }

      case "DIVIDEND":
        usdCash += event.grossAmountUsd - event.withholdingTaxUsd;
        break;

      case "INTEREST":
        if ("amountUsd" in event) {
          usdCash += event.amountUsd;
        } else if (event.currency === "CNY") {
          cnyCash += event.amount;
        } else if (event.currency === "HKD") {
          hkdCash += event.amount;
        } else {
          usdCash += event.amount;
        }
        break;

      case "FEE":
        usdCash -= event.amountUsd;
        totalFeesUsd += event.amountUsd;
        break;
    }
  }

  return {
    cnyCash,
    hkdCash,
    usdCash,
    positions: [...positions.values()].sort((a, b) =>
      a.symbol.localeCompare(b.symbol),
    ),
    realizedPnlUsd,
    totalFeesUsd,
  };
}
