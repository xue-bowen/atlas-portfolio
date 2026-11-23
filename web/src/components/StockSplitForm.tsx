import { useState, type FormEvent } from "react";
import { calculateBalances } from "../domain/calculateBalances";
import { addStockSplitEvent } from "../domain/addStockSplitEvent";
import type { LedgerEvent, StockSplit } from "../domain/ledger";

const usd = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);

interface Props {
  ledger: LedgerEvent[];
  initialDate: string;
  onSave: (event: StockSplit) => Promise<boolean>;
}

export function StockSplitForm({ ledger, initialDate, onSave }: Props) {
  const [date, setDate] = useState(initialDate);
  const [symbol, setSymbol] = useState("");
  const [newShares, setNewShares] = useState("");
  const [oldShares, setOldShares] = useState("1");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const current = calculateBalances(ledger);
  const event: StockSplit = {
    id: "split-preview", accountId: "personal-main", type: "STOCK_SPLIT",
    occurredAt: date, symbol: symbol.trim().toUpperCase(),
    newShares: Number(newShares), oldShares: Number(oldShares), note: note.trim() || undefined,
  };
  let projected: ReturnType<typeof calculateBalances> | undefined;
  let error = "";
  if (date && event.symbol && newShares && oldShares) {
    try {
      projected = calculateBalances(addStockSplitEvent(ledger, event));
    } catch (cause) {
      error = cause instanceof Error ? cause.message : "This split would make the ledger invalid.";
    }
  }
  const before = current.positions.find((position) => position.symbol === event.symbol);
  const after = projected?.positions.find((position) => position.symbol === event.symbol);

  async function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!projected || error || saving) return;
    setSaving(true);
    setSaveError("");
    try {
      if (await onSave({ ...event, id: `split-${crypto.randomUUID()}` })) {
        setNewShares("");
        setNote("");
      } else {
        setSaveError("Split was not saved. Review the message in Transactions.");
      }
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : "Split could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="unified-transaction-form" aria-label="Record stock split" onSubmit={submit}>
      <div className="transaction-flow-heading"><span>2. Enter details</span><h3>Stock split / reverse split</h3></div>
      <p>
        Enter the effective date and the new shares received for each number of old shares.
        For a 4-for-1 split, enter 4 new and 1 old. For a 1-for-10 reverse split, enter 1 new and 10 old.
      </p>
      <p>
        Total cost and cash stay unchanged on the effective date. Later sales and valuations
        are recalculated. The split is inserted before trades on that date. Fractional shares
        are retained; cash paid instead of fractional shares and other corporate actions need separate support.
      </p>
      <fieldset>
        <legend>Basic information</legend>
        <div className="transaction-form-grid">
          <label>Effective date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label>Account<input value="personal-main" readOnly /></label>
          <label>Symbol<input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. NVDA" required /></label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Split ratio</legend>
        <div className="transaction-form-grid">
          <label>New shares<input type="number" value={newShares} min="1" step="1" onChange={(e) => setNewShares(e.target.value)} required /></label>
          <label>Old shares<input type="number" value={oldShares} min="1" step="1" onChange={(e) => setOldShares(e.target.value)} required /></label>
          <label>Note (optional)<textarea value={note} onChange={(e) => setNote(e.target.value)} /></label>
        </div>
      </fieldset>
      <section className="transaction-impact-preview" aria-label="Split impact preview">
        <h3>3. Preview after recalculation</h3>
        {error ? <p role="alert">{error}</p> : !projected ? <p>Complete the details to preview the split.</p> : (
          <>
            <p>{event.symbol}: {event.newShares} new for {event.oldShares} old shares. Preview includes later transactions.</p>
            <dl>
              <div><dt>Shares</dt><dd>{before?.quantity ?? 0} → {after?.quantity ?? 0}</dd></div>
              <div><dt>Remaining cost</dt><dd>{usd(before?.costUsd ?? 0)} → {usd(after?.costUsd ?? 0)}</dd></div>
              <div><dt>Average cost</dt><dd>{before ? usd(before.costUsd / before.quantity) : "—"} → {after ? usd(after.costUsd / after.quantity) : "—"}</dd></div>
              <div><dt>USD cash</dt><dd>{usd(current.usdCash)} → {usd(projected.usdCash)}</dd></div>
              <div><dt>Realized P&amp;L</dt><dd>{usd(current.realizedPnlUsd)} → {usd(projected.realizedPnlUsd)}</dd></div>
            </dl>
          </>
        )}
      </section>
      {saveError && <p role="alert">{saveError}</p>}
      <button type="submit" disabled={!projected || Boolean(error) || saving}>{saving ? "Saving…" : "Confirm and save split"}</button>
    </form>
  );
}
