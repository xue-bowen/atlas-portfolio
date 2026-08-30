export interface CashValuationInput {
  cnyCash: number;
  hkdCash: number;
  usdCash: number;
  hkdCnyRate?: number;
  usdCnyRate?: number;
}

export interface CashValuation {
  cnyCashValueCny: number;
  hkdCashValueCny?: number;
  usdCashValueCny?: number;
  totalCashValueCny?: number;
  unavailableCurrencies: Array<"HKD" | "USD">;
}

function translateCash(
  amount: number,
  rate: number | undefined,
): number | undefined {
  if (amount === 0) {
    return 0;
  }

  return rate !== undefined && Number.isFinite(rate) && rate > 0
    ? amount * rate
    : undefined;
}

export function calculateCashValuation({
  cnyCash,
  hkdCash,
  usdCash,
  hkdCnyRate,
  usdCnyRate,
}: CashValuationInput): CashValuation {
  const hkdCashValueCny = translateCash(hkdCash, hkdCnyRate);
  const usdCashValueCny = translateCash(usdCash, usdCnyRate);
  const unavailableCurrencies: Array<"HKD" | "USD"> = [];

  if (hkdCashValueCny === undefined) {
    unavailableCurrencies.push("HKD");
  }

  if (usdCashValueCny === undefined) {
    unavailableCurrencies.push("USD");
  }

  return {
    cnyCashValueCny: cnyCash,
    hkdCashValueCny,
    usdCashValueCny,
    totalCashValueCny:
      unavailableCurrencies.length === 0
        ? cnyCash + hkdCashValueCny! + usdCashValueCny!
        : undefined,
    unavailableCurrencies,
  };
}
