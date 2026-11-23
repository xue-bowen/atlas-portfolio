export function isValidStockSplitRatio(newShares: unknown, oldShares: unknown): boolean {
  return typeof newShares === "number" && typeof oldShares === "number" &&
    Number.isSafeInteger(newShares) && Number.isSafeInteger(oldShares) &&
    newShares > 0 && oldShares > 0 && newShares !== oldShares;
}
