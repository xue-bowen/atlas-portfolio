import "./App.css";
import { sampleLedger } from "./data/sampleLedger";
import type { LedgerEvent } from "./domain/ledger";

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
  return (
    <main>
      <h1>Atlas Portfolio</h1>
      <p>Multi-currency portfolio tracker · development preview</p>

      <h2>Anonymous test ledger</h2>
      <p>{sampleLedger.length} events loaded</p>

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