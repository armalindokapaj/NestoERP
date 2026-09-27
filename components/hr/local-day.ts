/**
 * Today as the person filling in a form lives it: the local calendar date, as
 * a `<input type="date">` value (AUD-09 §4, FV-07).
 *
 * `new Date().toISOString().slice(0, 10)` is the UTC date. In Tirana, from
 * midnight until one or two in the morning, that is still yesterday, so a
 * form defaulting to it offered the wrong day — and the server, which judges
 * "future" by the company's own day, could then disagree with the page.
 *
 * AUD-09: candidate for lib/forms — shared by the HR, HSE, QA/QC and
 * Workforce forms of this partition.
 */
export function localDay(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The local date and minute, as a `<input type="datetime-local">` value. */
export function localMinute(now: Date = new Date()): string {
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  return `${localDay(now)}T${hours}:${minutes}`;
}
