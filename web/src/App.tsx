import { useState, type ChangeEvent, type FormEvent } from "react";
import "./App.css";
import {
  hasInitializedPersonalLedger,
  initializeEmptyPersonalLedger,
  loadLedger,
  parseLedgerBackup,
  saveLedger,
  savePersonalLedger,
  serializeLedgerBackup,
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
  const [fxDate, setFxDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [fxAmountCny, setFxAmountCny] = useState("");
  const [fxAmountUsd, setFxAmountUsd] = useState("");
  const [buyDate, setBuyDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [buySymbol, setBuySymbol] = useState("");
  const [buyQuantity, setBuyQuantity] = useState("");
  const [buyPriceUsd, setBuyPriceUsd] = useState("");
  const [buyFeeUsd, setBuyFeeUsd] = useState("0");
  const [sellDate, setSellDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [sellSymbol, setSellSymbol] = useState("");
  const [sellQuantity, setSellQuantity] = useState("");
  const [sellPriceUsd, setSellPriceUsd] = useState("");
  const [sellFeeUsd, setSellFeeUsd] = useState("0");
  const [dividendDate, setDividendDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [dividendSymbol, setDividendSymbol] = useState("");
  const [dividendGrossAmountUsd, setDividendGrossAmountUsd] = useState("");
  const [dividendWithholdingTaxUsd, setDividendWithholdingTaxUsd] =
    useState("0");
  const [dividendPaymentMethod, setDividendPaymentMethod] = useState("CASH");
  const [dividendReinvestmentPriceUsd, setDividendReinvestmentPriceUsd] =
    useState("");
  const [interestDate, setInterestDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [interestAmountUsd, setInterestAmountUsd] = useState("");
  const [message, setMessage] = useState("");

  const balances = calculateBalances(ledger);
  const netDividendUsd =
    Number(dividendGrossAmountUsd) - Number(dividendWithholdingTaxUsd);
  const reinvestmentShares =
    netDividendUsd / Number(dividendReinvestmentPriceUsd);

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

  function addFxToUsd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountCny = Number(fxAmountCny);
    const amountUsd = Number(fxAmountUsd);

    if (
      !fxDate ||
      !Number.isFinite(amountCny) ||
      amountCny <= 0 ||
      !Number.isFinite(amountUsd) ||
      amountUsd <= 0
    ) {
      setMessage("Please enter a valid date, CNY amount, and USD amount.");
      return;
    }

    if (amountCny > balances.cnyCash) {
      setMessage("CNY spent cannot exceed current CNY cash.");
      return;
    }

    const fxConversion: LedgerEvent = {
      id: `fx-usd-${Date.now()}`,
      occurredAt: fxDate,
      accountId: "personal-main",
      type: "FX_TO_USD",
      amountCny,
      amountUsd,
      note: "Manual CNY to USD conversion",
    };

    const nextLedger = [...ledger, fxConversion];
    setLedger(nextLedger);
    saveLedger(nextLedger);
    setFxAmountCny("");
    setFxAmountUsd("");
    setMessage("FX conversion saved locally in this browser.");
  }

  function addBuy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = buySymbol.trim().toUpperCase();
    const quantity = Number(buyQuantity);
    const priceUsd = Number(buyPriceUsd);
    const feeUsd = Number(buyFeeUsd);

    if (
      !buyDate ||
      !symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(priceUsd) ||
      priceUsd <= 0 ||
      !Number.isFinite(feeUsd) ||
      feeUsd < 0
    ) {
      setMessage(
        "Please enter a valid date, symbol, quantity, USD price, and fee.",
      );
      return;
    }

    const tradeCost = quantity * priceUsd + feeUsd;

    if (tradeCost > balances.usdCash) {
      setMessage("Trade cost cannot exceed current USD cash.");
      return;
    }

    const buy: LedgerEvent = {
      id: `buy-${Date.now()}`,
      occurredAt: buyDate,
      accountId: "personal-main",
      type: "BUY",
      symbol,
      quantity,
      priceUsd,
      feeUsd,
      note: "Manual security purchase",
    };

    const nextLedger = [...ledger, buy];
    setLedger(nextLedger);
    saveLedger(nextLedger);
    setBuySymbol("");
    setBuyQuantity("");
    setBuyPriceUsd("");
    setBuyFeeUsd("0");
    setMessage("Buy transaction saved locally in this browser.");
  }

  function addSell(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = sellSymbol.trim().toUpperCase();
    const quantity = Number(sellQuantity);
    const priceUsd = Number(sellPriceUsd);
    const feeUsd = Number(sellFeeUsd);

    if (
      !sellDate ||
      !symbol ||
      !Number.isFinite(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(priceUsd) ||
      priceUsd <= 0 ||
      !Number.isFinite(feeUsd) ||
      feeUsd < 0
    ) {
      setMessage(
        "Please enter a valid date, symbol, quantity, USD price, and fee.",
      );
      return;
    }

    const position = balances.positions.find(
      (currentPosition) => currentPosition.symbol === symbol,
    );

    if (!position || quantity > position.quantity) {
      setMessage("Sell quantity cannot exceed the current position.");
      return;
    }

    const sell: LedgerEvent = {
      id: `sell-${Date.now()}`,
      occurredAt: sellDate,
      accountId: "personal-main",
      type: "SELL",
      symbol,
      quantity,
      priceUsd,
      feeUsd,
      note: "Manual security sale",
    };

    const nextLedger = [...ledger, sell];
    setLedger(nextLedger);
    saveLedger(nextLedger);
    setSellSymbol("");
    setSellQuantity("");
    setSellPriceUsd("");
    setSellFeeUsd("0");
    setMessage("Sell transaction saved locally in this browser.");
  }

  function addDividend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const symbol = dividendSymbol.trim().toUpperCase();
    const grossAmountUsd = Number(dividendGrossAmountUsd);
    const withholdingTaxUsd = Number(dividendWithholdingTaxUsd);
    const reinvestmentPriceUsd = Number(dividendReinvestmentPriceUsd);

    if (
      !dividendDate ||
      !symbol ||
      !Number.isFinite(grossAmountUsd) ||
      grossAmountUsd <= 0 ||
      !Number.isFinite(withholdingTaxUsd) ||
      withholdingTaxUsd < 0 ||
      withholdingTaxUsd > grossAmountUsd
    ) {
      setMessage(
        "Please enter a valid date, symbol, gross USD amount, and withholding tax.",
      );
      return;
    }

    const netDividendUsd = grossAmountUsd - withholdingTaxUsd;
    const isReinvested = dividendPaymentMethod === "REINVEST";
    const reinvestmentQuantity = netDividendUsd / reinvestmentPriceUsd;

    if (
      isReinvested &&
      (!Number.isFinite(reinvestmentPriceUsd) ||
        reinvestmentPriceUsd <= 0 ||
        netDividendUsd <= 0)
    ) {
      setMessage(
        "Reinvestment requires a positive net dividend and USD price.",
      );
      return;
    }

    const dividend: LedgerEvent = {
      id: `dividend-${Date.now()}`,
      occurredAt: dividendDate,
      accountId: "personal-main",
      type: "DIVIDEND",
      symbol,
      grossAmountUsd,
      withholdingTaxUsd,
      note: isReinvested
        ? "Manual dividend payment with reinvestment"
        : "Manual cash dividend payment",
    };

    const reinvestment: LedgerEvent[] = isReinvested
      ? [
          {
            id: `dividend-reinvest-${Date.now()}`,
            occurredAt: dividendDate,
            accountId: "personal-main",
            type: "BUY",
            symbol,
            quantity: reinvestmentQuantity,
            priceUsd: reinvestmentPriceUsd,
            feeUsd: 0,
            note: "Automatic dividend reinvestment",
          },
        ]
      : [];
    const nextLedger = [...ledger, dividend, ...reinvestment];
    setLedger(nextLedger);
    saveLedger(nextLedger);
    setDividendSymbol("");
    setDividendGrossAmountUsd("");
    setDividendWithholdingTaxUsd("0");
    setDividendReinvestmentPriceUsd("");
    setMessage(
      isReinvested
        ? "Dividend and reinvestment saved locally in this browser."
        : "Cash dividend saved locally in this browser.",
    );
  }

  function addInterest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const amountUsd = Number(interestAmountUsd);

    if (!interestDate || !Number.isFinite(amountUsd) || amountUsd <= 0) {
      setMessage("Please enter a valid date and a positive USD amount.");
      return;
    }

    const interest: LedgerEvent = {
      id: `interest-${Date.now()}`,
      occurredAt: interestDate,
      accountId: "personal-main",
      type: "INTEREST",
      amountUsd,
      note: "Manual USD interest payment",
    };

    const nextLedger = [...ledger, interest];
    setLedger(nextLedger);
    saveLedger(nextLedger);
    setInterestAmountUsd("");
    setMessage("USD interest saved locally in this browser.");
  }

  function exportLedgerBackup() {
    const backupJson = serializeLedgerBackup(ledger);
    const backupBlob = new Blob([backupJson], {
      type: "application/json",
    });
    const backupUrl = URL.createObjectURL(backupBlob);
    const downloadLink = document.createElement("a");

    downloadLink.href = backupUrl;
    downloadLink.download = `atlas-portfolio-ledger-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    downloadLink.click();
    URL.revokeObjectURL(backupUrl);
    setMessage("Ledger backup exported as a local JSON file.");
  }

  async function importLedgerBackup(event: ChangeEvent<HTMLInputElement>) {
    const fileInput = event.currentTarget;
    const backupFile = fileInput.files?.[0];

    if (!backupFile) {
      return;
    }

    try {
      const importedLedger = parseLedgerBackup(await backupFile.text());

      savePersonalLedger(importedLedger);
      setLedger(importedLedger);
      setIsPersonalLedger(true);
      setMessage(`Imported ${importedLedger.length} ledger event(s).`);
    } catch {
      setMessage("Could not import this file. Please choose a valid backup.");
    } finally {
      fileInput.value = "";
    }
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

      {isPersonalLedger && (
        <section>
          <h2>Add CNY to USD conversion</h2>
          <form onSubmit={addFxToUsd}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={fxDate}
                  onChange={(event) => setFxDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                CNY spent{" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fxAmountCny}
                  onChange={(event) => setFxAmountCny(event.target.value)}
                  placeholder="e.g. 10000"
                />
              </label>
            </p>
            <p>
              <label>
                USD received{" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={fxAmountUsd}
                  onChange={(event) => setFxAmountUsd(event.target.value)}
                  placeholder="e.g. 1380"
                />
              </label>
            </p>
            <button type="submit">Add FX conversion</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section>
          <h2>Add USD security purchase</h2>
          <form onSubmit={addBuy}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={buyDate}
                  onChange={(event) => setBuyDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={buySymbol}
                  onChange={(event) => setBuySymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Quantity{" "}
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={buyQuantity}
                  onChange={(event) => setBuyQuantity(event.target.value)}
                  placeholder="e.g. 2"
                />
              </label>
            </p>
            <p>
              <label>
                Price (USD per share){" "}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={buyPriceUsd}
                  onChange={(event) => setBuyPriceUsd(event.target.value)}
                  placeholder="e.g. 500"
                />
              </label>
            </p>
            <p>
              <label>
                Fee (USD){" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={buyFeeUsd}
                  onChange={(event) => setBuyFeeUsd(event.target.value)}
                  placeholder="e.g. 1.23"
                />
              </label>
            </p>
            <button type="submit">Add purchase</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section>
          <h2>Add USD security sale</h2>
          <form onSubmit={addSell}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={sellDate}
                  onChange={(event) => setSellDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={sellSymbol}
                  onChange={(event) => setSellSymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Quantity{" "}
                <input
                  type="number"
                  min="0.000001"
                  step="any"
                  value={sellQuantity}
                  onChange={(event) => setSellQuantity(event.target.value)}
                  placeholder="e.g. 1"
                />
              </label>
            </p>
            <p>
              <label>
                Price (USD per share){" "}
                <input
                  type="number"
                  min="0.000001"
                  step="0.000001"
                  value={sellPriceUsd}
                  onChange={(event) => setSellPriceUsd(event.target.value)}
                  placeholder="e.g. 550"
                />
              </label>
            </p>
            <p>
              <label>
                Fee (USD){" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={sellFeeUsd}
                  onChange={(event) => setSellFeeUsd(event.target.value)}
                  placeholder="e.g. 1.23"
                />
              </label>
            </p>
            <button type="submit">Add sale</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section>
          <h2>Add USD dividend</h2>
          <form onSubmit={addDividend}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={dividendDate}
                  onChange={(event) => setDividendDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Symbol{" "}
                <input
                  type="text"
                  value={dividendSymbol}
                  onChange={(event) => setDividendSymbol(event.target.value)}
                  placeholder="e.g. VOO"
                />
              </label>
            </p>
            <p>
              <label>
                Gross amount (USD){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={dividendGrossAmountUsd}
                  onChange={(event) =>
                    setDividendGrossAmountUsd(event.target.value)
                  }
                  placeholder="e.g. 6.20"
                />
              </label>
            </p>
            <p>
              <label>
                Withholding tax (USD){" "}
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={dividendWithholdingTaxUsd}
                  onChange={(event) =>
                    setDividendWithholdingTaxUsd(event.target.value)
                  }
                  placeholder="e.g. 0.62"
                />
              </label>
            </p>
            <p>
              <label>
                Payment method{" "}
                <select
                  value={dividendPaymentMethod}
                  onChange={(event) =>
                    setDividendPaymentMethod(event.target.value)
                  }
                >
                  <option value="CASH">Cash dividend</option>
                  <option value="REINVEST">Reinvest dividend</option>
                </select>
              </label>
            </p>
            {dividendPaymentMethod === "REINVEST" && (
              <>
                <p>
                  <label>
                    Reinvestment price (USD per share){" "}
                    <input
                      type="number"
                      min="0.000001"
                      step="0.000001"
                      value={dividendReinvestmentPriceUsd}
                      onChange={(event) =>
                        setDividendReinvestmentPriceUsd(event.target.value)
                      }
                      placeholder="e.g. 500"
                    />
                  </label>
                </p>
                <p>
                  Reinvestment shares: {" "}
                  {Number.isFinite(reinvestmentShares) &&
                  reinvestmentShares > 0
                    ? reinvestmentShares.toFixed(6)
                    : "Not available"}
                </p>
              </>
            )}
            <button type="submit">Add dividend</button>
          </form>
        </section>
      )}

      {isPersonalLedger && (
        <section>
          <h2>Add USD interest</h2>
          <form onSubmit={addInterest}>
            <p>
              <label>
                Date{" "}
                <input
                  type="date"
                  value={interestDate}
                  onChange={(event) => setInterestDate(event.target.value)}
                />
              </label>
            </p>
            <p>
              <label>
                Amount received (USD){" "}
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={interestAmountUsd}
                  onChange={(event) =>
                    setInterestAmountUsd(event.target.value)
                  }
                  placeholder="e.g. 12.34"
                />
              </label>
            </p>
            <button type="submit">Add interest</button>
          </form>
        </section>
      )}

      {message && <p>{message}</p>}

      <section>
        <h2>Local backup</h2>
        <p>
          Export before entering more history. Imported files replace the local
          browser ledger.
        </p>
        <button type="button" onClick={exportLedgerBackup}>
          Export JSON backup
        </button>
        <p>
          <label>
            Import JSON backup{" "}
            <input
              type="file"
              accept="application/json,.json"
              onChange={importLedgerBackup}
            />
          </label>
        </p>
      </section>

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
              {usd.format(position.costUsd)} · average cost{" "}
              {usd.format(position.costUsd / position.quantity)} per share
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
