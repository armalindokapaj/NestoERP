/**
 * The browser's own calendar day, `YYYY-MM-DD` (AUD-09 §4, FV-07).
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC day — yesterday for
 * anyone east of Greenwich in the first hours after midnight — and it was the
 * default of several date fields. A page that knows the company's day passes
 * it (`companyToday`); this is the fallback when it does not.
 */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}
