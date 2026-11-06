import {
  DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION,
  type DailyPortfolioSnapshot,
  type ValuedExternalFlow,
} from "./calculateDailyPortfolioSnapshots";

export type UsdTwrSnapshotInput = Pick<
  DailyPortfolioSnapshot,
  | "date"
  | "calculationVersion"
  | "navCny"
  | "externalFlows"
  | "netExternalFlowCny"
> & {
  valuationInputs: Pick<DailyPortfolioSnapshot["valuationInputs"], "usdCnyRate">;
};

export interface UsdTwrPoint {
  date: string;
  navUsd: number;
  netExternalFlowUsd: number;
  periodReturn: number | null;
  cumulativeReturn: number;
  growthIndex: number;
}

function assertCalendarDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const parsed = match
    ? new Date(
        Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
      )
    : undefined;

  if (
    !match ||
    parsed?.getUTCFullYear() !== Number(match[1]) ||
    parsed.getUTCMonth() !== Number(match[2]) - 1 ||
    parsed.getUTCDate() !== Number(match[3])
  ) {
    throw new Error(`USD TWR snapshot date ${value} is invalid.`);
  }
}

function nearlyEqual(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <=
    1e-8 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function valueFlowUsd(
  flow: ValuedExternalFlow,
  date: string,
  usdCnyRate: number,
): { valueUsd: number; valueCny: number } {
  if (flow.occurredAt !== date) {
    throw new Error(`External flow ${flow.eventId} does not belong to ${date}.`);
  }

  const cashContribution = flow.category === "CASH_CONTRIBUTION";
  const cashWithdrawal = flow.category === "CASH_WITHDRAWAL";
  const inKindContribution = flow.category === "IN_KIND_CONTRIBUTION";
  if (
    !(
      (cashContribution &&
        flow.direction === "CONTRIBUTION" &&
        flow.nativeCurrency === "CNY") ||
      (cashWithdrawal &&
        flow.direction === "WITHDRAWAL" &&
        flow.nativeCurrency === "CNY") ||
      (inKindContribution &&
        flow.direction === "CONTRIBUTION" &&
        flow.nativeCurrency === "USD")
    ) ||
    !Number.isFinite(flow.nativeAmount) ||
    flow.nativeAmount <= 0 ||
    !Number.isFinite(flow.valueCny) ||
    flow.valueCny <= 0
  ) {
    throw new Error(
      `External flow ${flow.eventId} has invalid values or classification.`,
    );
  }

  const expectedValueCny =
    flow.nativeCurrency === "CNY"
      ? flow.nativeAmount
      : flow.nativeAmount * usdCnyRate;
  if (
    !Number.isFinite(expectedValueCny) ||
    !nearlyEqual(flow.valueCny, expectedValueCny)
  ) {
    throw new Error(`External flow ${flow.eventId} has an inconsistent CNY value.`);
  }

  const direction = cashWithdrawal ? -1 : 1;
  return {
    valueUsd:
      direction *
      (flow.nativeCurrency === "CNY"
        ? flow.nativeAmount / usdCnyRate
        : flow.nativeAmount),
    valueCny: direction * flow.valueCny,
  };
}

export function calculateUsdTwrSeries(
  snapshots: readonly UsdTwrSnapshotInput[],
): UsdTwrPoint[] {
  const orderedSnapshots = [...snapshots].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
  const seenDates = new Set<string>();
  let previousNavUsd: number | undefined;
  let growthFactor = 1;

  return orderedSnapshots.map((snapshot) => {
    assertCalendarDate(snapshot.date);
    if (seenDates.has(snapshot.date)) {
      throw new Error(
        `USD TWR snapshot date ${snapshot.date} appears more than once.`,
      );
    }
    seenDates.add(snapshot.date);

    if (
      snapshot.calculationVersion !==
      DAILY_PORTFOLIO_SNAPSHOT_CALCULATION_VERSION
    ) {
      throw new Error(
        `USD TWR snapshot ${snapshot.date} uses an unsupported calculation version.`,
      );
    }

    const rate = snapshot.valuationInputs.usdCnyRate;
    if (
      !rate ||
      rate.pair.baseCurrency !== "USD" ||
      rate.pair.quoteCurrency !== "CNY" ||
      !Number.isFinite(rate.rate) ||
      rate.rate <= 0
    ) {
      throw new Error(
        `USD TWR snapshot ${snapshot.date} requires a positive USD/CNY valuation rate.`,
      );
    }
    if (!Number.isFinite(snapshot.navCny) || snapshot.navCny < 0) {
      throw new Error(
        `USD TWR snapshot ${snapshot.date} requires a non-negative CNY NAV.`,
      );
    }

    const navUsd = snapshot.navCny / rate.rate;
    const valuedFlows = snapshot.externalFlows.map((flow) =>
      valueFlowUsd(flow, snapshot.date, rate.rate),
    );
    const netExternalFlowUsd = valuedFlows.reduce(
      (sum, flow) => sum + flow.valueUsd,
      0,
    );
    const netExternalFlowCny = valuedFlows.reduce(
      (sum, flow) => sum + flow.valueCny,
      0,
    );
    if (
      !Number.isFinite(snapshot.netExternalFlowCny) ||
      !Number.isFinite(netExternalFlowCny) ||
      !nearlyEqual(snapshot.netExternalFlowCny, netExternalFlowCny)
    ) {
      throw new Error(
        `USD TWR external flows for ${snapshot.date} do not reconcile.`,
      );
    }
    if (!Number.isFinite(navUsd) || !Number.isFinite(netExternalFlowUsd)) {
      throw new Error(`USD TWR values are too large on ${snapshot.date}.`);
    }

    let periodReturn: number | null = null;
    if (previousNavUsd === undefined) {
      if (navUsd <= 0) {
        throw new Error(
          `USD TWR first snapshot ${snapshot.date} must have a positive NAV.`,
        );
      }
    } else {
      if (previousNavUsd <= 0) {
        throw new Error(
          `USD TWR cannot continue after zero NAV on ${snapshot.date}.`,
        );
      }
      const preFlowNavUsd = navUsd - netExternalFlowUsd;
      if (preFlowNavUsd < 0 || !Number.isFinite(preFlowNavUsd)) {
        throw new Error(`USD TWR pre-flow NAV is invalid on ${snapshot.date}.`);
      }
      const periodFactor = preFlowNavUsd / previousNavUsd;
      growthFactor *= periodFactor;
      periodReturn = periodFactor - 1;
    }

    const growthIndex = 100 * growthFactor;
    if (!Number.isFinite(growthIndex)) {
      throw new Error(`USD TWR cumulative return is too large on ${snapshot.date}.`);
    }
    previousNavUsd = navUsd;

    return {
      date: snapshot.date,
      navUsd,
      netExternalFlowUsd,
      periodReturn,
      cumulativeReturn: growthFactor - 1,
      growthIndex,
    };
  });
}
