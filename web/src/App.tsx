import { useState, type FormEvent } from "react";
import "./App.css";
import {
  hasInitializedPersonalLedger,
  initializeEmptyPersonalLedger,
  loadLedger,
  saveLedger,
} from "./data/ledgerStorage";
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
  const [ledger, setLedger] = useState(loadLedger);
  const [isPersonalLedger, setIsPersonalLedger] = useState(
    hasInitializedPersonalLedger,
  );
  const [depositDate, setDepositDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [depositAmount, setDepositAmount] = useState("");
  const [message, setMessage] = useState("");

  const balances = calculateBalances(ledger);

  function startEmptyPersonalLedger() {
    const confirmed = window.confirm(
      "This will replace the local demo/test ledger with an empty personal ledger. Continue?",
    );

    if (!confirmed) {
      return;
    }

    setLedger(initializeEmptyPersonalLedger());
    setIsPersonalLedger(true);
    setMessage("Empty personal ledger initialized locally in this browser.");
  }

  function addCnyDeposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(depositAmount);

    if (!depositDate || !Number.isFinite(amountCny) || amountCny <= 0) {
      setMessage("Please enter a valid date and a positive CNY amount.");
      return;
    }

    const deposit: LedgerEvent = {
      id: `deposit-${Date.now()}`,
      occurredAt: depositDate,
      accountId: "personal-main",
      type: "CNY_DEPOSIT",
      amountCny,
      note: "Manual CNY deposit",
    };

    const nextLedger = [...ledger, deposit];
    setLedger(nextLedger);
    saveLedger(nextLedger);
    setDepositAmount("");
    setMessage("Deposit saved locally in this browser.");
  }

  return (
    <main>
      <h1>Atlas Portfolio</h1>
      <p>
        {isPersonalLedger
          ? "Personal ledger saved only in this browser."
          : "Demo ledger for calculation and development tests."}
      </p>

      {!isPersonalLedger && (
        <section>
          <h2>Start personal ledger</h2>
          <p>
            The current records are anonymous demo data. Start with an empty
            personal ledger before entering real transactions.
          </p>
          <button type="button" onClick={startEmptyPersonalLedger}>
            Start with an empty personal ledger
          </button>
        </section>
      )}

      {isPersonalLedger && (
        <section>
          <h2>Add CNY deposit</h2>
          <form onSubmit={addCnyDeposit}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={depositDate}
                  onChange={(event) => setDepositDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Amount (CNY){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={depositAmount}
                  onChange={(event) => setDepositAmount(event.target.value)}
                  placeholder="e.g. 1000"
                />
              </label>
            </p>
            <button type="submit">Add deposit</button>
          </form>
        </section>
      )}

      {message && <p>{message}</p>}

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
      {balances.positions.length === 0 ? (
        <p>No open positions.</p>
      ) : (
        <ul>
          {balances.positions.map((position) => (
            <li key={position.symbol}>
              {position.symbol}: {position.quantity} shares · cost{" "}
              {usd.format(position.costUsd)}
            </li>
          ))}
        </ul>
      )}

      <h2>{isPersonalLedger ? "Personal ledger" : "Anonymous test ledger"}</h2>
      {ledger.length === 0 ? (
        <p>No transactions recorded yet.</p>
      ) : (
        <ol>
          {ledger.map((event) => (
            <li key={event.id}>
              <strong>{event.occurredAt}</strong> — {describeEvent(event)}
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}