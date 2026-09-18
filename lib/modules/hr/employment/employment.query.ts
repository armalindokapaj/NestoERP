import type { EmploymentStatus, Prisma } from "@prisma/client";

import { can, canAccessModule } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import { contextInCompany } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { employmentCapabilities } from "./employment.capabilities";
import * as repository from "../employees/employee.repository";
import { employmentStatusLabels, employmentTypeLabels } from "../hr.status";
import { hrScopeKind } from "../hr.scope";
import { dayOf, dbDay, type Day } from "./employment.dates";
import { changeTypeLabels, statusReasonLabels, workLocationTypeLabels } from "./employment.labels";
import type {
  AssignmentRowDTO,
  EmploymentHistoryDTO,
  HistoryDocumentDTO,
  HistoryView,
  PersonHistoryDTO,
  ScheduledChangeDTO,
  StatusRowDTO,
  TimelineChangeDTO,
  TimelineEventDTO,
} from "./employment.types";

/**
 * Reading employment history (E-03 §55-§62, §68-§73, §123-§131, §174, §175,
 * §178, §191-§195).
 *
 * Three readers. HR with `hr.employment_history.view`, inside HR's scope in the
 * employment's own company, sees every row, corrections and all, who made each
 * change, the scheduled changes, and — with `hr.employment_history.view_private`
 * — the private reasons. The employee sees their own history: what they held,
 * when and why, without HR's notes, private reasons, corrections or who made
 * them (§57, §128, §192). Everybody else sees the current profile and no
 * history (§56, §127, §191): there is no third view here. A supporting document
 * appears only when the reader may open it (§130, §131). `hr.employee.view` —
 * which the CEO holds — is the current record only; history is its own
 * permission (§59, §195).
 */

const ASSIGNMENT_SELECT = {
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
  note: true,
  createdByUserId: true,
  supersededAt: true,
  correctsId: true,
  correctionReason: true,
  createdAt: true,
} satisfies Prisma.EmploymentAssignmentSelect;

const STATUS_SELECT = {
  id: true,
  status: true,
  effectiveFrom: true,
  effectiveTo: true,
  reason: true,
  privateReason: true,
  source: true,
  sourceDocumentId: true,
  createdByUserId: true,
  supersededAt: true,
  correctsId: true,
  correctionReason: true,
  createdAt: true,
} satisfies Prisma.EmploymentStatusHistorySelect;

type AssignmentRecord = Prisma.EmploymentAssignmentGetPayload<{ select: typeof ASSIGNMENT_SELECT }>;
type StatusRecord = Prisma.EmploymentStatusHistoryGetPayload<{ select: typeof STATUS_SELECT }>;

type EmploymentHead = {
  id: string;
  companyId: string;
  companyMemberId: string | null;
  employmentStatus: EmploymentStatus;
  startDate: Date | null;
  endDate: Date | null;
  company: { id: string; name: string; legalName: string | null };
};

/**
 * Which view this reader has of one employment, judged in the employment's own
 * company. The person themselves sees their own — through their membership
 * there, or as the person when the employment has no login of theirs —
 * wherever self-service allows it; with no membership in that company, it is
 * still their own history (E-03 §57).
 */
export function historyViewOf(context: UserContext | null, employment: { companyId: string; companyMemberId: string | null; departmentId: string | null }, ownPerson: boolean): HistoryView | null {
  const inCompany = context !== null && context.companyId === employment.companyId;
  const ownMembership = inCompany && employment.companyMemberId !== null && employment.companyMemberId === context!.membershipId;
  if (inCompany && canAccessModule(context!, "hr")) {
    const kind = hrScopeKind(context!);
    const inScope = kind === "COMPANY" || ownMembership || (kind === "DEPARTMENT" && context!.department !== null && employment.departmentId === context!.department.id);
    if (inScope && can(context!, "hr.employment_history.view")) return "HR";
    if ((ownMembership || ownPerson) && can(context!, "hr.self.employment")) return "SELF";
    return null;
  }
  if (ownPerson && !inCompany) return "SELF";
  return null;
}

/** One employment's history, from HR's employee page (E-03 §58, §162) — with a login or without one (E-04 §86). */
export async function getEmploymentHistory(context: UserContext, employmentId: string): Promise<EmploymentHistoryDTO> {
  assertModule(context, "hr");
  const row = await repository.findEmployee(context, employmentId);
  if (!row) throw new AccessError("NOT_FOUND");
  const view = historyViewOf(context, { companyId: context.companyId, companyMemberId: row.companyMemberId, departmentId: row.department?.id ?? null }, false);
  // Somebody who may see the record but not its history (the CEO, a manager) is refused, not shown an empty history.
  if (!view) throw new AccessError("FORBIDDEN");
  const head = await prisma.employeeProfile.findFirstOrThrow({
    where: { id: row.id, companyId: context.companyId },
    select: { id: true, companyId: true, companyMemberId: true, employmentStatus: true, startDate: true, endDate: true, company: { select: { id: true, name: true, legalName: true } } },
  });
  return buildEmploymentHistory(context, head, view);
}

/**
 * A person's history across the group's companies, as far as this reader may
 * see each employment (E-03 §4, §5, §57, §58, §66, §67). Employments the reader
 * may not see are absent, not listed as hidden.
 */
export async function getPersonEmploymentHistory(session: UserContext, personId: string): Promise<PersonHistoryDTO> {
  const person = await prisma.personProfile.findFirst({
    where: { id: personId, parentGroupId: session.parentGroupId },
    select: { id: true, firstName: true, lastName: true, preferredName: true, user: { select: { id: true } } },
  });
  // Another group's person is not found, whatever id was sent (E-03 §5, §197).
  if (!person) throw new AccessError("NOT_FOUND");
  const ownPerson = person.user?.id === session.userId;

  const employments = await prisma.employeeProfile.findMany({
    where: { personProfileId: person.id, company: { parentGroupId: session.parentGroupId } },
    select: {
      id: true,
      companyId: true,
      companyMemberId: true,
      employmentStatus: true,
      startDate: true,
      endDate: true,
      company: { select: { id: true, name: true, legalName: true } },
      departmentId: true,
    },
    orderBy: [{ startDate: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
  });

  const contexts = new Map<string, UserContext | null>();
  const visible: EmploymentHistoryDTO[] = [];
  for (const employment of employments) {
    if (!contexts.has(employment.companyId)) contexts.set(employment.companyId, employment.companyId === session.companyId ? session : await contextInCompany(session, employment.companyId));
    const context = contexts.get(employment.companyId) ?? null;
    // Self-service is a permission too: somebody whose role has no HR self-service in their session sees none.
    if (ownPerson && !context && !can(session, "hr.self.employment")) continue;
    const view = historyViewOf(context, { companyId: employment.companyId, companyMemberId: employment.companyMemberId, departmentId: employment.departmentId }, ownPerson);
    if (!view) continue;
    visible.push(await buildEmploymentHistory(context, employment, view));
  }
  if (visible.length === 0) throw new AccessError("FORBIDDEN");

  const timeline = visible.flatMap((employment) => employment.timeline).sort(byNewest);
  return { personId: person.id, name: `${person.preferredName ?? person.firstName} ${person.lastName}`, isSelf: ownPerson, employments: visible, timeline };
}

/** Whether the person profile may offer an Employment history view to this reader (the tab's own check is the endpoint). */
export async function canViewPersonHistory(session: UserContext, personId: string): Promise<boolean> {
  try {
    await getPersonEmploymentHistory(session, personId);
    return true;
  } catch (error) {
    if (error instanceof AccessError) return false;
    throw error;
  }
}

async function buildEmploymentHistory(context: UserContext | null, head: EmploymentHead, view: HistoryView): Promise<EmploymentHistoryDTO> {
  const hr = view === "HR";
  const [assignments, statuses, scheduled] = await Promise.all([
    prisma.employmentAssignment.findMany({ where: { employeeProfileId: head.id, ...(hr ? {} : { supersededAt: null }) }, orderBy: [{ startDate: "asc" }, { createdAt: "asc" }], select: ASSIGNMENT_SELECT }),
    prisma.employmentStatusHistory.findMany({ where: { employeeProfileId: head.id, ...(hr ? {} : { supersededAt: null }) }, orderBy: [{ effectiveFrom: "asc" }, { createdAt: "asc" }], select: STATUS_SELECT }),
    hr
      ? prisma.employmentChange.findMany({
          where: { employeeProfileId: head.id },
          orderBy: [{ status: "asc" }, { effectiveDate: "asc" }],
          take: 50,
          select: { id: true, type: true, effectiveDate: true, status: true, payload: true, requestedByUserId: true, createdAt: true, failureReason: true, cancelReason: true },
        })
      : Promise.resolve([]),
  ]);

  // A document shows only if this reader may open it, here and now (§130, §131).
  const documentIds = [...new Set([...assignments, ...statuses].map((row) => row.sourceDocumentId).filter((id): id is string => Boolean(id)))];
  const documents = new Map<string, HistoryDocumentDTO>();
  if (context && context.companyId === head.companyId) {
    for (const id of documentIds) {
      const document = await findReadableDocument(context, id);
      if (document) documents.set(id, { id: document.id, name: document.name, href: `/documents/${document.id}` });
    }
  }

  const userIds = hr ? [...new Set([...assignments, ...statuses].map((row) => row.createdByUserId).concat(scheduled.map((row) => row.requestedByUserId)).filter((id): id is string => Boolean(id)))] : [];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
  const names = new Map(users.map((user) => [user.id, `${user.firstName} ${user.lastName}`]));
  const privateReasons = hr && context !== null && can(context, "hr.employment_history.view_private");

  const assignmentDTOs = assignments.map((row) => assignmentDTO(row, hr, documents, names));
  const statusDTOs = statuses.map((row) => statusDTO(row, hr, privateReasons, documents, names));
  const standingAssignments = assignments.filter((row) => !row.supersededAt);
  const standingStatuses = statuses.filter((row) => !row.supersededAt);
  const current = assignmentDTOs.find((row) => row.endDate === null && row.supersededAt === null) ?? null;

  return {
    view,
    employment: {
      id: head.id,
      memberId: head.companyMemberId,
      company: head.company,
      status: head.employmentStatus,
      startDate: head.startDate ? dayOf(head.startDate) : null,
      endDate: head.endDate ? dayOf(head.endDate) : null,
    },
    current,
    assignments: [...assignmentDTOs].reverse(),
    statuses: [...statusDTOs].reverse(),
    scheduled: scheduled.map((row) => scheduledDTO(row, names, hr && context !== null && can(context, "hr.employment.schedule"))),
    timeline: buildTimeline(head.company, standingAssignments, standingStatuses, hr, documents, names),
    capabilities: employmentCapabilities(hr ? context : null, head.employmentStatus),
  };
}

function assignmentDTO(row: AssignmentRecord, hr: boolean, documents: Map<string, HistoryDocumentDTO>, names: Map<string, string>): AssignmentRowDTO {
  return {
    id: row.id,
    startDate: dayOf(row.startDate),
    endDate: row.endDate ? dayOf(row.endDate) : null,
    department: row.departmentName || row.departmentId ? { id: row.departmentId, name: row.departmentName ?? "Department" } : null,
    jobTitle: row.jobTitle,
    manager: row.managerName || row.managerMemberId ? { memberId: row.managerMemberId, name: row.managerName ?? "Manager" } : null,
    workLocationType: row.workLocationType,
    workLocation: row.workLocation,
    employmentType: row.employmentType,
    reason: row.reason,
    source: row.source,
    document: row.sourceDocumentId ? (documents.get(row.sourceDocumentId) ?? null) : null,
    note: hr ? row.note : null,
    createdBy: hr && row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
    supersededAt: hr && row.supersededAt ? row.supersededAt.toISOString() : null,
    correctsId: hr ? row.correctsId : null,
    correctionReason: hr ? row.correctionReason : null,
  };
}

function statusDTO(row: StatusRecord, hr: boolean, privateReasons: boolean, documents: Map<string, HistoryDocumentDTO>, names: Map<string, string>): StatusRowDTO {
  return {
    id: row.id,
    status: row.status,
    effectiveFrom: dayOf(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? dayOf(row.effectiveTo) : null,
    reason: row.reason,
    privateReason: privateReasons ? row.privateReason : null,
    source: row.source,
    document: row.sourceDocumentId ? (documents.get(row.sourceDocumentId) ?? null) : null,
    createdBy: hr && row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
    supersededAt: hr && row.supersededAt ? row.supersededAt.toISOString() : null,
    correctsId: hr ? row.correctsId : null,
    correctionReason: hr ? row.correctionReason : null,
  };
}

function scheduledDTO(
  row: { id: string; type: keyof typeof changeTypeLabels; effectiveDate: Date; status: ScheduledChangeDTO["status"]; payload: Prisma.JsonValue; requestedByUserId: string; createdAt: Date; failureReason: string | null; cancelReason: string | null },
  names: Map<string, string>,
  canCancel: boolean,
): ScheduledChangeDTO {
  return {
    id: row.id,
    type: row.type,
    effectiveDate: dayOf(row.effectiveDate),
    status: row.status,
    summary: summarizePayload(row.type, row.payload),
    requestedBy: names.get(row.requestedByUserId) ?? null,
    createdAt: row.createdAt.toISOString(),
    failureReason: row.failureReason,
    cancelReason: row.cancelReason,
    canCancel: canCancel && row.status === "SCHEDULED",
  };
}

/** A scheduled change in words, from its own payload; never a private reason (E-03 §152). */
function summarizePayload(type: keyof typeof changeTypeLabels, payload: Prisma.JsonValue): string {
  const value = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as Record<string, unknown>;
  const text = (key: string) => (typeof value[key] === "string" ? (value[key] as string) : null);
  switch (type) {
    case "POSITION_CHANGE":
      return `New title: ${text("jobTitle") ?? "—"}`;
    case "EMPLOYMENT_TYPE_CHANGE":
      return `Employment type: ${employmentTypeLabels[text("employmentType") as keyof typeof employmentTypeLabels] ?? text("employmentType") ?? "—"}`;
    case "STATUS_CHANGE":
      return `Status: ${employmentStatusLabels[text("status") as EmploymentStatus] ?? text("status") ?? "—"}`;
    case "TERMINATION":
      return `Last working day ${text("lastWorkingDay") ?? "—"}`;
    case "LOCATION_CHANGE":
      return `Location: ${[workLocationTypeLabels[text("workLocationType") as keyof typeof workLocationTypeLabels], text("workLocation")].filter(Boolean).join(", ") || "—"}`;
    default:
      return changeTypeLabels[type];
  }
}

/* -------------------------------------------------------------------------- */
/* Timeline (E-03 §123-§131)                                                   */
/* -------------------------------------------------------------------------- */

const byNewest = (a: TimelineEventDTO, b: TimelineEventDTO) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1);

function locationText(row: { workLocationType: keyof typeof workLocationTypeLabels | null; workLocation: string | null }): string | null {
  return [row.workLocationType ? workLocationTypeLabels[row.workLocationType] : null, row.workLocation].filter(Boolean).join(", ") || null;
}

function buildTimeline(
  company: { id: string; name: string },
  assignments: AssignmentRecord[],
  statuses: StatusRecord[],
  hr: boolean,
  documents: Map<string, HistoryDocumentDTO>,
  names: Map<string, string>,
): TimelineEventDTO[] {
  const events: TimelineEventDTO[] = [];
  assignments.forEach((row, index) => {
    const previous = index > 0 ? assignments[index - 1]! : null;
    const changes: TimelineChangeDTO[] = [];
    if (previous) {
      const compare = (label: string, from: string | null, to: string | null) => {
        if ((from ?? null) !== (to ?? null)) changes.push({ label, from, to });
      };
      compare("Job title", previous.jobTitle, row.jobTitle);
      compare("Department", previous.departmentName, row.departmentName);
      compare("Manager", previous.managerName, row.managerName);
      compare("Location", locationText(previous), locationText(row));
      compare("Employment type", employmentTypeLabels[previous.employmentType], employmentTypeLabels[row.employmentType]);
    }
    events.push({
      id: `assignment:${row.id}`,
      date: dayOf(row.startDate),
      kind: row.reason,
      title: assignmentTitle(row, company.name),
      company,
      summary: [row.jobTitle, company.name, row.departmentName, row.managerName ? `Manager: ${row.managerName}` : null].filter((line): line is string => Boolean(line)),
      changes,
      document: row.sourceDocumentId ? (documents.get(row.sourceDocumentId) ?? null) : null,
      createdBy: hr && row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
      corrected: hr && row.source === "CORRECTION",
    });
  });

  statuses.forEach((row, index) => {
    const previous = index > 0 ? statuses[index - 1]! : null;
    // Joining is the assignment's event; a plan is not history yet.
    if (row.status === "PLANNED") return;
    if (row.status === "ACTIVE" && (row.reason === "HIRE" || row.reason === "REHIRE" || row.reason === "LEGAL_ENTITY_TRANSFER")) return;
    const ended = row.status === "ENDED";
    const transferred = ended && row.reason === "LEGAL_ENTITY_TRANSFER";
    events.push({
      id: `status:${row.id}`,
      date: dayOf(row.effectiveFrom),
      kind: ended ? "TERMINATED" : "STATUS_CHANGED",
      title: transferred ? `Left ${company.name} for another group company` : ended ? `Left ${company.name}` : row.status === "ACTIVE" ? "Back at work" : employmentStatusLabels[row.status],
      company,
      // The reason code is the employee's own business and HR's; never the private reason (E-03 §24, §105).
      summary: [statusReasonLabels[row.reason]].filter(Boolean),
      changes: previous ? [{ label: "Status", from: employmentStatusLabels[previous.status], to: employmentStatusLabels[row.status] }] : [],
      document: row.sourceDocumentId ? (documents.get(row.sourceDocumentId) ?? null) : null,
      createdBy: hr && row.createdByUserId ? (names.get(row.createdByUserId) ?? null) : null,
      corrected: hr && row.source === "CORRECTION",
    });
  });
  return events.sort(byNewest);
}

function assignmentTitle(row: AssignmentRecord, companyName: string): string {
  switch (row.reason) {
    case "HIRE":
      return `Joined ${companyName}`;
    case "REHIRE":
      return `Rejoined ${companyName}`;
    case "LEGAL_ENTITY_TRANSFER":
      return `Transferred to ${companyName}`;
    case "PROMOTION":
      return `Promoted to ${row.jobTitle ?? "a new position"}`;
    case "DEMOTION":
    case "TITLE_CHANGE":
      return `Became ${row.jobTitle ?? "untitled"}`;
    case "DEPARTMENT_TRANSFER":
      return row.departmentName ? `Moved to ${row.departmentName}` : "Left their department";
    case "MANAGER_CHANGE":
      return row.managerName ? `Reports to ${row.managerName}` : "No longer has a manager";
    case "LOCATION_CHANGE":
      return `Works ${locationText(row) ? `at ${locationText(row)}` : "without a set location"}`;
    case "EMPLOYMENT_TYPE_CHANGE":
      return `Now ${employmentTypeLabels[row.employmentType].toLowerCase()}`;
    case "REORGANIZATION":
      return "Reorganization";
    default:
      return "Employment updated";
  }
}

/* -------------------------------------------------------------------------- */
/* As of a date (E-03 §143, §144, §178, §179)                                  */
/* -------------------------------------------------------------------------- */

/** Where an employment stood on a day, from the standing rows: its assignment and its status then. */
export async function employmentAt(employmentId: string, day: Day) {
  const date = dbDay(day);
  const [assignment, status] = await Promise.all([
    prisma.employmentAssignment.findFirst({
      where: { employeeProfileId: employmentId, supersededAt: null, isPrimary: true, startDate: { lte: date }, OR: [{ endDate: null }, { endDate: { gte: date } }] },
      select: { id: true, departmentId: true, departmentName: true, jobTitle: true, managerMemberId: true, managerName: true, workLocationType: true, workLocation: true, employmentType: true },
    }),
    prisma.employmentStatusHistory.findFirst({
      where: { employeeProfileId: employmentId, supersededAt: null, effectiveFrom: { lte: date }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }] },
      select: { status: true },
    }),
  ]);
  return { assignment, status: status?.status ?? null };
}
