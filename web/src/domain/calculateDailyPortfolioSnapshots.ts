import { calculateBalances, type PortfolioBalances } from "./calculateBalances";
import { calculateCashValuation } from "./calculateCashValuation";
import {
  calculateHoldingsValuation,
  type PositionSecurityMapping,
} from "./calculateHoldingsValuation";
import { calculatePortfolioValuation } from "./calculatePortfolioValuation";
import type { LedgerEvent } from "./ledger";
import type { FxRate, SecurityQuote } from "./marketData";

export const DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION = 1;

export type ExternalFlowCategory =
  | "CASH_CONTRIBUTION"
  | "CASH_WITHDRAWAL"
  | "IN_KIND_CONTRIBUTION";

export interface ExternalFlowClassification {
  eventId: string;
  occurredAt: string;
  category: ExternalFlowCategory;
  direction: "CONTRIBUTION" | "WITHDRAWAL";
  nativeCurrency: "CNY" | "USD";
  nativeAmount: number;
}

export interface ValuedExternalFlow extends ExternalFlowClassification {
  valueCny: number;
}

export interface DailyPortfolioValuationInput {
  date: string;
  securityMappings: PositionSecurityMapping[];
  securityQuotes: SecurityQuote[];
  usdCnyRate?: FxRate;
  hkdCnyRate?: FxRate;
}

export interface DailyPortfolioSnapshot {
  date: string;
  calculationVersion: typeof DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION;
  balances: PortfolioBalances;
  cashValueCny: number;
  securitiesMarketValueUsd: number;
  securitiesMarketValueCny: number;
  navCny: number;
  externalFlows: ValuedExternalFlow[];
  externalCashContributionsCny: number;
  externalWithdrawalsCny: number;
  externalInKindContributionsCny: number;
  netExternalFlowCny: number;
  valuationInputs: {
    securityMappings: PositionSecurityMapping[];
    securityQuotes: SecurityQuote[];
    usdCnyRate?: FxRate;
    hkdCnyRate?: FxRate;
  };
}

function assertPositiveAmount(amount: number, label: string): void {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
}

function assertCalendarDate(value: string, label: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
}

function readFxRate(
  rate: FxRate | undefined,
  baseCurrency: "HKD" | "USD",
  snapshotDate: string,
): number | undefined {
  if (!rate) {
    return undefined;
  }

  if (
    rate.pair.baseCurrency !== baseCurrency ||
    rate.pair.quoteCurrency !== "CNY"
  ) {
    throw new Error(
      `${snapshotDate} requires a ${baseCurrency}/CNY valuation rate.`,
    );
  }

  assertPositiveAmount(rate.rate, `${baseCurrency}/CNY valuation rate`);
  return rate.rate;
}

export function classifyExternalFlow(
  event: LedgerEvent,
): ExternalFlowClassification | undefined {
  switch (event.type) {
    case "CNY_DEPOSIT":
      assertPositiveAmount(event.amountCny, "CNY deposit amount");
      return {
        eventId: event.id,
        occurredAt: event.occurredAt,
        category: "CASH_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "CNY",
        nativeAmount: event.amountCny,
      };

    case "CNY_WITHDRAWAL":
      assertPositiveAmount(event.amountCny, "CNY withdrawal amount");
      return {
        eventId: event.id,
        occurredAt: event.occurredAt,
        category: "CASH_WITHDRAWAL",
        direction: "WITHDRAWAL",
        nativeCurrency: "CNY",
        nativeAmount: event.amountCny,
      };

    case "IN_KIND_CONTRIBUTION": {
      assertPositiveAmount(event.quantity, "In-kind contribution quantity");
      assertPositiveAmount(event.priceUsd, "In-kind contribution price");
      return {
        eventId: event.id,
        occurredAt: event.occurredAt,
        category: "IN_KIND_CONTRIBUTION",
        direction: "CONTRIBUTION",
        nativeCurrency: "USD",
        nativeAmount: event.quantity * event.priceUsd,
      };
    }

    default:
      return undefined;
  }
}

function valueExternalFlows(
  events: readonly LedgerEvent[],
  usdCnyRate: number | undefined,
): ValuedExternalFlow[] {
  return events.flatMap((event) => {
    const flow = classifyExternalFlow(event);

    if (!flow) {
      return [];
    }

    if (flow.nativeCurrency === "USD" && usdCnyRate === undefined) {
      throw new Error(
        `${flow.occurredAt} requires a USD/CNY rate to value an in-kind contribution.`,
      );
    }

    return [
      {
        ...flow,
        valueCny:
          flow.nativeCurrency === "CNY"
            ? flow.nativeAmount
            : flow.nativeAmount * usdCnyRate!,
      },
    ];
  });
}

function sumFlowValues(
  flows: readonly ValuedExternalFlow[],
  category: ExternalFlowCategory,
): number {
  return flows.reduce(
    (total, flow) =>
      flow.category === category ? total + flow.valueCny : total,
    0,
  );
}

export function calculateDailyPortfolioSnapshots(
  events: readonly LedgerEvent[],
  valuationInputs: readonly DailyPortfolioValuationInput[],
): DailyPortfolioSnapshot[] {
  for (const event of events) {
    assertCalendarDate(event.occurredAt, `Ledger event ${event.id} date`);
  }

  const seenDates = new Set<string>();
  const orderedInputs = [...valuationInputs].sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  return orderedInputs.map((input) => {
    assertCalendarDate(input.date, "Snapshot date");

    if (seenDates.has(input.date)) {
      throw new Error(`Snapshot date ${input.date} appears more than once.`);
    }
    seenDates.add(input.date);

    const usdCnyRate = readFxRate(input.usdCnyRate, "USD", input.date);
    const hkdCnyRate = readFxRate(input.hkdCnyRate, "HKD", input.date);
    const eventsThroughDate = events.filter(
      (event) => event.occurredAt <= input.date,
    );
    const eventsOnDate = events.filter(
      (event) => event.occurredAt === input.date,
    );
    const balances = calculateBalances([...eventsThroughDate]);
    const cashValuation = calculateCashValuation({
      cnyCash: balances.cnyCash,
      hkdCash: balances.hkdCash,
      usdCash: balances.usdCash,
      hkdCnyRate,
      usdCnyRate,
    });
    const holdingsValuation = calculateHoldingsValuation(
      balances.positions,
      input.securityMappings,
      input.securityQuotes,
    );
    const portfolioValuation = calculatePortfolioValuation({
      cashValuation,
      holdingsValuation,
      usdCnyRate,
    });

    if (portfolioValuation.totalPortfolioValueCny === undefined) {
      throw new Error(
        `Cannot calculate a complete portfolio snapshot for ${input.date}: ${portfolioValuation.unavailableReasons.join(
          ", ",
        )}.`,
      );
    }

    const externalFlows = valueExternalFlows(eventsOnDate, usdCnyRate);
    const externalCashContributionsCny = sumFlowValues(
      externalFlows,
      "CASH_CONTRIBUTION",
    );
    const externalWithdrawalsCny = sumFlowValues(
      externalFlows,
      "CASH_WITHDRAWAL",
    );
    const externalInKindContributionsCny = sumFlowValues(
      externalFlows,
      "IN_KIND_CONTRIBUTION",
    );

    return {
      date: input.date,
      calculationVersion: DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION,
      balances,
      cashValueCny: portfolioValuation.totalCashValueCny!,
      securitiesMarketValueUsd:
        portfolioValuation.totalSecuritiesMarketValueUsd!,
      securitiesMarketValueCny:
        portfolioValuation.totalSecuritiesMarketValueCny!,
      navCny: portfolioValuation.totalPortfolioValueCny,
      externalFlows,
      externalCashContributionsCny,
      externalWithdrawalsCny,
      externalInKindContributionsCny,
      netExternalFlowCny:
        externalCashContributionsCny +
        externalInKindContributionsCny -
        externalWithdrawalsCny,
      valuationInputs: {
        securityMappings: [...input.securityMappings],
        securityQuotes: [...input.securityQuotes],
        usdCnyRate: input.usdCnyRate,
        hkdCnyRate: input.hkdCnyRate,
      },
    };
  });
}
