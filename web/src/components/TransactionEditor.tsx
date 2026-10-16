import { useState, type FormEvent } from "react";
import { calculateBalances } from "../domain/calculateBalances";
import {
  buildLedgerEdit,
  getLedgerEditFields,
  ledgerEditValues,
  replaceLedgerEvent,
} from "../domain/editLedgerEvent";
import type { LedgerEvent } from "../domain/ledger";

const money = (value: number, currency = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);

interface Props {
  event: LedgerEvent;
  ledger: LedgerEvent[];
  onSave: (replacement: LedgerEvent) => boolean;
  onCancel: () => void;
}

export function TransactionEditor({ event, ledger, onSave, onCancel }: Props) {
  const [values, setValues] = useState(() => ledgerEditValues(event));
  const [saveError, setSaveError] = useState("");
  const fields = getLedgerEditFields(event);
  const current = calculateBalances(ledger);
  let replacement: LedgerEvent | undefined;
  let projected: ReturnType<typeof calculateBalances> | undefined;
  let error = "";
  try {
    replacement = buildLedgerEdit(event, values);
    projected = calculateBalances(replaceLedgerEvent(ledger, replacement));
  } catch (cause) {
    error =
      cause instanceof Error
        ? cause.message
        : "This edit would make the ledger invalid.";
  }
  const symbols = [
    ...new Set(
      [...current.positions, ...(projected?.positions ?? [])].map(
        (position) => position.symbol,
      ),
    ),
  ];
  const change = (key: string, value: string) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setSaveError("");
  };
  function submit(submitEvent: FormEvent<HTMLFormElement>) {
    submitEvent.preventDefault();
    if (!replacement || !projected || error) return;
    if (!onSave(replacement))
      setSaveError(
        "Changes were not saved. Review the message in Transactions.",
      );
  }

  return (
    <form
      className="unified-transaction-form transaction-edit-form"
      onSubmit={submit}
      aria-label="Edit transaction"
    >
      <h3>Edit transaction</h3>
      <p>
        Changes replace this record. Preview includes all later transactions.
        Export a backup before correcting substantial history.
      </p>
      <fieldset>
        <legend>Basic information</legend>
        <div className="transaction-form-grid">
          <label>
            Date
            <input
              type="date"
              value={values.occurredAt}
              required
              onChange={(e) => change("occurredAt", e.target.value)}
            />
          </label>
          <label>
            Account
            <input value={event.accountId} readOnly />
          </label>
          <label>
            Transaction type
            <input value={event.type} readOnly />
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Transaction details</legend>
        <div className="transaction-form-grid">
          {fields.map((field) => (
            <label key={field.key}>
              {field.label}
              {field.kind === "select" ? (
                <select
                  value={values[field.key]}
                  onChange={(e) => change(field.key, e.target.value)}
                >
                  {field.options?.map((option) => (
                    <option key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={field.kind}
                  value={values[field.key]}
                  required
                  step="any"
                  min={field.kind === "number" ? 0 : undefined}
                  onChange={(e) => change(field.key, e.target.value)}
                />
              )}
            </label>
          ))}
          <label>
            Note (optional)
            <textarea
              value={values.note ?? ""}
              onChange={(e) => change("note", e.target.value)}
            />
          </label>
        </div>
      </fieldset>
      <section
        className="transaction-impact-preview"
        aria-label="Edit impact preview"
        data-testid="edit-impact-preview"
      >
        <h3>Impact after recalculation</h3>
        {error ? (
          <p role="alert" className="transaction-impact-warning">
            {error}
          </p>
        ) : (
          projected && (
            <>
              <dl>
                <div>
                  <dt>CNY cash</dt>
                  <dd>
                    {money(current.cnyCash, "CNY")} →{" "}
                    {money(projected.cnyCash, "CNY")}
                  </dd>
                </div>
                <div>
                  <dt>HKD cash</dt>
                  <dd>
                    {money(current.hkdCash, "HKD")} →{" "}
                    {money(projected.hkdCash, "HKD")}
                  </dd>
                </div>
                <div>
                  <dt>USD cash</dt>
                  <dd>
                    {money(current.usdCash)} → {money(projected.usdCash)}
                  </dd>
                </div>
                <div>
                  <dt>Realized P&amp;L</dt>
                  <dd>
                    {money(current.realizedPnlUsd)} →{" "}
                    {money(projected.realizedPnlUsd)}
                  </dd>
                </div>
                <div>
                  <dt>Total fees</dt>
                  <dd>
                    {money(current.totalFeesUsd)} →{" "}
                    {money(projected.totalFeesUsd)}
                  </dd>
                </div>
              </dl>
              {symbols.map((symbol) => {
                const before = current.positions.find(
                  (position) => position.symbol === symbol,
                );
                const after = projected.positions.find(
                  (position) => position.symbol === symbol,
                );
                return (
                  <div key={symbol} className="edit-position-impact">
                    <h4>{symbol}</h4>
                    <dl>
                      <div>
                        <dt>Shares</dt>
                        <dd>
                          {before?.quantity ?? 0} → {after?.quantity ?? 0}
                        </dd>
                      </div>
                      <div>
                        <dt>Cost basis</dt>
                        <dd>
                          {money(before?.costUsd ?? 0)} →{" "}
                          {money(after?.costUsd ?? 0)}
                        </dd>
                      </div>
                      <div>
                        <dt>Average cost</dt>
                        <dd>
                          {before
                            ? money(before.costUsd / before.quantity)
                            : "—"}{" "}
                          →{" "}
                          {after ? money(after.costUsd / after.quantity) : "—"}
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </>
          )
        )}
      </section>
      {saveError && <p role="alert">{saveError}</p>}
      <div className="transaction-edit-actions">
        <button type="submit" disabled={!projected || Boolean(error)}>
          Save changes
        </button>
        <button type="button" onClick={onCancel}>
          Cancel editing
        </button>
      </div>
    </form>
  );
}
