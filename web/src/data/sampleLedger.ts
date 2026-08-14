// web/src/data/sampleLedger.ts

import type { LedgerEvent } from "../domain/ledger";

export const sampleLedger: LedgerEvent[] = [
  {
    id: "evt-001",
    occurredAt: "2026-07-14",
    accountId: "ibkr-main",
    type: "CNY_DEPOSIT",
    amountCny: 20_000,
    note: "Anonymous test funding",
  },
  {
    id: "evt-002",
    occurredAt: "2026-07-15",
    accountId: "ibkr-main",
    type: "FX_TO_USD",
    amountCny: 14_320,
    amountUsd: 2_000,
  },
  {
    id: "evt-003",
    occurredAt: "2026-07-15",
    accountId: "ibkr-main",
    type: "BUY",
    symbol: "VOO",
    quantity: 2,
    priceUsd: 564.18,
    feeUsd: 0.35,
  },
  {
    id: "evt-004",
    occurredAt: "2026-07-22",
    accountId: "ibkr-main",
    type: "BUY",
    symbol: "GOOGL",
    quantity: 4,
    priceUsd: 185.32,
    feeUsd: 0.35,
  },
  {
    id: "evt-005",
    occurredAt: "2026-08-03",
    accountId: "ibkr-main",
    type: "DIVIDEND",
    symbol: "VOO",
    grossAmountUsd: 6.20,
    withholdingTaxUsd: 0.84,
  },
];