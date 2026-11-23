// web/src/domain/ledger.ts

export type Currency = "CNY" | "HKD" | "USD";

export type LedgerEventType =
  | "CNY_DEPOSIT"
  | "CNY_WITHDRAWAL"
  | "FX_TO_USD"
  | "FX_TO_CNY"
  | "BUY"
  | "SELL"
  | "STOCK_SPLIT"
  | "IN_KIND_CONTRIBUTION"
  | "DIVIDEND"
  | "INTEREST"
  | "FEE";

interface BaseLedgerEvent {
  id: string;
  occurredAt: string; // YYYY-MM-DD
  accountId: string;
  note?: string;
}

// 金额始终填正数；资金方向由事件类型决定。
export interface CnyDeposit extends BaseLedgerEvent {
  type: "CNY_DEPOSIT";
  amountCny: number;
}

export interface CnyWithdrawal extends BaseLedgerEvent {
  type: "CNY_WITHDRAWAL";
  amountCny: number;
}

export interface FxToUsd extends BaseLedgerEvent {
  type: "FX_TO_USD";
  amountCny: number;
  amountUsd: number;
}

export interface FxToCny extends BaseLedgerEvent {
  type: "FX_TO_CNY";
  amountUsd: number;
  amountCny: number;
}

export interface SecurityTrade extends BaseLedgerEvent {
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  priceUsd: number;
  feeUsd: number;
}

export interface InKindContribution extends BaseLedgerEvent {
  type: "IN_KIND_CONTRIBUTION";
  source: "CASHBACK_REWARD";
  symbol: string;
  quantity: number;
  priceUsd: number;
  currency: "USD";
}

export interface StockSplit extends BaseLedgerEvent {
  type: "STOCK_SPLIT";
  symbol: string;
  newShares: number;
  oldShares: number;
}

export interface Dividend extends BaseLedgerEvent {
  type: "DIVIDEND";
  symbol: string;
  grossAmountUsd: number;
  withholdingTaxUsd: number;
}

export type Interest = BaseLedgerEvent & {
  type: "INTEREST";
} & (
    | {
        currency: Currency;
        amount: number;
      }
    | {
        currency?: never;
        amountUsd: number;
      }
  );

export interface Fee extends BaseLedgerEvent {
  type: "FEE";
  amountUsd: number;
  category: "COMMISSION" | "ADR_FEE" | "OTHER";
}

export type LedgerEvent =
  | CnyDeposit
  | CnyWithdrawal
  | FxToUsd
  | FxToCny
  | SecurityTrade
  | StockSplit
  | InKindContribution
  | Dividend
  | Interest
  | Fee;
