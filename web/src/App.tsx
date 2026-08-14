import "./App.css";
import { sampleLedger } from "./data/sampleLedger";
import { calculateBalances } from "./domain/calculateBalances";
import type { LedgerEvent } from "./domain/ledger";

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const cny = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
});

function describeEvent(event: LedgerEvent): string {
  switch (event.type) {
    case "CNY_DEPOSIT":
      return `Deposit ¥${event.amountCny.toFixed(2)}`;
    case "CNY_WITHDRAWAL":
      return `Withdraw ¥${event.amountCny.toFixed(2)}`;
    case "FX_TO_USD":
      return `Exchange ¥${event.amountCny.toFixed(2)} → $${event.amountUsd.toFixed(2)}`;
    case "FX_TO_CNY":
      return `Exchange $${event.amountUsd.toFixed(2)} → ¥${event.amountCny.toFixed(2)}`;
    case "BUY":
      return `Buy ${event.quantity} ${event.symbol} @ $${event.priceUsd.toFixed(2)}`;
    case "SELL":
      return `Sell ${event.quantity} ${event.symbol} @ $${event.priceUsd.toFixed(2)}`;
    case "DIVIDEND":
      return `${event.symbol} dividend: $${event.grossAmountUsd.toFixed(2)} gross`;
    case "INTEREST":
      return `Interest: $${event.amountUsd.toFixed(2)}`;
    case "FEE":
      return `${event.category}: $${event.amountUsd.toFixed(2)}`;
  }
}

export default function App() {
  const balances = calculateBalances(sampleLedger);

  return (
    <main>
      <h1>Atlas Portfolio</h1>
      <p>Anonymous ledger calculation preview</p>

      <h2>Current balances</h2>
      <ul>
        <li>CNY cash: {cny.format(balances.cnyCash)}</li>
        <li>USD cash: {usd.format(balances.usdCash)}</li>
      </ul>

      <h2>Realized result</h2>
      <ul>
        <li>Realized P&amp;L: {usd.format(balances.realizedPnlUsd)}</li>
        <li>Accumulated trading fees: {usd.format(balances.totalFeesUsd)}</li>
      </ul>

      <h2>Open positions</h2>
      <ul>
        {balances.positions.map((position) => (
          <li key={position.symbol}>
            {position.symbol}: {position.quantity} shares · cost{" "}
            {usd.format(position.costUsd)}
          </li>
        ))}
      </ul>

      <h2>Anonymous test ledger</h2>
      <ol>
        {sampleLedger.map((event) => (
          <li key={event.id}>
            <strong>{event.occurredAt}</strong> — {describeEvent(event)}
          </li>
        ))}
      </ol>
    </main>
  );
}