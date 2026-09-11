/**
 * Small HR display helpers (PRD #16 §311, §312).
 *
 * Presentation only — every figure here was already decided by a service. The
 * status vocabulary itself lives in `hr.status.ts`, so a label never differs
 * between the table, the report and the API.
 */

/** `465` → `7h 45m`. Worked minutes are derived server-side (PRD #16 §106). */
export function formatWorkedMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Times arrive from the DTO already as `HH:MM` (PRD #16 §105). */
export function formatTimeOfDay(value: string | null): string {
  return value ?? "—";
}

/** `4.00` → `4`, `0.50` → `0.5`. Days are decimal strings, never floats. */
export function formatDays(value: string): string {
  if (!value.includes(".")) return value;
  return value.replace(/0+$/, "").replace(/\.$/, "");
}
