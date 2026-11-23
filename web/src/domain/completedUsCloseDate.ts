const usTime = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

/** Calendar ceiling, not an exchange calendar: providers carry holidays back. */
export function completedUsCloseDate(now: Date = new Date()): string {
  const parts = Object.fromEntries(usTime.formatToParts(now).map(({ type, value }) => [type, value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  // The regular session ends at 16:00 ET. Allow another 15 minutes for the
  // delayed daily bar; early-close days conservatively wait until then too.
  if (Number(parts.hour) * 60 + Number(parts.minute) >= 16 * 60 + 15) return date;
  const previousDate = new Date(`${date}T12:00:00Z`);
  previousDate.setUTCDate(previousDate.getUTCDate() - 1);
  return previousDate.toISOString().slice(0, 10);
}
