// web/src/domain/calculateBalances.ts

import type { LedgerEvent } from "./ledger";

export interface PositionBalance {
  symbol: string;
  quantity: number;
  costUsd: number;
}

export interface PortfolioBalances {
  cnyCash: number;
  usdCash: number;
  positions: PositionBalance[];
}

export function calculateBalances(
  events: LedgerEvent[],
): PortfolioBalances {
  let cnyCash = 0;
  let usdCash = 0;

  const positions = new Map<string, PositionBalance>();

  const orderedEvents = [...events].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt),
  );

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

      case "SELL": {
        const position = positions.get(event.symbol);

        if (!position || position.quantity < event.quantity) {
          throw new Error(
            `Cannot sell ${event.quantity} ${event.symbol}: insufficient position.`,
          );
        }

        const averageCostUsd = position.costUsd / position.quantity;
        position.quantity -= event.quantity;
        position.costUsd -= averageCostUsd * event.quantity;

        usdCash += event.quantity * event.priceUsd - event.feeUsd;

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
        usdCash += event.amountUsd;
        break;

      case "FEE":
        usdCash -= event.amountUsd;
        break;
    }
  }

  return {
    cnyCash,
    usdCash,
    positions: [...positions.values()].sort((a, b) =>
      a.symbol.localeCompare(b.symbol),
    ),
  };
}