import { addLocalDays, daysBetween, isLocalDate, localDate } from "@/lib/modules/calendar/calendar.time";
import { CLOSED_STATUSES, type MilestoneStatus } from "./planning.types";

/**
 * Planning date rules (PRD #44 §15-§20, §44-§46, §67, §162, §279, §280). Pure and client-safe.
 *
 * Milestone dates are business dates: a calendar day in the company's zone,
 * stored at midday UTC so it is the same day everywhere. Baseline is the
 * approved reference, planned the current target, forecast the current
 * expectation and actual what happened; none of them ever moves another.
 */

export type DatedMilestone = {
  status: MilestoneStatus;
  baselineDate: string | null;
  plannedDate: string | null;
  forecastDate: string | null;
  actualDate: string | null;
};

export function businessInstant(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

export function dateOf(instant: Date | null | undefined): string | null {
  return instant ? instant.toISOString().slice(0, 10) : null;
}

export function isClosed(status: MilestoneStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

/** What the milestone is aiming at now: forecast, else planned, else baseline. */
export function targetDateOf(milestone: Pick<DatedMilestone, "baselineDate" | "plannedDate" | "forecastDate">): string | null {
  return milestone.forecastDate ?? milestone.plannedDate ?? milestone.baselineDate;
}

/** The one date a list or calendar shows: actual, else the target (§20, §67). */
export function displayDateOf(milestone: DatedMilestone): string | null {
  return milestone.actualDate ?? targetDateOf(milestone);
}

/**
 * Days from the baseline (§45, §279): the actual date once completed, else the
 * forecast (or planned). Positive is late; null without a baseline.
 */
export function varianceDaysOf(milestone: DatedMilestone): number | null {
  if (!milestone.baselineDate) return null;
  const reference = milestone.status === "COMPLETED" ? milestone.actualDate : (milestone.forecastDate ?? milestone.plannedDate);
  return reference ? daysBetween(milestone.baselineDate, reference) : null;
}

/** Delayed is derived, whatever the status says (§44). */
export function isDelayed(milestone: DatedMilestone, today: string): boolean {
  if (isClosed(milestone.status)) return false;
  const target = targetDateOf(milestone);
  return Boolean(target && target < today);
}

export function overdueDaysOf(milestone: DatedMilestone, today: string): number {
  const target = targetDateOf(milestone);
  return isDelayed(milestone, today) && target ? daysBetween(target, today) : 0;
}

/** "+12 days", "-3 days", "On baseline" (§46). */
export function varianceLabel(days: number | null): string {
  if (days === null) return "No baseline";
  if (days === 0) return "On baseline";
  const size = Math.abs(days);
  return `${days > 0 ? "+" : "-"}${size} ${size === 1 ? "day" : "days"}`;
}

export function shortVariance(days: number | null): string {
  if (days === null || days === 0) return days === 0 ? "0d" : "";
  return `${days > 0 ? "+" : "-"}${Math.abs(days)}d`;
}

/**
 * The earliest date a successor could be forecast for, given what it waits on
 * (§162): each predecessor's target (or actual) plus its lag. A suggestion;
 * nothing is rescheduled.
 */
export function earliestAfter(predecessors: Array<DatedMilestone & { lagDays: number }>): string | null {
  let earliest: string | null = null;
  for (const predecessor of predecessors) {
    if (predecessor.status === "CANCELLED") continue;
    const date = predecessor.actualDate ?? targetDateOf(predecessor);
    if (!date) continue;
    const candidate = addLocalDays(date, predecessor.lagDays);
    if (!earliest || candidate > earliest) earliest = candidate;
  }
  return earliest;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "30 Oct 2026" — spelled out, so the server and every browser agree. */
export function dateLabel(date: string | null): string {
  if (!date) return "—";
  const [year, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** "30 Oct". */
export function shortDateLabel(date: string | null): string {
  if (!date) return "—";
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]}`;
}

export function monthLabel(date: string): string {
  const [year, month] = date.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

export { addLocalDays, daysBetween, isLocalDate, localDate, MONTHS };
