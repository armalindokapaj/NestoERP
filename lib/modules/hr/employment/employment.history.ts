import type {
  EmploymentAssignmentReason,
  EmploymentHistorySource,
  EmploymentStatus,
  EmploymentStatusReason,
  EmploymentType,
  Prisma,
  WorkLocationType,
} from "@prisma/client";

import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { auditContextFromUser, recordAuditEvent } from "@/lib/core/audit/audit.service";
import type { RecordAuditInput } from "@/lib/core/audit/audit.types";
import { setMemberPlacement } from "@/lib/modules/team/departments/branch.doors";
import type { PlacementDoor } from "@/lib/modules/team/team.placement";
import { addDays, businessTimestamp, dayOf, dbDay, todayDay, type Day } from "./employment.dates";

/**
 * The employment history engine (E-03 §7, §9-§12, §38-§41, §180, §181; ADR 0004).
 *
 * Every write to an employment's organizational state goes through here, inside
 * the caller's transaction, after the caller has locked the employment:
 *
 *   - a change closes the open row the day before it takes effect and opens the
 *     next; a change taking effect the day the open row began replaces that row
 *     instead, which stays, superseded, naming its replacement (§7, §43);
 *   - nothing is ever updated in place except closing a row and marking one
 *     superseded, and the database refuses two open rows or two overlapping
 *     ones among those still standing (§40, §41, §89);
 *   - the employment's current fields are then recomputed from the rows, so
 *     they cannot say anything the history does not (§180, §181).
 *
 * Authority is the caller's: nothing here checks a permission. The one rule
 * here is time: a change cannot take effect before the period it would close
 * began — that is a correction, and corrections have their own service (§86,
 * §88).
 */

export type Placement = {
  departmentId: string | null;
  jobTitle: string | null;
  managerMemberId: string | null;
  workLocationType: WorkLocationType | null;
  workLocation: string | null;
  employmentType: EmploymentType;
};

export type PlacementPatch = Partial<Placement>;

const PLACEMENT_KEYS = ["departmentId", "jobTitle", "managerMemberId", "workLocationType", "workLocation", "employmentType"] as const;

/** Who writes history: an HR member (or a member whose Team or Organization change is being recorded), or the worker. */
export type HistoryActor = { kind: "member"; context: UserContext } | { kind: "system"; companyId: string; onBehalfOfUserId: string | null };

export function actorUserId(actor: HistoryActor): string | null {
  return actor.kind === "member" ? actor.context.userId : actor.onBehalfOfUserId;
}

/** Audit in the employment's company, as the member or as the system (PRD #28 §15). */
export async function auditEmployment(tx: Prisma.TransactionClient, actor: HistoryActor, companyId: string, input: RecordAuditInput): Promise<void> {
  if (actor.kind === "member" && actor.context.companyId === companyId) {
    await recordAuditEvent(auditContextFromUser(actor.context), input, { tx });
    return;
  }
  await recordAuditEvent(
    {
      companyId,
      actor: actor.kind === "member" ? { type: "USER", userId: actor.context.userId, memberId: null, displayNameSnapshot: actor.context.fullName, roleSnapshot: actor.context.role } : { type: "SYSTEM" },
    },
    input,
    { tx },
  );
}

/* -------------------------------------------------------------------------- */
/* Rows                                                                        */
/* -------------------------------------------------------------------------- */

export const ASSIGNMENT_ROW = {
  id: true,
  startDate: true,
  endDate: true,
  departmentId: true,
  departmentName: true,
  jobTitle: true,
  managerMemberId: true,
  managerName: true,
  workLocationType: true,
  workLocation: true,
  employmentType: true,
  reason: true,
  source: true,
  sourceDocumentId: true,
} satisfies Prisma.EmploymentAssignmentSelect;

export type AssignmentRow = Prisma.EmploymentAssignmentGetPayload<{ select: typeof ASSIGNMENT_ROW }>;

export const STATUS_ROW = {
  id: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  reason: true,
  source: true,
} satisfies Prisma.EmploymentStatusHistorySelect;

export type StatusRow = Prisma.EmploymentStatusHistoryGetPayload<{ select: typeof STATUS_ROW }>;

/** Serializes every history write for one employment (E-03 §40, §207). */
export async function lockEmployment(tx: Prisma.TransactionClient, employmentId: string): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "employee_profiles" WHERE "id" = ${employmentId} FOR UPDATE`;
}

export function openAssignment(tx: Prisma.TransactionClient, employmentId: string): Promise<AssignmentRow | null> {
  return tx.employmentAssignment.findFirst({ where: { employeeProfileId: employmentId, endDate: null, supersededAt: null, isPrimary: true }, select: ASSIGNMENT_ROW });
}

export function openStatus(tx: Prisma.TransactionClient, employmentId: string): Promise<StatusRow | null> {
  return tx.employmentStatusHistory.findFirst({ where: { employeeProfileId: employmentId, effectiveTo: null, supersededAt: null }, select: STATUS_ROW });
}

/** The latest closed row, for a rehire that continues where the last period left off. */
export function lastAssignment(tx: Prisma.TransactionClient, employmentId: string): Promise<AssignmentRow | null> {
  return tx.employmentAssignment.findFirst({ where: { employeeProfileId: employmentId, supersededAt: null, isPrimary: true }, orderBy: { startDate: "desc" }, select: ASSIGNMENT_ROW });
}

export function placementOf(row: AssignmentRow): Placement {
  return {
    departmentId: row.departmentId,
    jobTitle: row.jobTitle,
    managerMemberId: row.managerMemberId,
    workLocationType: row.workLocationType,
    workLocation: row.workLocation,
    employmentType: row.employmentType,
  };
}

/** What changed, field by field, for the audit and the timeline. */
export function placementDiff(before: Placement | null, after: Placement): PlacementKey[] {
  return PLACEMENT_KEYS.filter((key) => (before?.[key] ?? null) !== (after[key] ?? null));
}

export type PlacementKey = (typeof PLACEMENT_KEYS)[number];

/** Names as they read on the day, so a later rename does not rewrite history (E-03 §19). */
async function snapshots(tx: Prisma.TransactionClient, companyId: string, placement: Placement): Promise<{ departmentName: string | null; managerName: string | null }> {
  const [department, manager] = await Promise.all([
    placement.departmentId ? tx.department.findFirst({ where: { id: placement.departmentId, companyId }, select: { name: true } }) : null,
    placement.managerMemberId ? tx.companyMember.findFirst({ where: { id: placement.managerMemberId, companyId }, select: { user: { select: { firstName: true, lastName: true } } } }) : null,
  ]);
  return { departmentName: department?.name ?? null, managerName: manager ? `${manager.user.firstName} ${manager.user.lastName}` : null };
}

/** Violations of the history tables' own guards, as the conflict they are (E-03 §207, §248). */
export function historyRaced(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (
    (error as { code?: string } | null)?.code === "P2002" ||
    /employment_(assignments|status_history)_(no_overlap|one_open|dates_check)/.test(message)
  ) {
    throw new AccessError("CONFLICT", "The employment changed at the same moment. Refresh and review its history.", { code: "HISTORY_RACED" });
  }
  throw error;
}

type WriteMeta = {
  reason: EmploymentAssignmentReason;
  source: EmploymentHistorySource;
  documentId?: string | null;
  note?: string | null;
  actorUserId: string | null;
};

export type AssignmentWrite = { before: AssignmentRow | null; after: AssignmentRow; changed: PlacementKey[] };

/**
 * The next organizational state from `effective` on (E-03 §7, §13-§17, §30).
 * `null` when nothing would change.
 */
export async function writeAssignment(
  tx: Prisma.TransactionClient,
  input: { employmentId: string; companyId: string; patch: PlacementPatch; effective: Day; expectedAssignmentId?: string } & WriteMeta,
): Promise<AssignmentWrite | null> {
  const open = await openAssignment(tx, input.employmentId);
  if (input.expectedAssignmentId && open?.id !== input.expectedAssignmentId) {
    throw new AccessError("CONFLICT", "The employment changed since you opened it. Refresh and review the latest history.", { code: "STALE_ASSIGNMENT" });
  }
  if (!open) throw new AccessError("CONFLICT", "This employment has no current assignment to change.", { code: "NO_OPEN_ASSIGNMENT" });

  const before = placementOf(open);
  const after: Placement = { ...before };
  for (const key of PLACEMENT_KEYS) {
    if (input.patch[key] !== undefined) (after as Record<PlacementKey, unknown>)[key] = input.patch[key];
  }
  const changed = placementDiff(before, after);
  if (changed.length === 0 && !input.documentId) return null;

  const openStart = dayOf(open.startDate);
  if (input.effective < openStart) {
    throw new AccessError("CONFLICT", `The current assignment began on ${openStart}. An earlier change is a correction of the history.`, { code: "BEFORE_CURRENT_PERIOD" });
  }

  if (input.effective === openStart) {
    await supersede(tx, "assignment", open.id, input.companyId, input.actorUserId);
  } else {
    const closed = await tx.employmentAssignment.updateMany({
      where: { id: open.id, companyId: input.companyId, endDate: null, supersededAt: null },
      data: { endDate: dbDay(addDays(input.effective, -1)) },
    });
    if (closed.count !== 1) throw new AccessError("CONFLICT", "The employment changed at the same moment. Refresh and review its history.", { code: "HISTORY_RACED" });
  }

  const created = await createAssignment(tx, {
    employmentId: input.employmentId,
    companyId: input.companyId,
    placement: after,
    startDate: input.effective,
    endDate: null,
    reason: input.reason,
    source: input.source,
    documentId: input.documentId,
    note: input.note,
    actorUserId: input.actorUserId,
    correctsId: input.effective === openStart ? open.id : null,
  });
  return { before: open, after: created, changed };
}

async function createAssignment(
  tx: Prisma.TransactionClient,
  input: { employmentId: string; companyId: string; placement: Placement; startDate: Day; endDate: Day | null; correctsId?: string | null; correctionReason?: string | null } & WriteMeta,
): Promise<AssignmentRow> {
  const names = await snapshots(tx, input.companyId, input.placement);
  return tx.employmentAssignment.create({
    data: {
      companyId: input.companyId,
      employeeProfileId: input.employmentId,
      ...input.placement,
      ...names,
      startDate: dbDay(input.startDate),
      endDate: input.endDate ? dbDay(input.endDate) : null,
      reason: input.reason,
      source: input.source,
      sourceDocumentId: input.documentId ?? null,
      note: input.note ?? null,
      createdByUserId: input.actorUserId,
      correctsId: input.correctsId ?? null,
      correctionReason: input.correctionReason ?? null,
    },
    select: ASSIGNMENT_ROW,
  });
}

/** A standing row replaced (E-03 §43): kept, marked, never deleted. */
export async function supersede(tx: Prisma.TransactionClient, kind: "assignment" | "status", id: string, companyId: string, actorUserId: string | null): Promise<void> {
  const done =
    kind === "assignment"
      ? await tx.employmentAssignment.updateMany({ where: { id, companyId, supersededAt: null }, data: { supersededAt: new Date(), supersededByUserId: actorUserId } })
      : await tx.employmentStatusHistory.updateMany({ where: { id, companyId, supersededAt: null }, data: { supersededAt: new Date(), supersededByUserId: actorUserId } });
  if (done.count !== 1) throw new AccessError("CONFLICT", "The employment changed at the same moment. Refresh and review its history.", { code: "HISTORY_RACED" });
}

/** A row written with given dates and values: a correction's replacement, or a new employment's first. */
export async function insertAssignment(
  tx: Prisma.TransactionClient,
  input: { employmentId: string; companyId: string; placement: Placement; startDate: Day; endDate: Day | null; correctsId?: string | null; correctionReason?: string | null } & WriteMeta,
): Promise<AssignmentRow> {
  return createAssignment(tx, input);
}

/** Ends the open assignment on `lastDay` (termination, transfer out, E-03 §91). */
export async function closeAssignment(tx: Prisma.TransactionClient, employmentId: string, companyId: string, lastDay: Day): Promise<AssignmentRow> {
  const open = await openAssignment(tx, employmentId);
  if (!open) throw new AccessError("CONFLICT", "This employment has no current assignment.", { code: "NO_OPEN_ASSIGNMENT" });
  if (lastDay < dayOf(open.startDate)) {
    throw new AccessError("CONFLICT", `The current assignment began on ${dayOf(open.startDate)}; the last day cannot be before it.`, { code: "BEFORE_CURRENT_PERIOD" });
  }
  await tx.employmentAssignment.updateMany({ where: { id: open.id, companyId, endDate: null, supersededAt: null }, data: { endDate: dbDay(lastDay) } });
  return open;
}

export type StatusWrite = { before: StatusRow | null; after: StatusRow };

/** The employment's status from `effective` on (E-03 §22, §23, §102, §103). */
export async function writeStatus(
  tx: Prisma.TransactionClient,
  input: {
    employmentId: string;
    companyId: string;
    status: EmploymentStatus;
    effective: Day;
    reason: EmploymentStatusReason;
    privateReason?: string | null;
    documentId?: string | null;
    source: EmploymentHistorySource;
    actorUserId: string | null;
  },
): Promise<StatusWrite> {
  const open = await openStatus(tx, input.employmentId);
  if (open) {
    const from = dayOf(open.effectiveFrom);
    if (input.effective < from) {
      throw new AccessError("CONFLICT", `The current status began on ${from}. An earlier change is a correction of the history.`, { code: "BEFORE_CURRENT_PERIOD" });
    }
    if (input.effective === from) {
      await supersede(tx, "status", open.id, input.companyId, input.actorUserId);
    } else {
      const closed = await tx.employmentStatusHistory.updateMany({
        where: { id: open.id, companyId: input.companyId, effectiveTo: null, supersededAt: null },
        data: { effectiveTo: dbDay(addDays(input.effective, -1)) },
      });
      if (closed.count !== 1) throw new AccessError("CONFLICT", "The employment changed at the same moment. Refresh and review its history.", { code: "HISTORY_RACED" });
    }
  }
  const after = await tx.employmentStatusHistory.create({
    data: {
      companyId: input.companyId,
      employeeProfileId: input.employmentId,
      status: input.status,
      effectiveFrom: dbDay(input.effective),
      reason: input.reason,
      privateReason: input.privateReason ?? null,
      sourceDocumentId: input.documentId ?? null,
      source: input.source,
      createdByUserId: input.actorUserId,
      correctsId: open && dayOf(open.effectiveFrom) === input.effective ? open.id : null,
    },
    select: STATUS_ROW,
  });
  return { before: open, after };
}

export async function insertStatus(
  tx: Prisma.TransactionClient,
  input: {
    employmentId: string;
    companyId: string;
    status: EmploymentStatus;
    effectiveFrom: Day;
    effectiveTo: Day | null;
    reason: EmploymentStatusReason;
    privateReason?: string | null;
    documentId?: string | null;
    source: EmploymentHistorySource;
    actorUserId: string | null;
    correctsId?: string | null;
    correctionReason?: string | null;
  },
): Promise<StatusRow> {
  return tx.employmentStatusHistory.create({
    data: {
      companyId: input.companyId,
      employeeProfileId: input.employmentId,
      status: input.status,
      effectiveFrom: dbDay(input.effectiveFrom),
      effectiveTo: input.effectiveTo ? dbDay(input.effectiveTo) : null,
      reason: input.reason,
      privateReason: input.privateReason ?? null,
      sourceDocumentId: input.documentId ?? null,
      source: input.source,
      createdByUserId: input.actorUserId,
      correctsId: input.correctsId ?? null,
      correctionReason: input.correctionReason ?? null,
    },
    select: STATUS_ROW,
  });
}

/* -------------------------------------------------------------------------- */
/* New employments                                                             */
/* -------------------------------------------------------------------------- */

/** The first rows of a new employment (E-03 §8, §183): where they start, and planned or started. */
export async function startHistory(
  tx: Prisma.TransactionClient,
  input: {
    employmentId: string;
    companyId: string;
    placement: Placement;
    start: Day;
    status: "PLANNED" | "ACTIVE";
    statusFrom: Day;
    assignmentReason: EmploymentAssignmentReason;
    statusReason: EmploymentStatusReason;
    source: EmploymentHistorySource;
    documentId?: string | null;
    actorUserId: string | null;
  },
): Promise<AssignmentRow> {
  const row = await createAssignment(tx, {
    employmentId: input.employmentId,
    companyId: input.companyId,
    placement: input.placement,
    startDate: input.start,
    endDate: null,
    reason: input.assignmentReason,
    source: input.source,
    documentId: input.documentId,
    actorUserId: input.actorUserId,
  });
  await insertStatus(tx, {
    employmentId: input.employmentId,
    companyId: input.companyId,
    status: input.status,
    effectiveFrom: input.statusFrom,
    effectiveTo: null,
    reason: input.statusReason,
    documentId: input.documentId,
    source: input.source,
    actorUserId: input.actorUserId,
  });
  return row;
}

/* -------------------------------------------------------------------------- */
/* The current state                                                           */
/* -------------------------------------------------------------------------- */

const PERIOD_START_REASONS: EmploymentStatusReason[] = ["HIRE", "REHIRE", "LEGAL_ENTITY_TRANSFER"];

export type EmploymentCache = Placement & { employmentStatus: EmploymentStatus; startDate: Day | null; endDate: Day | null };

/**
 * What the employment's current fields must say, derived from its rows
 * (E-03 §180, §181). The start date is where the current period began — the
 * planned start while it is only planned — and the end date the last day worked
 * once it has ended; a planned end date on a running employment is a term of
 * the contract, not history, and is left as HR set it.
 */
export async function deriveCache(tx: Prisma.TransactionClient, employmentId: string, keepEndDate: Date | null): Promise<EmploymentCache | null> {
  const [assignment, status] = await Promise.all([openAssignment(tx, employmentId), openStatus(tx, employmentId)]);
  // A plan withdrawn before it began leaves no standing row; its values are still what the employment was.
  const latest =
    assignment ??
    (await lastAssignment(tx, employmentId)) ??
    (await tx.employmentAssignment.findFirst({ where: { employeeProfileId: employmentId, isPrimary: true }, orderBy: [{ startDate: "desc" }, { createdAt: "desc" }], select: ASSIGNMENT_ROW }));
  if (!latest || !status) return null;

  let startDate: Day | null;
  if (status.status === "PLANNED") {
    startDate = dayOf(latest.startDate);
  } else {
    const periodStart =
      (await tx.employmentStatusHistory.findFirst({
        where: { employeeProfileId: employmentId, supersededAt: null, status: "ACTIVE", reason: { in: PERIOD_START_REASONS }, effectiveFrom: { lte: status.effectiveFrom } },
        orderBy: { effectiveFrom: "desc" },
        select: { effectiveFrom: true },
      })) ??
      (await tx.employmentStatusHistory.findFirst({
        where: { employeeProfileId: employmentId, supersededAt: null, status: { in: ["ACTIVE", "ON_LEAVE", "SUSPENDED"] }, effectiveFrom: { lte: status.effectiveFrom } },
        orderBy: { effectiveFrom: "asc" },
        select: { effectiveFrom: true },
      }));
    // Never started (a withdrawn plan): no start, and no last day either.
    startDate = periodStart ? dayOf(periodStart.effectiveFrom) : null;
  }
  const endDate = status.status === "ENDED" ? (startDate ? addDays(dayOf(status.effectiveFrom), -1) : null) : keepEndDate ? dayOf(keepEndDate) : null;
  return { ...placementOf(latest), employmentStatus: status.status, startDate, endDate };
}

/** Writes the derived current state onto the employment. */
export async function syncCache(
  tx: Prisma.TransactionClient,
  employment: { id: string; companyId: string },
  options: { clearPlannedEnd?: boolean; actorMemberId?: string | null } = {},
): Promise<EmploymentCache> {
  const current = await tx.employeeProfile.findFirstOrThrow({ where: { id: employment.id, companyId: employment.companyId }, select: { endDate: true, employmentStatus: true } });
  const keep = options.clearPlannedEnd || current.employmentStatus === "ENDED" ? null : current.endDate;
  const cache = await deriveCache(tx, employment.id, keep);
  if (!cache) throw new AccessError("CONFLICT", "This employment has no history to derive its current state from.", { code: "NO_HISTORY" });
  // From the status it was read in: a write that raced it is refused, not layered over.
  const written = await tx.employeeProfile.updateMany({
    where: { id: employment.id, companyId: employment.companyId, employmentStatus: current.employmentStatus },
    data: {
      departmentId: cache.departmentId,
      jobTitle: cache.jobTitle,
      managerMemberId: cache.managerMemberId,
      workLocationType: cache.workLocationType,
      workLocation: cache.workLocation,
      employmentType: cache.employmentType,
      employmentStatus: cache.employmentStatus,
      startDate: cache.startDate ? businessTimestamp(cache.startDate) : null,
      endDate: cache.endDate ? businessTimestamp(cache.endDate) : null,
      updatedByMemberId: options.actorMemberId,
    },
  });
  if (written.count !== 1) throw new AccessError("CONFLICT", "The employment changed at the same moment. Refresh and review its history.", { code: "HISTORY_RACED" });
  return cache;
}

/* -------------------------------------------------------------------------- */
/* The membership                                                              */
/* -------------------------------------------------------------------------- */

/**
 * HR → Team (ADR 0004 decision 7). A login employed here is placed where the
 * employment says: the membership's department and title follow, and the
 * organization keeps the department's team true to the move through the door
 * the caller passed in. Ended employment governs nothing.
 */
export async function mirrorToMembership(
  tx: Prisma.TransactionClient,
  input: { employmentId: string; companyId: string; placement: PlacementDoor; actor: UserContext | null },
): Promise<void> {
  const employment = await tx.employeeProfile.findFirstOrThrow({
    where: { id: input.employmentId, companyId: input.companyId },
    select: { companyId: true, departmentId: true, jobTitle: true, employmentStatus: true, companyMember: { select: { id: true, userId: true, departmentId: true, jobTitle: true } } },
  });
  const member = employment.companyMember;
  if (!member || employment.employmentStatus === "ENDED") return;
  if (member.departmentId === employment.departmentId && member.jobTitle === employment.jobTitle) return;
  await setMemberPlacement(tx, { companyId: employment.companyId, memberId: member.id, departmentId: employment.departmentId, jobTitle: employment.jobTitle });
  if (member.departmentId !== employment.departmentId) {
    await input.placement(tx, {
      companyId: employment.companyId,
      userId: member.userId,
      fromDepartmentId: member.departmentId,
      toDepartmentId: employment.departmentId,
      actor: input.actor && input.actor.companyId === employment.companyId ? input.actor : null,
    });
  }
}

/**
 * Team or the Organization → HR (ADR 0004 decision 7; E-03 §187). A
 * membership's department or title changed outside HR — Team's member edit, a
 * department's team in the Organization, an account provisioned — and the
 * person has a running employment on that login: the change is recorded in the
 * employment's history, effective today, rather than lost (§7). A planned
 * employment's plan is revised instead. Nothing to record, nothing written.
 */
export async function followMembership(
  tx: Prisma.TransactionClient,
  input: { companyId: string; userId: string; actor: UserContext | null },
): Promise<void> {
  const member = await tx.companyMember.findFirst({
    where: { companyId: input.companyId, userId: input.userId },
    select: { id: true, departmentId: true, jobTitle: true, employeeProfile: { select: { id: true, companyId: true, employmentStatus: true, departmentId: true, jobTitle: true } } },
  });
  const employment = member?.employeeProfile;
  if (!member || !employment || employment.employmentStatus === "ENDED" || employment.companyId !== input.companyId) return;
  if (employment.departmentId === member.departmentId && employment.jobTitle === member.jobTitle) return;

  await lockEmployment(tx, employment.id);
  const open = await openAssignment(tx, employment.id);
  if (!open) return;
  const today = todayDay();
  const openStart = dayOf(open.startDate);
  const effective = employment.employmentStatus === "PLANNED" || openStart > today ? openStart : today;
  const departmentMoved = employment.departmentId !== member.departmentId;
  const actorId = input.actor?.userId ?? null;
  const write = await writeAssignment(tx, {
    employmentId: employment.id,
    companyId: input.companyId,
    patch: { departmentId: member.departmentId, jobTitle: member.jobTitle },
    effective,
    reason: departmentMoved ? "DEPARTMENT_TRANSFER" : "TITLE_CHANGE",
    source: "SYNC",
    actorUserId: actorId,
  }).catch(historyRaced);
  if (!write) return;
  await syncCache(tx, { id: employment.id, companyId: input.companyId }, { actorMemberId: input.actor && input.actor.companyId === input.companyId ? input.actor.membershipId : undefined });
  await auditEmployment(tx, input.actor ? { kind: "member", context: input.actor } : { kind: "system", companyId: input.companyId, onBehalfOfUserId: null }, input.companyId, {
    actionKey: AuditAction.HR_EMPLOYMENT_ASSIGNMENT_CHANGED,
    entity: { type: "EmployeeProfile", id: employment.id, label: write.after.jobTitle ?? "Employment" },
    before: assignmentFacts(write.before),
    after: { ...assignmentFacts(write.after), effectiveDate: effective, source: "SYNC", changeType: departmentMoved ? "DEPARTMENT_TRANSFER" : "POSITION_CHANGE" },
  });
}

/** The safe facts of an assignment for the audit trail (E-03 §136): ids, names on the day, dates. */
export function assignmentFacts(row: AssignmentRow | null): Record<string, unknown> {
  if (!row) return {};
  return {
    assignmentId: row.id,
    departmentId: row.departmentId,
    departmentName: row.departmentName,
    jobTitle: row.jobTitle,
    managerMemberId: row.managerMemberId,
    managerName: row.managerName,
    workLocationType: row.workLocationType,
    workLocation: row.workLocation,
    employmentType: row.employmentType,
    startDate: dayOf(row.startDate),
    endDate: row.endDate ? dayOf(row.endDate) : null,
    reason: row.reason,
    documentId: row.sourceDocumentId,
  };
}
