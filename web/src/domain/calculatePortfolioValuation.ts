import type { CashValuation } from "./calculateCashValuation";
import type { HoldingsValuation } from "./calculateHoldingsValuation";

export type PortfolioValuationUnavailableReason =
  | "CASH_VALUATION_INCOMPLETE"
  | "SECURITY_COVERAGE_INCOMPLETE"
  | "USD_CNY_RATE_UNAVAILABLE";

export interface PortfolioValuationInput {
  cashValuation: CashValuation;
  holdingsValuation: HoldingsValuation;
  usdCnyRate?: number;
}

export interface PortfolioValuation {
  coveredSecuritiesMarketValueUsd: number;
  coveredSecuritiesMarketValueCny?: number;
  totalSecuritiesMarketValueUsd?: number;
  totalSecuritiesMarketValueCny?: number;
  totalCashValueCny?: number;
  totalPortfolioValueCny?: number;
  unavailableReasons: PortfolioValuationUnavailableReason[];
}

function translateUsdValue(
  amountUsd: number,
  usdCnyRate: number | undefined,
): number | undefined {
  if (amountUsd === 0) {
    return 0;
  }

  return usdCnyRate !== undefined &&
    Number.isFinite(usdCnyRate) &&
    usdCnyRate > 0
    ? amountUsd * usdCnyRate
    : undefined;
}

export function calculatePortfolioValuation({
  cashValuation,
  holdingsValuation,
  usdCnyRate,
}: PortfolioValuationInput): PortfolioValuation {
  const coveredSecuritiesMarketValueCny = translateUsdValue(
    holdingsValuation.coveredMarketValueUsd,
    usdCnyRate,
  );
  const totalSecuritiesMarketValueUsd =
    holdingsValuation.totalMarketValueUsd;
  const totalSecuritiesMarketValueCny =
    totalSecuritiesMarketValueUsd === undefined
      ? undefined
      : translateUsdValue(totalSecuritiesMarketValueUsd, usdCnyRate);
  const unavailableReasons: PortfolioValuationUnavailableReason[] = [];

  if (cashValuation.totalCashValueCny === undefined) {
    unavailableReasons.push("CASH_VALUATION_INCOMPLETE");
  }

  if (totalSecuritiesMarketValueUsd === undefined) {
    unavailableReasons.push("SECURITY_COVERAGE_INCOMPLETE");
  }

  if (
    holdingsValuation.totalPositionCount > 0 &&
    totalSecuritiesMarketValueCny === undefined &&
    (usdCnyRate === undefined ||
      !Number.isFinite(usdCnyRate) ||
      usdCnyRate <= 0)
  ) {
    unavailableReasons.push("USD_CNY_RATE_UNAVAILABLE");
  }

  const totalPortfolioValueCny =
    cashValuation.totalCashValueCny !== undefined &&
    totalSecuritiesMarketValueCny !== undefined
      ? cashValuation.totalCashValueCny + totalSecuritiesMarketValueCny
      : undefined;

  return {
    coveredSecuritiesMarketValueUsd:
      holdingsValuation.coveredMarketValueUsd,
    coveredSecuritiesMarketValueCny,
    totalSecuritiesMarketValueUsd,
    totalSecuritiesMarketValueCny,
    totalCashValueCny: cashValuation.totalCashValueCny,
    totalPortfolioValueCny,
    unavailableReasons,
  };
}
