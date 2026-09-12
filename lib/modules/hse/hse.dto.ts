import { can } from "@/lib/access/can";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import type { InjuryFlags, MemberRef, ProjectRef } from "./hse.types";

/**
 * Turning rows into DTOs (PRD #22 §21, §22).
 *
 * Redaction is absence, not a flag. A reader who may not see an incident's
 * injury flags receives `injury: null` — not a set of booleans with the true
 * ones removed, which would still say an injury happened.
 */

type MemberRow = {
  id: string;
  status?: string;
  user: { firstName: string; lastName: string };
} | null;

export function toMemberRef(row: MemberRow | undefined): MemberRef | null {
  if (!row) return null;
  return {
    memberId: row.id,
    fullName: `${row.user.firstName} ${row.user.lastName}`,
    active: row.status === undefined ? true : row.status === "ACTIVE",
  };
}

export async function loadMemberRef(memberId: string | null): Promise<MemberRef | null> {
  if (!memberId) return null;
  const row = await prisma.companyMember.findUnique({
    where: { id: memberId },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });
  return toMemberRef(row);
}

/** Loads several members at once, so a list does not fire one query per row. */
export async function loadMembers(
  ids: (string | null | undefined)[],
): Promise<Map<string, MemberRef>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();

  const rows = await prisma.companyMember.findMany({
    where: { id: { in: wanted } },
    select: { id: true, status: true, user: { select: { firstName: true, lastName: true } } },
  });

  return new Map(rows.map((row) => [row.id, toMemberRef(row)!]));
}

export function toProjectRef(
  row: { id: string; code: string; name: string } | null | undefined,
): ProjectRef | null {
  return row ? { id: row.id, code: row.code, name: row.name } : null;
}

export function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

/**
 * Whether a date has passed, for a record that is still open (PRD #22 §208).
 *
 * A closed record is never "overdue": the date it missed is history, and
 * flagging it forever would drown the list that matters.
 */
export function isOverdue(due: Date | null, stillOpen: boolean, today = new Date()): boolean {
  if (!due || !stillOpen) return false;
  return due.getTime() < today.setHours(0, 0, 0, 0);
}

/** Whole days a due date has been missed by, for the action report (§208). */
export function daysOverdue(due: Date | null, stillOpen: boolean, today = new Date()): number {
  if (!isOverdue(due, stillOpen, new Date(today))) return 0;
  const midnight = new Date(today);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor((midnight.getTime() - due!.getTime()) / 86_400_000);
}

/**
 * The operational injury flags on an incident (PRD #22 §22, §87).
 *
 * These are the boundary of what V0.1 stores about somebody being hurt:
 * whether it happened, whether first aid or treatment was needed, whether time
 * was lost. No diagnosis, no history, no notes — those belong to occupational
 * health, which NESTO does not have and should not imitate (PRD #22 §8).
 *
 * A reader without incident access gets `null` rather than a set of `false`s,
 * because a row of falses is itself an answer.
 */
export function toInjuryFlags(
  context: UserContext,
  row: {
    injuryOccurred: boolean;
    firstAidRequired: boolean;
    medicalTreatmentRequired: boolean;
    lostTime: boolean;
    propertyDamage: boolean;
    environmentalImpact: boolean;
  },
): InjuryFlags | null {
  if (!can(context, "hse.incident.view")) return null;

  return {
    injuryOccurred: row.injuryOccurred,
    firstAidRequired: row.firstAidRequired,
    medicalTreatmentRequired: row.medicalTreatmentRequired,
    lostTime: row.lostTime,
    propertyDamage: row.propertyDamage,
    environmentalImpact: row.environmentalImpact,
  };
}

/** The flags that are actually set, in the order a report reads them. */
export function injuryFlagLabels(flags: InjuryFlags): string[] {
  const labels: string[] = [];
  if (flags.injuryOccurred) labels.push("Injury");
  if (flags.firstAidRequired) labels.push("First aid");
  if (flags.medicalTreatmentRequired) labels.push("Medical treatment");
  if (flags.lostTime) labels.push("Lost time");
  if (flags.propertyDamage) labels.push("Property damage");
  if (flags.environmentalImpact) labels.push("Environmental impact");
  return labels;
}
