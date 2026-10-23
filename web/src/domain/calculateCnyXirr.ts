import {
  calculateCnyPerformanceSeries,
  type CnyPerformanceSnapshotInput,
} from "./calculateCnyPerformanceSeries";

const MIN_RATE = -0.999999;
const MAX_RATE = 10_000;
const SEARCH_STEPS = 4_096;
const MAX_BISECTION_STEPS = 200;

export type CnyXirrCashFlowSource = "EXTERNAL_FLOW" | "ENDING_NAV";

export interface CnyXirrCashFlow {
  date: string;
  amountCny: number;
  source: CnyXirrCashFlowSource;
}

export interface CnyXirrResult {
  annualRate: number;
  asOfDate: string;
  dayCountConvention: "ACTUAL_365";
  cashFlows: CnyXirrCashFlow[];
}

function dateToUtcMilliseconds(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function xnpv(
  logGrowthFactor: number,
  cashFlows: readonly CnyXirrCashFlow[],
): number {
  const firstDate = dateToUtcMilliseconds(cashFlows[0].date);

  return cashFlows.reduce((total, cashFlow) => {
    const elapsedDays =
      (dateToUtcMilliseconds(cashFlow.date) - firstDate) / 86_400_000;
    return (
      total +
      cashFlow.amountCny *
        Math.exp(-logGrowthFactor * (elapsedDays / 365))
    );
  }, 0);
}

function addDistinctRoot(roots: number[], candidate: number): void {
  const alreadyFound = roots.some(
    (root) =>
      Math.abs(root - candidate) <=
      1e-8 * Math.max(1, Math.abs(root), Math.abs(candidate)),
  );

  if (!alreadyFound) {
    roots.push(candidate);
  }
}

function bisectRoot(
  leftStart: number,
  rightStart: number,
  leftValueStart: number,
  cashFlows: readonly CnyXirrCashFlow[],
  valueTolerance: number,
): number {
  let left = leftStart;
  let right = rightStart;
  let leftValue = leftValueStart;

  for (let step = 0; step < MAX_BISECTION_STEPS; step += 1) {
    const middle = (left + right) / 2;
    const middleValue = xnpv(middle, cashFlows);

    if (
      Math.abs(middleValue) <= valueTolerance ||
      Math.abs(right - left) <= 1e-13
    ) {
      return middle;
    }

    if (Math.sign(leftValue) === Math.sign(middleValue)) {
      left = middle;
      leftValue = middleValue;
    } else {
      right = middle;
    }
  }

  return (left + right) / 2;
}

function findRoots(cashFlows: readonly CnyXirrCashFlow[]): number[] {
  const minimumLogGrowth = Math.log1p(MIN_RATE);
  const maximumLogGrowth = Math.log1p(MAX_RATE);
  const valueScale = cashFlows.reduce(
    (total, cashFlow) => total + Math.abs(cashFlow.amountCny),
    0,
  );
  const valueTolerance = Math.max(1, valueScale) * 1e-10;
  const roots: number[] = [];
  let previousLogGrowth = minimumLogGrowth;
  let previousValue = xnpv(previousLogGrowth, cashFlows);

  if (
    Number.isFinite(previousValue) &&
    Math.abs(previousValue) <= valueTolerance
  ) {
    addDistinctRoot(roots, previousLogGrowth);
  }

  for (let step = 1; step <= SEARCH_STEPS; step += 1) {
    const logGrowth =
      minimumLogGrowth +
      ((maximumLogGrowth - minimumLogGrowth) * step) / SEARCH_STEPS;
    const value = xnpv(logGrowth, cashFlows);

    if (Number.isFinite(value) && Math.abs(value) <= valueTolerance) {
      addDistinctRoot(roots, logGrowth);
    }

    if (
      (previousValue < 0 && value > 0) ||
      (previousValue > 0 && value < 0)
    ) {
      addDistinctRoot(
        roots,
        bisectRoot(
          previousLogGrowth,
          logGrowth,
          previousValue,
          cashFlows,
          valueTolerance,
        ),
      );
    }

    previousLogGrowth = logGrowth;
    previousValue = value;
  }

  return roots.sort((left, right) => left - right);
}

export function buildCnyXirrCashFlows(
  snapshots: readonly CnyPerformanceSnapshotInput[],
): CnyXirrCashFlow[] {
  const performanceSeries = calculateCnyPerformanceSeries(snapshots);

  if (performanceSeries.length === 0) {
    throw new Error("CNY XIRR requires at least one portfolio snapshot.");
  }

  const cashFlows: CnyXirrCashFlow[] = [];

  for (const point of performanceSeries) {
    const investorCashFlowCny =
      point.externalWithdrawalsCny -
      point.externalCashContributionsCny -
      point.externalInKindContributionsCny;

    if (investorCashFlowCny !== 0) {
      cashFlows.push({
        date: point.date,
        amountCny: investorCashFlowCny,
        source: "EXTERNAL_FLOW",
      });
    }
  }

  const endingPoint = performanceSeries.at(-1)!;

  cashFlows.push({
    date: endingPoint.date,
    amountCny: endingPoint.navCny,
    source: "ENDING_NAV",
  });

  return cashFlows;
}

export function calculateCnyXirr(
  snapshots: readonly CnyPerformanceSnapshotInput[],
): CnyXirrResult {
  const cashFlows = buildCnyXirrCashFlows(snapshots);
  const hasPositiveCashFlow = cashFlows.some(
    (cashFlow) => cashFlow.amountCny > 0,
  );
  const hasNegativeCashFlow = cashFlows.some(
    (cashFlow) => cashFlow.amountCny < 0,
  );

  if (!hasPositiveCashFlow || !hasNegativeCashFlow) {
    throw new Error(
      "CNY XIRR requires at least one positive and one negative investor cash flow.",
    );
  }

  const distinctDates = new Set(cashFlows.map((cashFlow) => cashFlow.date));

  if (distinctDates.size < 2) {
    throw new Error("CNY XIRR requires cash flows on at least two dates.");
  }

  const roots = findRoots(cashFlows);

  if (roots.length === 0) {
    throw new Error(
      `CNY XIRR has no solution between ${MIN_RATE} and ${MAX_RATE}.`,
    );
  }

  if (roots.length > 1) {
    throw new Error(
      "CNY XIRR has multiple possible solutions and is ambiguous.",
    );
  }

  return {
    annualRate: Math.expm1(roots[0]),
    asOfDate: cashFlows.at(-1)!.date,
    dayCountConvention: "ACTUAL_365",
    cashFlows,
  };
}
