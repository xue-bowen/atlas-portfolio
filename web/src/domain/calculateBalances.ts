import type { LedgerEvent } from "./ledger";
import { sortLedgerEventsChronologically } from "./sortLedgerEvents";
import { isValidStockSplitRatio } from "./stockSplit";
import { isCalendarDate } from "./marketData";

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

export interface BalanceCalculationOptions {
  validateTimeline?: boolean;
}

export function calculateBalances(
  events: readonly LedgerEvent[],
  options: BalanceCalculationOptions = {},
): PortfolioBalances {
  let cnyCash = 0;
  let hkdCash = 0;
  let usdCash = 0;
  let realizedPnlUsd = 0;
  let totalFeesUsd = 0;

  const positions = new Map<string, PositionBalance>();
  const tradedDates = new Set<string>();
  const splitDates = new Set<string>();

  const orderedEvents = sortLedgerEventsChronologically(events);

  for (const event of orderedEvents) {
    if (event.type === "BUY" || event.type === "SELL" || event.type === "IN_KIND_CONTRIBUTION") {
      tradedDates.add(`${event.occurredAt}:${event.symbol}`);
    }
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

      case "STOCK_SPLIT": {
        if (!isCalendarDate(event.occurredAt)) throw new Error("Enter a valid split effective date.");
        if (!isValidStockSplitRatio(event.newShares, event.oldShares)) {
          throw new Error("Split ratio requires different positive whole numbers of new and old shares.");
        }
        const key = `${event.occurredAt}:${event.symbol}`;
        if (tradedDates.has(key)) throw new Error("A split must precede trades for that symbol on its effective date.");
        if (splitDates.has(key)) throw new Error("Only one split per symbol and effective date is supported.");
        splitDates.add(key);
        const position = positions.get(event.symbol);
        if (!position || position.quantity <= 0) {
          throw new Error(`Cannot split ${event.symbol} on ${event.occurredAt}: no position held.`);
        }
        const quantity = position.quantity * (event.newShares / event.oldShares);
        if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(position.costUsd / quantity)) {
          throw new Error("Split ratio produces an unsupported share quantity or average cost.");
        }
        position.quantity = quantity;
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

    if (options.validateTimeline) {
      const cashBalances = [
        ["CNY", cnyCash],
        ["HKD", hkdCash],
        ["USD", usdCash],
      ] as const;
      const insufficientCash = cashBalances.find(
        ([, balance]) => balance < -1e-8,
      );

      if (insufficientCash) {
        throw new Error(
          `Insufficient cash in ${insufficientCash[0]} after ${event.type} on ${event.occurredAt}.`,
        );
      }

      const affectedPosition =
        "symbol" in event ? positions.get(event.symbol) : undefined;
      const calculatedValues = [
        cnyCash,
        hkdCash,
        usdCash,
        realizedPnlUsd,
        totalFeesUsd,
        ...(affectedPosition
          ? [affectedPosition.quantity, affectedPosition.costUsd]
          : []),
      ];

      if (!calculatedValues.every(Number.isFinite)) {
        throw new Error(
          `Transaction amounts are too large after ${event.type} on ${event.occurredAt}.`,
        );
      }
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
