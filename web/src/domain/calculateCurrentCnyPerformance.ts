import {
  calculateCnyXirrFromCashFlows,
  type CnyXirrCashFlow,
} from "./calculateCnyXirr";
import type { LedgerEvent } from "./ledger";

export type CurrentCnyPerformanceUnavailableReason =
  | "NAV_UNAVAILABLE"
  | "IN_KIND_CONTRIBUTION_VALUE_UNAVAILABLE"
  | "XIRR_UNAVAILABLE";

export interface InKindContributionCnyValue {
  eventId: string;
  valueCny: number;
}

export interface CurrentCnyPerformanceSummary {
  asOfDate: string;
  navCny?: number;
  cumulativeExternalCashContributionsCny: number;
  cumulativeExternalWithdrawalsCny: number;
  cumulativeExternalInKindContributionsCny?: number;
  cumulativeNetContributionsCny?: number;
  totalPnlCny?: number;
  xirrAnnualRate?: number;
  unavailableReasons: CurrentCnyPerformanceUnavailableReason[];
}

interface CurrentCnyPerformanceInput {
  events: readonly LedgerEvent[];
  asOfDate: string;
  navCny?: number;
  inKindContributionValuesCny?: readonly InKindContributionCnyValue[];
}

interface DailyExternalFlowTotals {
  cashContributionsCny: number;
  withdrawalsCny: number;
  inKindContributionsCny: number;
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

function createDailyTotals(): DailyExternalFlowTotals {
  return {
    cashContributionsCny: 0,
    withdrawalsCny: 0,
    inKindContributionsCny: 0,
  };
}

export function calculateCurrentCnyPerformance(
  input: CurrentCnyPerformanceInput,
): CurrentCnyPerformanceSummary {
  assertCalendarDate(input.asOfDate, "Performance as-of date");

  if (
    input.navCny !== undefined &&
    (!Number.isFinite(input.navCny) || input.navCny < 0)
  ) {
    throw new Error("Current CNY NAV must be a non-negative number.");
  }

  const inKindEvents = input.events.filter(
    (event) => event.type === "IN_KIND_CONTRIBUTION",
  );
  const inKindEventIds = new Set(inKindEvents.map((event) => event.id));
  const inKindValues = new Map<string, number>();

  for (const value of input.inKindContributionValuesCny ?? []) {
    if (!inKindEventIds.has(value.eventId)) {
      throw new Error(
        `In-kind contribution value references unknown event ${value.eventId}.`,
      );
    }
    if (inKindValues.has(value.eventId)) {
      throw new Error(
        `In-kind contribution value for ${value.eventId} appears more than once.`,
      );
    }
    if (!Number.isFinite(value.valueCny) || value.valueCny <= 0) {
      throw new Error(
        `In-kind contribution value for ${value.eventId} must be positive.`,
      );
    }

    inKindValues.set(value.eventId, value.valueCny);
  }

  const totalsByDate = new Map<string, DailyExternalFlowTotals>();
  let cumulativeExternalCashContributionsCny = 0;
  let cumulativeExternalWithdrawalsCny = 0;
  let missingInKindContributionValue = false;

  for (const event of input.events) {
    if (
      event.type !== "CNY_DEPOSIT" &&
      event.type !== "CNY_WITHDRAWAL" &&
      event.type !== "IN_KIND_CONTRIBUTION"
    ) {
      continue;
    }

    assertCalendarDate(event.occurredAt, `Ledger event ${event.id} date`);

    if (event.occurredAt > input.asOfDate) {
      throw new Error(
        `Performance as-of date ${input.asOfDate} is earlier than external flow ${event.id}.`,
      );
    }

    const totals = totalsByDate.get(event.occurredAt) ?? createDailyTotals();
    totalsByDate.set(event.occurredAt, totals);

    if (event.type === "CNY_DEPOSIT") {
      totals.cashContributionsCny += event.amountCny;
      cumulativeExternalCashContributionsCny += event.amountCny;
    } else if (event.type === "CNY_WITHDRAWAL") {
      totals.withdrawalsCny += event.amountCny;
      cumulativeExternalWithdrawalsCny += event.amountCny;
    } else {
      const valueCny = inKindValues.get(event.id);

      if (valueCny === undefined) {
        missingInKindContributionValue = true;
      } else {
        totals.inKindContributionsCny += valueCny;
      }
    }
  }

  const unavailableReasons: CurrentCnyPerformanceUnavailableReason[] = [];

  if (input.navCny === undefined) {
    unavailableReasons.push("NAV_UNAVAILABLE");
  }

  if (missingInKindContributionValue) {
    unavailableReasons.push("IN_KIND_CONTRIBUTION_VALUE_UNAVAILABLE");
  }

  if (missingInKindContributionValue) {
    unavailableReasons.push("XIRR_UNAVAILABLE");
    return {
      asOfDate: input.asOfDate,
      navCny: input.navCny,
      cumulativeExternalCashContributionsCny,
      cumulativeExternalWithdrawalsCny,
      unavailableReasons,
    };
  }

  const cumulativeExternalInKindContributionsCny = [...totalsByDate.values()]
    .reduce(
      (total, totals) => total + totals.inKindContributionsCny,
      0,
    );
  const cumulativeNetContributionsCny =
    cumulativeExternalCashContributionsCny +
    cumulativeExternalInKindContributionsCny -
    cumulativeExternalWithdrawalsCny;
  const totalPnlCny =
    input.navCny === undefined
      ? undefined
      : input.navCny - cumulativeNetContributionsCny;

  if (
    ![
      cumulativeExternalCashContributionsCny,
      cumulativeExternalWithdrawalsCny,
      cumulativeExternalInKindContributionsCny,
      cumulativeNetContributionsCny,
      ...(totalPnlCny === undefined ? [] : [totalPnlCny]),
    ].every(Number.isFinite)
  ) {
    throw new Error("Current CNY performance values are too large.");
  }

  let xirrAnnualRate: number | undefined;

  if (input.navCny !== undefined) {
    const cashFlows: CnyXirrCashFlow[] = [...totalsByDate.entries()]
      .sort(([leftDate], [rightDate]) => leftDate.localeCompare(rightDate))
      .flatMap(([date, totals]) => {
        const amountCny =
          totals.withdrawalsCny -
          totals.cashContributionsCny -
          totals.inKindContributionsCny;

        return amountCny === 0
          ? []
          : [{ date, amountCny, source: "EXTERNAL_FLOW" as const }];
      });
    cashFlows.push({
      date: input.asOfDate,
      amountCny: input.navCny,
      source: "ENDING_NAV",
    });

    try {
      xirrAnnualRate = calculateCnyXirrFromCashFlows(cashFlows).annualRate;
    } catch {
      unavailableReasons.push("XIRR_UNAVAILABLE");
    }
  } else {
    unavailableReasons.push("XIRR_UNAVAILABLE");
  }

  return {
    asOfDate: input.asOfDate,
    navCny: input.navCny,
    cumulativeExternalCashContributionsCny,
    cumulativeExternalWithdrawalsCny,
    cumulativeExternalInKindContributionsCny,
    cumulativeNetContributionsCny,
    totalPnlCny,
    xirrAnnualRate,
    unavailableReasons,
  };
}
