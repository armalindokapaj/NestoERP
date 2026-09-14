import type { Prisma } from "@prisma/client";

import { can } from "@/lib/access/can";
import { AccessError, assertModule } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays, daysBetween } from "@/lib/modules/calendar/calendar.time";
import { contractorProjectDoor, contractorsOpen, readableAssignmentWhere, readableComplianceWhere, readableWorkPackageWhere } from "@/lib/modules/contractors/contractor.permissions";
import { COMPLIANCE_ALERT_STATUSES, COMPLIANCE_STATUS_LABELS, COMPLIANCE_TYPE_LABELS, OPEN_WORK_PACKAGE_STATUSES, type ComplianceStatus } from "@/lib/modules/contractors/contractor.types";
import { loadEngineeringProject } from "./engineering.documents";
import { engineeringOpen, MODULE, readableEngineeringDocumentWhere, readableRfiWhere, readableSubmittalWhere } from "./engineering.permissions";
import { listRfis } from "./engineering.rfis";
import { companyToday } from "./engineering.settings";
import { dateLabel, dateOf } from "./engineering.shared";
import {
  DISCIPLINE_LABELS,
  DRAWING_TYPES,
  REVIEW_DECISION_LABELS,
  REVIEW_STATUS_LABELS,
  RFI_AWAITING_RESPONSE,
  RFI_OPEN_STATUSES,
  SUBMITTAL_IN_REVIEW,
  SUBMITTAL_TYPE_LABELS,
  type EngineeringOverviewDTO,
  type ReviewDecision,
  type RfiRowDTO,
} from "./engineering.types";

/**
 * Engineering at a glance (PRD #46 §159-§161, §206-§211, §276-§278).
 *
 * Counts and short lists, every one read through the reader's own doors. No
 * contractor score: the reports count what happened and leave the judgement to
 * people (§211).
 */

const none = { id: { in: [] as string[] } };

function doors(context: UserContext) {
  return {
    rfi: engineeringOpen(context, "rfi.view") ? readableRfiWhere(context) : (none as Prisma.RfiWhereInput),
    submittal: engineeringOpen(context, "submittal.view") ? readableSubmittalWhere(context) : (none as Prisma.TechnicalSubmittalWhereInput),
    document: engineeringOpen(context, "engineering_document.view") ? readableEngineeringDocumentWhere(context) : (none as Prisma.EngineeringDocumentWhereInput),
  };
}

export async function projectEngineeringOverview(context: UserContext, projectId: string): Promise<EngineeringOverviewDTO> {
  const project = await loadEngineeringProject(context, projectId);
  const { today } = await companyToday(context.companyId);
  const start = new Date(`${today}T00:00:00.000Z`);
  const weekAgo = new Date(`${addLocalDays(today, -7)}T00:00:00.000Z`);
  const door = doors(context);
  const onProject = { projectId: project.id };
  const [openRfis, overdueRfis, inReview, revisionRequired, approvedSubmittals, approvedDocuments, drawingsAwaiting, overdueSubmittals, overdueDocuments, complianceAlerts, lateRfis, lateSubmittals, lateDocuments, decidedSubmittals, decidedDocuments] = await Promise.all([
    prisma.rfi.count({ where: { AND: [door.rfi, onProject, { status: { in: RFI_OPEN_STATUSES } }] } }),
    prisma.rfi.count({ where: { AND: [door.rfi, onProject, { status: { in: RFI_AWAITING_RESPONSE }, dueAt: { lt: start } }] } }),
    prisma.technicalSubmittal.count({ where: { AND: [door.submittal, onProject, { status: { in: SUBMITTAL_IN_REVIEW } }] } }),
    prisma.technicalSubmittal.count({ where: { AND: [door.submittal, onProject, { status: "REVISION_REQUIRED" }] } }),
    prisma.technicalSubmittalRevision.count({ where: { companyId: context.companyId, reviewDecision: { in: ["APPROVED", "APPROVED_WITH_COMMENTS"] }, reviewedAt: { gte: weekAgo }, submittal: { AND: [door.submittal, onProject] } } }),
    prisma.engineeringDocumentRevision.count({ where: { companyId: context.companyId, reviewDecision: { in: ["APPROVED", "APPROVED_WITH_COMMENTS"] }, reviewedAt: { gte: weekAgo }, engineeringDocument: { AND: [door.document, onProject] } } }),
    prisma.engineeringDocument.count({ where: { AND: [door.document, onProject, { documentType: { in: DRAWING_TYPES }, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }] } }),
    prisma.technicalSubmittal.count({ where: { AND: [door.submittal, onProject, { status: { in: SUBMITTAL_IN_REVIEW }, dueAt: { lt: start } }] } }),
    prisma.engineeringDocument.count({ where: { AND: [door.document, onProject, { status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, reviewDueAt: { lt: start } }] } }),
    contractorsOpen(context, "contractor_compliance.view")
      ? prisma.contractorComplianceItem.count({ where: { AND: [readableComplianceWhere(context), { archivedAt: null, status: { in: COMPLIANCE_ALERT_STATUSES }, contractor: { projectAssignments: { some: { projectId: project.id, status: { notIn: ["TERMINATED", "COMPLETED"] } } } } }] } })
      : 0,
    prisma.rfi.findMany({ where: { AND: [door.rfi, onProject, { status: { in: RFI_AWAITING_RESPONSE }, dueAt: { lt: start } }] }, orderBy: { dueAt: "asc" }, take: 5, select: { id: true, rfiNumber: true, subject: true, dueAt: true } }),
    prisma.technicalSubmittal.findMany({ where: { AND: [door.submittal, onProject, { OR: [{ status: { in: SUBMITTAL_IN_REVIEW }, dueAt: { lt: start } }, { status: "REVISION_REQUIRED" }] }] }, orderBy: { dueAt: "asc" }, take: 5, select: { id: true, submittalNumber: true, title: true, status: true, dueAt: true } }),
    prisma.engineeringDocument.findMany({ where: { AND: [door.document, onProject, { status: { in: ["SUBMITTED", "UNDER_REVIEW"] }, reviewDueAt: { lt: start } }] }, orderBy: { reviewDueAt: "asc" }, take: 5, select: { id: true, documentNumber: true, title: true, reviewDueAt: true } }),
    prisma.technicalSubmittalRevision.findMany({ where: { companyId: context.companyId, status: { in: ["FINALIZED", "SUPERSEDED"] }, reviewDecision: { not: null }, submittal: { AND: [door.submittal, onProject] } }, orderBy: { reviewedAt: "desc" }, take: 6, select: { id: true, revisionCode: true, reviewDecision: true, reviewedAt: true, submittal: { select: { id: true, submittalNumber: true } } } }),
    prisma.engineeringDocumentRevision.findMany({ where: { companyId: context.companyId, status: { in: ["FINALIZED", "SUPERSEDED"] }, reviewDecision: { not: null }, engineeringDocument: { AND: [door.document, onProject] } }, orderBy: { reviewedAt: "desc" }, take: 6, select: { id: true, revisionCode: true, reviewDecision: true, reviewedAt: true, engineeringDocument: { select: { id: true, documentNumber: true } } } }),
  ]);
  const base = `/projects/${project.id}/engineering`;
  const lateBy = (due: Date | null) => (due ? daysBetween(dateOf(due)!, today) : 0);
  return {
    project: { id: project.id, name: project.name, code: project.code },
    counts: { openRfis, overdueRfis, submittalsInReview: inReview, revisionRequired, approvedThisWeek: approvedSubmittals + approvedDocuments, drawingsAwaitingReview: drawingsAwaiting, complianceAlerts, overdueReviews: overdueSubmittals + overdueDocuments },
    attention: [
      ...lateRfis.map((row) => ({ id: row.id, kind: "rfi" as const, label: `${row.rfiNumber} · ${row.subject}`, detail: `Answer ${lateBy(row.dueAt)} ${lateBy(row.dueAt) === 1 ? "day" : "days"} late`, href: `${base}/rfis/${row.id}`, tone: "danger" as const })),
      ...lateSubmittals.map((row) => ({ id: row.id, kind: "submittal" as const, label: `${row.submittalNumber} · ${row.title}`, detail: row.status === "REVISION_REQUIRED" ? "Revision required" : `Review ${lateBy(row.dueAt)} ${lateBy(row.dueAt) === 1 ? "day" : "days"} late`, href: `${base}/submittals/${row.id}`, tone: row.status === "REVISION_REQUIRED" ? ("warning" as const) : ("danger" as const) })),
      ...lateDocuments.map((row) => ({ id: row.id, kind: "document" as const, label: `${row.documentNumber} · ${row.title}`, detail: `Review ${lateBy(row.reviewDueAt)} ${lateBy(row.reviewDueAt) === 1 ? "day" : "days"} late`, href: `${base}/documents/${row.id}`, tone: "danger" as const })),
    ],
    recentDecisions: [
      ...decidedSubmittals.map((row) => ({ id: row.id, label: `${row.submittal.submittalNumber} Rev ${row.revisionCode}`, decision: row.reviewDecision as ReviewDecision, at: row.reviewedAt!.toISOString(), href: `${base}/submittals/${row.submittal.id}` })),
      ...decidedDocuments.map((row) => ({ id: row.id, label: `${row.engineeringDocument.documentNumber} Rev ${row.revisionCode}`, decision: row.reviewDecision as ReviewDecision, at: row.reviewedAt!.toISOString(), href: `${base}/documents/${row.engineeringDocument.id}` })),
    ]
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 6),
  };
}

/** The line under a project's engineering title: open RFIs, under review, revision required (§165). */
export async function engineeringHeadline(context: UserContext, projectId: string): Promise<{ openRfis: number; inReview: number; revisionRequired: number }> {
  const door = doors(context);
  const onProject = { projectId };
  const [openRfis, submittalsInReview, documentsInReview, submittalsBack, documentsBack] = await Promise.all([
    prisma.rfi.count({ where: { AND: [door.rfi, onProject, { status: { in: RFI_OPEN_STATUSES } }] } }),
    prisma.technicalSubmittal.count({ where: { AND: [door.submittal, onProject, { status: { in: SUBMITTAL_IN_REVIEW } }] } }),
    prisma.engineeringDocument.count({ where: { AND: [door.document, onProject, { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }] } }),
    prisma.technicalSubmittal.count({ where: { AND: [door.submittal, onProject, { status: "REVISION_REQUIRED" }] } }),
    prisma.engineeringDocument.count({ where: { AND: [door.document, onProject, { status: "REVISION_REQUIRED" }] } }),
  ]);
  return { openRfis, inReview: submittalsInReview + documentsInReview, revisionRequired: submittalsBack + documentsBack };
}

/* -------------------------------------------------------------------------- */
/* My work                                                                     */
/* -------------------------------------------------------------------------- */

export type ReviewItem = { id: string; kind: "submittal" | "document"; number: string; title: string; projectName: string; revisionCode: string | null; dueAt: string | null; overdue: boolean; href: string };

export type MyEngineeringWork = {
  assignedRfis: RfiRowDTO[];
  reviews: ReviewItem[];
  toClose: RfiRowDTO[];
  counts: { assignedRfis: number; overdueRfis: number; reviews: number; overdueReviews: number; toClose: number };
};

/** RFIs waiting on me, reviews assigned to me, and my answered RFIs to close (§278). */
export async function myEngineeringWork(context: UserContext): Promise<MyEngineeringWork> {
  assertModule(context, MODULE);
  if (!engineeringOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open engineering.");
  const { today } = await companyToday(context.companyId);
  const door = doors(context);
  const [assigned, raised, submittals, documents] = await Promise.all([
    listRfis(context, { assignee: "me", open: false, awaiting: true, overdue: false, page: 1, projectId: null, q: null, contractorId: null, workPackageId: null }),
    can(context, "rfi.close") || can(context, "rfi.edit")
      ? prisma.rfi.findMany({ where: { AND: [door.rfi, { status: "ANSWERED", createdByMemberId: context.membershipId }] }, select: { id: true } })
      : [],
    prisma.technicalSubmittal.findMany({ where: { AND: [door.submittal, { assignedReviewerMemberId: context.membershipId, status: { in: SUBMITTAL_IN_REVIEW } }] }, orderBy: { dueAt: { sort: "asc", nulls: "last" } }, take: 50, select: { id: true, projectId: true, submittalNumber: true, title: true, dueAt: true, project: { select: { name: true } }, currentRevision: { select: { revisionCode: true } } } }),
    prisma.engineeringDocument.findMany({ where: { AND: [door.document, { reviewerMemberId: context.membershipId, status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }] }, orderBy: { reviewDueAt: { sort: "asc", nulls: "last" } }, take: 50, select: { id: true, projectId: true, documentNumber: true, title: true, reviewDueAt: true, project: { select: { name: true } }, currentRevision: { select: { revisionCode: true } } } }),
  ]);
  const toClose = raised.length ? (await listRfis(context, { status: "ANSWERED", open: false, awaiting: false, overdue: false, page: 1, projectId: null, q: null, contractorId: null, workPackageId: null })).items.filter((row) => raised.some((item) => item.id === row.id)) : [];
  const overdue = (due: Date | null) => Boolean(due && dateOf(due)! < today);
  const reviews: ReviewItem[] = [
    ...submittals.map((row) => ({ id: row.id, kind: "submittal" as const, number: row.submittalNumber, title: row.title, projectName: row.project.name, revisionCode: row.currentRevision?.revisionCode ?? null, dueAt: dateOf(row.dueAt), overdue: overdue(row.dueAt), href: `/projects/${row.projectId}/engineering/submittals/${row.id}` })),
    ...documents.map((row) => ({ id: row.id, kind: "document" as const, number: row.documentNumber, title: row.title, projectName: row.project.name, revisionCode: row.currentRevision?.revisionCode ?? null, dueAt: dateOf(row.reviewDueAt), overdue: overdue(row.reviewDueAt), href: `/projects/${row.projectId}/engineering/documents/${row.id}` })),
  ].sort((a, b) => (a.dueAt ?? "9999").localeCompare(b.dueAt ?? "9999"));
  return {
    assignedRfis: assigned.items,
    reviews,
    toClose,
    counts: { assignedRfis: assigned.total, overdueRfis: assigned.items.filter((row) => row.overdue).length, reviews: reviews.length, overdueReviews: reviews.filter((row) => row.overdue).length, toClose: toClose.length },
  };
}

/* -------------------------------------------------------------------------- */
/* Dashboard widgets                                                           */
/* -------------------------------------------------------------------------- */

export type WidgetItem = { id: string; title: string; subtitle?: string; meta?: string; status?: string; href: string };

export async function rfisAssignedToMeWidget(context: UserContext, limit: number): Promise<WidgetItem[]> {
  if (!engineeringOpen(context)) return [];
  const { items } = await listRfis(context, { assignee: "me", open: false, awaiting: true, overdue: false, page: 1, projectId: null, q: null, contractorId: null, workPackageId: null });
  return items
    .slice(0, limit)
    .map((row) => ({ id: row.id, title: `${row.rfiNumber} · ${row.subject}`, subtitle: [row.projectName, row.dueAt ? `due ${dateLabel(row.dueAt)}` : null].filter(Boolean).join(" · "), status: row.overdue ? "OVERDUE" : row.status, href: row.href }));
}

export async function reviewsAwaitingMeWidget(context: UserContext, limit: number): Promise<WidgetItem[]> {
  if (!engineeringOpen(context)) return [];
  const { reviews } = await myEngineeringWork(context);
  return reviews.slice(0, limit).map((row) => ({ id: `${row.kind}:${row.id}`, title: `${row.number}${row.revisionCode ? ` Rev ${row.revisionCode}` : ""} · ${row.title}`, subtitle: [row.projectName, row.dueAt ? `due ${dateLabel(row.dueAt)}` : null].filter(Boolean).join(" · "), status: row.overdue ? "OVERDUE" : "UNDER_REVIEW", href: row.href }));
}

export async function contractorComplianceWidget(context: UserContext, limit: number): Promise<WidgetItem[]> {
  if (!contractorsOpen(context, "contractor_compliance.view")) return [];
  const rows = await prisma.contractorComplianceItem.findMany({
    where: { AND: [readableComplianceWhere(context), { archivedAt: null, status: { in: COMPLIANCE_ALERT_STATUSES } }] },
    orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }],
    take: limit,
    select: { id: true, title: true, type: true, status: true, expiresAt: true, contractorId: true, contractor: { select: { legalName: true } } },
  });
  return rows.map((row) => ({ id: row.id, title: `${row.title} · ${row.contractor.legalName}`, subtitle: [COMPLIANCE_TYPE_LABELS[row.type], row.expiresAt ? `${row.status === "EXPIRED" ? "expired" : "expires"} ${dateLabel(dateOf(row.expiresAt))}` : COMPLIANCE_STATUS_LABELS[row.status as ComplianceStatus]].join(" · "), status: row.status, href: `/contractors/${row.contractorId}/compliance?item=${row.id}` }));
}

/** Where engineering is stuck across the reader's projects: late answers and late reviews (§277). */
export async function engineeringBottlenecksWidget(context: UserContext, limit: number): Promise<WidgetItem[]> {
  if (!engineeringOpen(context)) return [];
  const { today } = await companyToday(context.companyId);
  const start = new Date(`${today}T00:00:00.000Z`);
  const door = doors(context);
  const [rfis, submittals] = await Promise.all([
    prisma.rfi.findMany({ where: { AND: [door.rfi, { status: { in: RFI_AWAITING_RESPONSE }, dueAt: { lt: start } }] }, orderBy: { dueAt: "asc" }, take: limit, select: { id: true, projectId: true, rfiNumber: true, subject: true, dueAt: true, project: { select: { name: true } } } }),
    prisma.technicalSubmittal.findMany({ where: { AND: [door.submittal, { status: { in: SUBMITTAL_IN_REVIEW }, dueAt: { lt: start } }] }, orderBy: { dueAt: "asc" }, take: limit, select: { id: true, projectId: true, submittalNumber: true, title: true, dueAt: true, project: { select: { name: true } } } }),
  ]);
  const late = (due: Date | null) => {
    const days = due ? daysBetween(dateOf(due)!, today) : 0;
    return `${days} ${days === 1 ? "day" : "days"} late`;
  };
  return [
    ...rfis.map((row) => ({ due: row.dueAt, item: { id: `rfi:${row.id}`, title: `RFI ${row.rfiNumber} · ${row.subject}`, subtitle: `${row.project.name} · answer ${late(row.dueAt)}`, status: "OVERDUE", href: `/projects/${row.projectId}/engineering/rfis/${row.id}` } })),
    ...submittals.map((row) => ({ due: row.dueAt, item: { id: `submittal:${row.id}`, title: `${row.submittalNumber} · ${row.title}`, subtitle: `${row.project.name} · review ${late(row.dueAt)}`, status: "OVERDUE", href: `/projects/${row.projectId}/engineering/submittals/${row.id}` } })),
  ]
    .sort((a, b) => (a.due?.getTime() ?? 0) - (b.due?.getTime() ?? 0))
    .slice(0, limit)
    .map((entry) => entry.item);
}

/* -------------------------------------------------------------------------- */
/* Reports                                                                     */
/* -------------------------------------------------------------------------- */

export type Breakdown = Array<{ key: string; label: string; count: number }>;

export type EngineeringReport = {
  rfis: { open: number; overdue: number; closed: number; averageResponseDays: number | null; byContractor: Breakdown; byDiscipline: Breakdown };
  submittals: { byStatus: Breakdown; byContractor: Breakdown; byType: Breakdown; overdueReviews: number; averageRevisions: number | null };
  documents: { pendingReview: number; superseded: number; byDiscipline: Breakdown; byStatus: Breakdown };
  compliance: { byStatus: Breakdown; alerts: number } | null;
  contractors: { byProject: Array<{ projectId: string; projectName: string; contractors: number; activeWorkPackages: number }> } | null;
};

function sortBreakdown(rows: Breakdown): Breakdown {
  return rows.filter((row) => row.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/** RFI, submittal, document, compliance and contractor reports, inside the reader's doors (§206-§211). */
export async function engineeringReport(context: UserContext, input: { projectId: string | null }): Promise<EngineeringReport> {
  assertModule(context, MODULE);
  if (!engineeringOpen(context, "engineering_document.view") && !engineeringOpen(context)) throw new AccessError("FORBIDDEN", "You cannot open engineering reports.");
  if (input.projectId) await loadEngineeringProject(context, input.projectId);
  const { today } = await companyToday(context.companyId);
  const start = new Date(`${today}T00:00:00.000Z`);
  const door = doors(context);
  const scope = input.projectId ? { projectId: input.projectId } : {};

  const [rfiOpen, rfiOverdue, rfiClosed, answered, rfiByContractor, rfiByDiscipline, subByStatus, subByContractor, subByType, subOverdue, revisionCounts, docPending, docSuperseded, docByDiscipline, docByStatus] = await Promise.all([
    prisma.rfi.count({ where: { AND: [door.rfi, scope, { status: { in: RFI_OPEN_STATUSES } }] } }),
    prisma.rfi.count({ where: { AND: [door.rfi, scope, { status: { in: RFI_AWAITING_RESPONSE }, dueAt: { lt: start } }] } }),
    prisma.rfi.count({ where: { AND: [door.rfi, scope, { status: "CLOSED" }] } }),
    prisma.rfi.findMany({ where: { AND: [door.rfi, scope, { openedAt: { not: null }, answeredAt: { not: null } }] }, take: 5_000, select: { openedAt: true, answeredAt: true } }),
    prisma.rfi.groupBy({ by: ["contractorId"], where: { AND: [door.rfi, scope, { status: { not: "VOID" } }] }, _count: { _all: true } }),
    prisma.rfi.groupBy({ by: ["discipline"], where: { AND: [door.rfi, scope, { status: { not: "VOID" } }] }, _count: { _all: true } }),
    prisma.technicalSubmittal.groupBy({ by: ["status"], where: { AND: [door.submittal, scope] }, _count: { _all: true } }),
    prisma.technicalSubmittal.groupBy({ by: ["contractorId"], where: { AND: [door.submittal, scope, { status: { not: "VOID" } }] }, _count: { _all: true } }),
    prisma.technicalSubmittal.groupBy({ by: ["submittalType"], where: { AND: [door.submittal, scope, { status: { not: "VOID" } }] }, _count: { _all: true } }),
    prisma.technicalSubmittal.count({ where: { AND: [door.submittal, scope, { status: { in: SUBMITTAL_IN_REVIEW }, dueAt: { lt: start } }] } }),
    prisma.technicalSubmittalRevision.groupBy({ by: ["submittalId"], where: { companyId: context.companyId, status: { notIn: ["DRAFT", "VOID"] }, submittal: { AND: [door.submittal, scope] } }, _count: { _all: true } }),
    prisma.engineeringDocument.count({ where: { AND: [door.document, scope, { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } }] } }),
    prisma.engineeringDocument.count({ where: { AND: [door.document, scope, { status: "SUPERSEDED" }] } }),
    prisma.engineeringDocument.groupBy({ by: ["discipline"], where: { AND: [door.document, scope, { status: { not: "VOID" } }] }, _count: { _all: true } }),
    prisma.engineeringDocument.groupBy({ by: ["status"], where: { AND: [door.document, scope] }, _count: { _all: true } }),
  ]);

  const contractorIds = [...new Set([...rfiByContractor, ...subByContractor].map((row) => row.contractorId).filter((id): id is string => Boolean(id)))];
  const contractorNames = new Map((contractorIds.length ? await prisma.contractorProfile.findMany({ where: { companyId: context.companyId, id: { in: contractorIds } }, select: { id: true, legalName: true } }) : []).map((row) => [row.id, row.legalName]));
  const byContractor = (rows: Array<{ contractorId: string | null; _count: { _all: number } }>) => sortBreakdown(rows.map((row) => ({ key: row.contractorId ?? "none", label: row.contractorId ? (contractorNames.get(row.contractorId) ?? "Contractor") : "No contractor", count: row._count._all })));
  const durations = answered.map((row) => (row.answeredAt!.getTime() - row.openedAt!.getTime()) / 86_400_000).filter((days) => days >= 0);

  let compliance: EngineeringReport["compliance"] = null;
  if (contractorsOpen(context, "contractor_compliance.view")) {
    const rows = await prisma.contractorComplianceItem.groupBy({ by: ["status"], where: { AND: [readableComplianceWhere(context), { archivedAt: null }, input.projectId ? { contractor: { projectAssignments: { some: { projectId: input.projectId } } } } : {}] }, _count: { _all: true } });
    compliance = { byStatus: sortBreakdown(rows.map((row) => ({ key: row.status, label: COMPLIANCE_STATUS_LABELS[row.status], count: row._count._all }))), alerts: rows.filter((row) => COMPLIANCE_ALERT_STATUSES.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0) };
  }

  let contractors: EngineeringReport["contractors"] = null;
  const projectDoor = contractorProjectDoor(context, "project_contractor.view");
  if (projectDoor) {
    const [assignments, packages] = await Promise.all([
      prisma.projectContractorAssignment.groupBy({ by: ["projectId"], where: { AND: [readableAssignmentWhere(context), scope, { status: { notIn: ["TERMINATED", "COMPLETED"] } }] }, _count: { _all: true } }),
      contractorsOpen(context, "work_package.view") ? prisma.workPackage.groupBy({ by: ["projectId"], where: { AND: [readableWorkPackageWhere(context), scope, { archivedAt: null, status: { in: OPEN_WORK_PACKAGE_STATUSES } }] }, _count: { _all: true } }) : [],
    ]);
    const projectIds = [...new Set([...assignments.map((row) => row.projectId), ...packages.map((row) => row.projectId)])];
    const projects = projectIds.length ? await prisma.project.findMany({ where: { AND: [projectDoor, { id: { in: projectIds } }] }, orderBy: { name: "asc" }, select: { id: true, name: true } }) : [];
    const packageCount = new Map(packages.map((row) => [row.projectId, row._count._all]));
    const assignmentCount = new Map(assignments.map((row) => [row.projectId, row._count._all]));
    contractors = { byProject: projects.map((project) => ({ projectId: project.id, projectName: project.name, contractors: assignmentCount.get(project.id) ?? 0, activeWorkPackages: packageCount.get(project.id) ?? 0 })) };
  }

  return {
    rfis: {
      open: rfiOpen,
      overdue: rfiOverdue,
      closed: rfiClosed,
      averageResponseDays: durations.length ? Math.round((durations.reduce((sum, days) => sum + days, 0) / durations.length) * 10) / 10 : null,
      byContractor: byContractor(rfiByContractor),
      byDiscipline: sortBreakdown(rfiByDiscipline.map((row) => ({ key: row.discipline ?? "none", label: row.discipline ? DISCIPLINE_LABELS[row.discipline] : "No discipline", count: row._count._all }))),
    },
    submittals: {
      byStatus: sortBreakdown(subByStatus.map((row) => ({ key: row.status, label: REVIEW_STATUS_LABELS[row.status], count: row._count._all }))),
      byContractor: byContractor(subByContractor),
      byType: sortBreakdown(subByType.map((row) => ({ key: row.submittalType, label: SUBMITTAL_TYPE_LABELS[row.submittalType], count: row._count._all }))),
      overdueReviews: subOverdue,
      averageRevisions: revisionCounts.length ? Math.round((revisionCounts.reduce((sum, row) => sum + row._count._all, 0) / revisionCounts.length) * 10) / 10 : null,
    },
    documents: {
      pendingReview: docPending,
      superseded: docSuperseded,
      byDiscipline: sortBreakdown(docByDiscipline.map((row) => ({ key: row.discipline, label: DISCIPLINE_LABELS[row.discipline], count: row._count._all }))),
      byStatus: sortBreakdown(docByStatus.map((row) => ({ key: row.status, label: REVIEW_STATUS_LABELS[row.status], count: row._count._all }))),
    },
    compliance,
    contractors,
  };
}

export { REVIEW_DECISION_LABELS };
