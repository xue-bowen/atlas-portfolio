import {
  DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION,
  type DailyPortfolioSnapshot,
} from "./calculateDailyPortfolioSnapshots";

export type CnyPerformanceSnapshotInput = Pick<
  DailyPortfolioSnapshot,
  | "date"
  | "calculationVersion"
  | "navCny"
  | "externalCashContributionsCny"
  | "externalWithdrawalsCny"
  | "externalInKindContributionsCny"
  | "netExternalFlowCny"
>;

export interface CnyPerformancePoint {
  date: string;
  navCny: number;
  externalCashContributionsCny: number;
  externalWithdrawalsCny: number;
  externalInKindContributionsCny: number;
  netExternalFlowCny: number;
  cumulativeExternalCashContributionsCny: number;
  cumulativeExternalWithdrawalsCny: number;
  cumulativeExternalInKindContributionsCny: number;
  cumulativeNetContributionsCny: number;
  totalPnlCny: number;
}

function assertCalendarDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    throw new Error(`Performance snapshot date ${value} is invalid.`);
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
    throw new Error(`Performance snapshot date ${value} is invalid.`);
  }
}

function assertNonNegative(value: number, label: string, date: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} for ${date} must be a non-negative number.`);
  }
}

function nearlyEqual(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

export function calculateCnyPerformanceSeries(
  snapshots: readonly CnyPerformanceSnapshotInput[],
): CnyPerformancePoint[] {
  const orderedSnapshots = [...snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const seenDates = new Set<string>();
  let cumulativeExternalCashContributionsCny = 0;
  let cumulativeExternalWithdrawalsCny = 0;
  let cumulativeExternalInKindContributionsCny = 0;

  return orderedSnapshots.map((snapshot) => {
    assertCalendarDate(snapshot.date);

    if (seenDates.has(snapshot.date)) {
      throw new Error(
        `Performance snapshot date ${snapshot.date} appears more than once.`,
      );
    }
    seenDates.add(snapshot.date);

    if (
      snapshot.calculationVersion !==
      DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION
    ) {
      throw new Error(
        `Performance snapshot ${snapshot.date} uses unsupported calculation version ${snapshot.calculationVersion}.`,
      );
    }

    assertNonNegative(snapshot.navCny, "CNY NAV", snapshot.date);
    assertNonNegative(
      snapshot.externalCashContributionsCny,
      "External cash contributions",
      snapshot.date,
    );
    assertNonNegative(
      snapshot.externalWithdrawalsCny,
      "External withdrawals",
      snapshot.date,
    );
    assertNonNegative(
      snapshot.externalInKindContributionsCny,
      "External in-kind contributions",
      snapshot.date,
    );

    const expectedNetExternalFlowCny =
      snapshot.externalCashContributionsCny +
      snapshot.externalInKindContributionsCny -
      snapshot.externalWithdrawalsCny;

    if (
      !Number.isFinite(snapshot.netExternalFlowCny) ||
      !nearlyEqual(
        snapshot.netExternalFlowCny,
        expectedNetExternalFlowCny,
      )
    ) {
      throw new Error(
        `Net external flow for ${snapshot.date} does not match its contribution and withdrawal totals.`,
      );
    }

    cumulativeExternalCashContributionsCny +=
      snapshot.externalCashContributionsCny;
    cumulativeExternalWithdrawalsCny += snapshot.externalWithdrawalsCny;
    cumulativeExternalInKindContributionsCny +=
      snapshot.externalInKindContributionsCny;
    const cumulativeNetContributionsCny =
      cumulativeExternalCashContributionsCny +
      cumulativeExternalInKindContributionsCny -
      cumulativeExternalWithdrawalsCny;
    const totalPnlCny =
      snapshot.navCny +
      cumulativeExternalWithdrawalsCny -
      cumulativeExternalCashContributionsCny -
      cumulativeExternalInKindContributionsCny;

    if (
      ![
        cumulativeExternalCashContributionsCny,
        cumulativeExternalWithdrawalsCny,
        cumulativeExternalInKindContributionsCny,
        cumulativeNetContributionsCny,
        totalPnlCny,
      ].every(Number.isFinite)
    ) {
      throw new Error(
        `Cumulative CNY performance values are too large on ${snapshot.date}.`,
      );
    }

    return {
      date: snapshot.date,
      navCny: snapshot.navCny,
      externalCashContributionsCny:
        snapshot.externalCashContributionsCny,
      externalWithdrawalsCny: snapshot.externalWithdrawalsCny,
      externalInKindContributionsCny:
        snapshot.externalInKindContributionsCny,
      netExternalFlowCny: snapshot.netExternalFlowCny,
      cumulativeExternalCashContributionsCny,
      cumulativeExternalWithdrawalsCny,
      cumulativeExternalInKindContributionsCny,
      cumulativeNetContributionsCny,
      totalPnlCny,
    };
  });
}
