import { describe, expect, it } from "vitest";
import { completedUsCloseDate } from "./completedUsCloseDate";

describe("completed US close calendar ceiling", () => {
  it.each([
    ["2026-01-06T21:14:59Z", "2026-01-05"],
    ["2026-01-06T21:15:00Z", "2026-01-06"],
    ["2026-07-06T20:14:59Z", "2026-07-05"],
    ["2026-07-06T20:15:00Z", "2026-07-06"],
    ["2026-01-07T01:00:00Z", "2026-01-06"],
    ["2026-01-01T12:00:00Z", "2025-12-31"],
  ])("uses New York time and the closing delay at %s", (clock, expected) => {
    expect(completedUsCloseDate(new Date(clock))).toBe(expected);
  });
});
