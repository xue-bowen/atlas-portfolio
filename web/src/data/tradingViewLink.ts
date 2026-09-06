import type { SecurityIdentifier } from "../domain/marketData";

const TRADING_VIEW_SYMBOLS_URL = "https://www.tradingview.com/symbols";

function tradingViewExchange(exchange: string): string | undefined {
  const normalized = exchange.trim().toUpperCase();

  if (normalized.includes("NASDAQ")) {
    return "NASDAQ";
  }

  if (
    normalized.includes("NYSE ARCA") ||
    normalized === "ARCA" ||
    normalized.includes("AMEX") ||
    normalized.includes("NYSE AMERICAN")
  ) {
    return "AMEX";
  }

  if (normalized === "NYSE" || normalized.includes("NEW YORK STOCK EXCHANGE")) {
    return "NYSE";
  }

  return undefined;
}

export function createTradingViewSymbolUrl(
  security: SecurityIdentifier,
): string | undefined {
  const exchange = tradingViewExchange(security.exchange);
  const symbol = security.symbol.trim().toUpperCase();

  if (!exchange || !symbol) {
    return undefined;
  }

  return `${TRADING_VIEW_SYMBOLS_URL}/${encodeURIComponent(exchange)}-${encodeURIComponent(symbol)}/`;
}
