import { describe, expect, it } from "vitest";
import { parseLedgerCsv } from "./parseLedgerCsv";

describe("parseLedgerCsv", () => {
  it("reads a BOM, CRLF, quoted notes, and out-of-order transactions", () => {
    const events = parseLedgerCsv(
      '\uFEFFid,occurredAt,accountId,type,amountCny,note\r\n' +
      'later,2026-02-02,anonymous,CNY_DEPOSIT,200,"Transfer, part ""B"""\r\n' +
      'earlier,2026-02-01,anonymous,CNY_DEPOSIT,300,first\r\n',
    );
    expect(events.map((event) => event.id)).toEqual(["earlier", "later"]);
    expect(events[1].note).toBe('Transfer, part "B"');
  });

  it("rejects missing columns, invalid fields, and malformed quoting", () => {
    expect(() => parseLedgerCsv("id,type\na,CNY_DEPOSIT")).toThrow(/needs id/);
    expect(() => parseLedgerCsv("id,occurredAt,accountId,type,amountCny\na,2026-01-01,anonymous,CNY_DEPOSIT,nope"))
      .toThrow(/invalid amountCny/);
    expect(() => parseLedgerCsv('id,occurredAt,accountId,type,note\na,2026-01-01,anonymous,CNY_DEPOSIT,"unfinished'))
      .toThrow(/unclosed quoted/);
  });
});
