import type { Prisma } from "@prisma/client";

import type { Permission } from "@/config/permissions";
import { can } from "@/lib/access/can";
import { AccessError, assertModule, assertPermission } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { resolveAttentionForRecord } from "@/lib/core/notifications/attention.reconcile";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { prisma } from "@/lib/database/prisma";
import { addLocalDays } from "@/lib/modules/calendar/calendar.time";
import { recordActivity } from "@/lib/modules/shared/activity";
import { notifyEngineering } from "./engineering.notify";
import {
  DOCUMENT_ACTIVITY,
  DOCUMENT_RECORD,
  engineeringOpen,
  filesOpen,
  MODULE,
  readableEngineeringDocumentWhere,
  readableSubmittalWhere,
  SUBMITTAL_ACTIVITY,
  SUBMITTAL_RECORD,
} from "./engineering.permissions";
import type { CreateRevisionInput, ReviewDecisionInput } from "./engineering.schema";
import { companyToday, type EngineeringSettingsDTO } from "./engineering.settings";
import { assertProjectWritable, at, dateLabel, dateOf, fail, people, personOf, projectArchived } from "./engineering.shared";
import {
  APPROVING_DECISIONS,
  REVIEW_DECISION_LABELS,
  REVIEW_DECISIONS,
  type ReviewDecision,
  type RevisionCapabilities,
  type RevisionDTO,
  type RevisionStatus,
  type SharingClassification,
} from "./engineering.types";

/**
 * Revisions and reviews, for engineering documents and submittals alike
 * (PRD #46 §66-§75, §102-§105, §171, §172, §218, §220, §225, §227, §250, §251).
 *
 *   DRAFT → SUBMITTED → UNDER_REVIEW → FINALIZED (with its decision) → SUPERSEDED
 *
 * A draft's file is chosen from Documents uploaded to the record. Submitting
 * pins the exact file version and freezes it — a later upload never replaces
 * what was submitted; a correction is a new revision (§69). The decision is
 * stored on the revision and mirrored on its record; an approval supersedes
 * every older revision, which stays readable with its whole history (§71, §73).
 * The person who submitted a revision does not review it unless the company
 * allows it, and a revision assigned to a reviewer is decided by them or by
 * somebody holding the approve grant (§74, §251).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
export type RevisionKind = "document" | "submittal";

const IN_REVIEW: RevisionStatus[] = ["SUBMITTED", "UNDER_REVIEW"];
const IN_PROGRESS: RevisionStatus[] = ["DRAFT", "SUBMITTED", "UNDER_REVIEW"];

const KIND = {
  document: {
    record: DOCUMENT_RECORD,
    activity: DOCUMENT_ACTIVITY,
    fk: "engineeringDocumentId",
    dueField: "reviewDueAt",
    noun: "document",
    edit: "engineering_document.edit",
    submit: "engineering_document.submit",
    review: "engineering_document.review",
    approve: "engineering_document.approve",
    audit: { created: AuditAction.ENGINEERING_REVISION_CREATED, submitted: AuditAction.ENGINEERING_REVISION_SUBMITTED, reviewed: AuditAction.ENGINEERING_REVISION_REVIEWED },
    overdue: "ENGINEERING_REVIEW_OVERDUE",
  },
  submittal: {
    record: SUBMITTAL_RECORD,
    activity: SUBMITTAL_ACTIVITY,
    fk: "submittalId",
    dueField: "dueAt",
    noun: "submittal",
    edit: "submittal.edit",
    submit: "submittal.submit",
    review: "submittal.review",
    approve: "submittal.approve",
    audit: { created: AuditAction.SUBMITTAL_REVISION_CREATED, submitted: AuditAction.SUBMITTAL_SUBMITTED, reviewed: AuditAction.SUBMITTAL_REVIEWED },
    overdue: "SUBMITTAL_REVIEW_OVERDUE",
  },
} as const satisfies Record<RevisionKind, { edit: Permission; submit: Permission; review: Permission; approve: Permission } & Record<string, unknown>>;

/* -------------------------------------------------------------------------- */
/* The two tables behind one engine                                            */
/* -------------------------------------------------------------------------- */

type Args = Record<string, unknown>;

export type RevisionRow = {
  id: string;
  companyId: string;
  parentId: string;
  revisionCode: string;
  revisionNumber: number | null;
  documentId: string;
  documentVersionId: string | null;
  notes: string | null;
  status: RevisionStatus;
  submittedAt: Date | null;
  submittedByMemberId: string | null;
  reviewStartedAt: Date | null;
  reviewedAt: Date | null;
  reviewedByMemberId: string | null;
  reviewDecision: ReviewDecision | null;
  reviewComment: string | null;
  supersededAt: Date | null;
  createdByMemberId: string;
  createdAt: Date;
};

interface RevisionTable {
  findMany(args: Args): Promise<Array<Record<string, unknown>>>;
  findFirst(args: Args): Promise<Record<string, unknown> | null>;
  create(args: Args): Promise<{ id: string }>;
  updateMany(args: Args): Promise<{ count: number }>;
  aggregate(args: Args): Promise<{ _max: { revisionNumber: number | null } }>;
}

interface ParentTable {
  updateMany(args: Args): Promise<{ count: number }>;
}

const COMMON_SELECT = {
  id: true,
  companyId: true,
  revisionCode: true,
  revisionNumber: true,
  documentId: true,
  documentVersionId: true,
  notes: true,
  status: true,
  submittedAt: true,
  submittedByMemberId: true,
  reviewStartedAt: true,
  reviewedAt: true,
  reviewedByMemberId: true,
  reviewDecision: true,
  reviewComment: true,
  supersededAt: true,
  createdByMemberId: true,
  createdAt: true,
};

function table(db: Db, kind: RevisionKind): RevisionTable {
  return (kind === "document" ? db.engineeringDocumentRevision : db.technicalSubmittalRevision) as unknown as RevisionTable;
}

function parents(db: Db, kind: RevisionKind): ParentTable {
  return (kind === "document" ? db.engineeringDocument : db.technicalSubmittal) as unknown as ParentTable;
}

const selectFor = (kind: RevisionKind) => ({ ...COMMON_SELECT, [KIND[kind].fk]: true });
const toRow = (kind: RevisionKind, raw: Record<string, unknown>): RevisionRow => ({ ...(raw as Omit<RevisionRow, "parentId">), parentId: raw[KIND[kind].fk] as string });

export async function revisionsOf(db: Db, kind: RevisionKind, parentId: string): Promise<RevisionRow[]> {
  const rows = await table(db, kind).findMany({ where: { [KIND[kind].fk]: parentId }, orderBy: [{ revisionNumber: "desc" }, { createdAt: "desc" }], select: selectFor(kind) });
  return rows.map((row) => toRow(kind, row));
}

/* -------------------------------------------------------------------------- */
/* Parents                                                                     */
/* -------------------------------------------------------------------------- */

export type RevisionParent = {
  kind: RevisionKind;
  id: string;
  companyId: string;
  projectId: string;
  number: string;
  title: string;
  status: string;
  currentRevisionId: string | null;
  reviewerMemberId: string | null;
  watchers: Array<string | null>;
  dueAt: Date | null;
  version: number;
  closed: boolean;
  project: { name: string; archivedAt: Date | null; status: string; projectManagerMemberId: string | null };
};

const PARENT_PROJECT = { select: { name: true, archivedAt: true, status: true, projectManagerMemberId: true } } as const;

export async function loadRevisionParent(context: UserContext, kind: RevisionKind, id: string): Promise<RevisionParent> {
  assertModule(context, MODULE);
  if (kind === "document") {
    const row = await prisma.engineeringDocument.findFirst({
      where: { AND: [readableEngineeringDocumentWhere(context), { id }] },
      select: { id: true, companyId: true, projectId: true, documentNumber: true, title: true, status: true, currentRevisionId: true, reviewerMemberId: true, responsibleMemberId: true, createdByMemberId: true, reviewDueAt: true, version: true, project: PARENT_PROJECT },
    });
    if (!row) throw fail("ENGINEERING_DOCUMENT_NOT_FOUND", "That document could not be found.", "NOT_FOUND");
    return { kind, id: row.id, companyId: row.companyId, projectId: row.projectId, number: row.documentNumber, title: row.title, status: row.status, currentRevisionId: row.currentRevisionId, reviewerMemberId: row.reviewerMemberId, watchers: [row.responsibleMemberId, row.createdByMemberId], dueAt: row.reviewDueAt, version: row.version, closed: row.status === "VOID" || row.status === "SUPERSEDED", project: row.project };
  }
  const row = await prisma.technicalSubmittal.findFirst({
    where: { AND: [readableSubmittalWhere(context), { id }] },
    select: { id: true, companyId: true, projectId: true, submittalNumber: true, title: true, status: true, currentRevisionId: true, assignedReviewerMemberId: true, createdByMemberId: true, dueAt: true, version: true, project: PARENT_PROJECT },
  });
  if (!row) throw fail("SUBMITTAL_NOT_FOUND", "That submittal could not be found.", "NOT_FOUND");
  return { kind, id: row.id, companyId: row.companyId, projectId: row.projectId, number: row.submittalNumber, title: row.title, status: row.status, currentRevisionId: row.currentRevisionId, reviewerMemberId: row.assignedReviewerMemberId, watchers: [row.createdByMemberId], dueAt: row.dueAt, version: row.version, closed: row.status === "VOID" || row.status === "CLOSED", project: row.project };
}

async function loadRevision(context: UserContext, kind: RevisionKind, revisionId: string): Promise<{ parent: RevisionParent; revision: RevisionRow }> {
  const raw = await table(prisma, kind).findFirst({ where: { id: revisionId, companyId: context.companyId }, select: selectFor(kind) });
  if (!raw) throw fail("REVISION_NOT_FOUND", "That revision could not be found.", "NOT_FOUND");
  const revision = toRow(kind, raw);
  // Reached only through a record the reader can open: a guessed id answers like a missing one (§247-§249).
  const parent = await loadRevisionParent(context, kind, revision.parentId).catch(() => {
    throw fail("REVISION_NOT_FOUND", "That revision could not be found.", "NOT_FOUND");
  });
  return { parent, revision };
}

function assertLive(parent: RevisionParent) {
  assertProjectWritable(parent.project);
  if (parent.closed) throw fail("REVISION_PARENT_CLOSED", `This ${KIND[parent.kind].noun} is ${parent.status.toLowerCase()}; it takes no new revisions or reviews.`, "CONFLICT");
}

/* -------------------------------------------------------------------------- */
/* Capabilities                                                                */
/* -------------------------------------------------------------------------- */

function reviewGate(context: UserContext, parent: RevisionParent, revision: RevisionRow, settings: Pick<EngineeringSettingsDTO, "allowSelfReview">): string | null {
  if (!settings.allowSelfReview && revision.submittedByMemberId === context.membershipId) return "You submitted this revision, so another reviewer decides it.";
  if (parent.reviewerMemberId && parent.reviewerMemberId !== context.membershipId && !can(context, KIND[parent.kind].approve)) return "This revision is assigned to another reviewer.";
  return null;
}

export function revisionCapabilities(context: UserContext, parent: RevisionParent, revision: RevisionRow, settings: Pick<EngineeringSettingsDTO, "allowSelfReview">): RevisionCapabilities {
  const spec = KIND[parent.kind];
  const live = !parent.closed && !projectArchived(parent.project) && engineeringOpen(context, parent.kind === "document" ? "engineering_document.view" : "submittal.view");
  const reviewing = live && IN_REVIEW.includes(revision.status) && revision.id === parent.currentRevisionId;
  const gate = reviewing ? reviewGate(context, parent, revision, settings) : null;
  const canReview = reviewing && can(context, spec.review) && gate === null;
  return {
    canSubmit: live && revision.status === "DRAFT" && can(context, spec.submit),
    canStartReview: canReview && revision.status === "SUBMITTED",
    canReview,
    decisions: canReview ? REVIEW_DECISIONS.filter((decision) => !APPROVING_DECISIONS.includes(decision) || can(context, spec.approve)) : [],
    reviewBlockedReason: reviewing && can(context, spec.review) ? gate : null,
    canVoid: live && revision.status === "DRAFT" && can(context, spec.edit),
  };
}

export async function revisionDTOs(context: UserContext, parent: RevisionParent, rows: RevisionRow[]): Promise<RevisionDTO[]> {
  const files = filesOpen(context);
  const [names, documents, versions] = await Promise.all([
    people(context.companyId, rows.flatMap((row) => [row.submittedByMemberId, row.reviewedByMemberId])),
    files && rows.length ? prisma.document.findMany({ where: { companyId: context.companyId, id: { in: rows.map((row) => row.documentId) } }, select: { id: true, name: true, status: true, sharingClassification: true, latestVersionNumber: true } }) : [],
    files && rows.some((row) => row.documentVersionId) ? prisma.documentVersion.findMany({ where: { companyId: context.companyId, id: { in: rows.map((row) => row.documentVersionId).filter((id): id is string => Boolean(id)) } }, select: { id: true, versionNumber: true } }) : [],
  ]);
  const documentById = new Map(documents.map((row) => [row.id, row]));
  const versionById = new Map(versions.map((row) => [row.id, row.versionNumber]));
  return rows.map((row) => {
    const document = documentById.get(row.documentId);
    return {
      id: row.id,
      revisionCode: row.revisionCode,
      revisionNumber: row.revisionNumber,
      status: row.status,
      notes: row.notes,
      file: document
        ? { documentId: document.id, name: document.name, href: `/documents/${document.id}`, versionNumber: row.documentVersionId ? (versionById.get(row.documentVersionId) ?? null) : document.latestVersionNumber || null, sharing: document.sharingClassification as SharingClassification }
        : null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      submittedBy: personOf(names, row.submittedByMemberId),
      reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewedBy: personOf(names, row.reviewedByMemberId),
      decision: row.reviewDecision,
      reviewComment: row.reviewComment,
      supersededAt: row.supersededAt?.toISOString() ?? null,
      current: row.id === parent.currentRevisionId,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Commands                                                                    */
/* -------------------------------------------------------------------------- */

const label = (parent: RevisionParent, revision: Pick<RevisionRow, "revisionCode">) => `${parent.number} Rev ${revision.revisionCode}`;

/** The file a revision carries: a live Document filed on this record and not already carried by another revision (§125). */
async function assertRevisionFile(context: UserContext, parent: RevisionParent, documentId: string) {
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId: context.companyId, entityType: KIND[parent.kind].record, entityId: parent.id, status: "ACTIVE" }, select: { id: true, storageStatus: true } });
  if (!document || ["REJECTED", "FAILED", "ARCHIVED"].includes(document.storageStatus)) throw fail("REVISION_FILE_INVALID", "Upload the file to this record, then choose it for the revision.", "VALIDATION_ERROR", { field: "documentId" });
  const [documentUse, submittalUse] = await Promise.all([
    prisma.engineeringDocumentRevision.count({ where: { documentId, status: { not: "VOID" } } }),
    prisma.technicalSubmittalRevision.count({ where: { documentId, status: { not: "VOID" } } }),
  ]);
  if (documentUse + submittalUse) throw fail("REVISION_FILE_IN_USE", "That file already belongs to another revision. Upload the new revision's file.", "VALIDATION_ERROR", { field: "documentId" });
}

async function submitInTransaction(tx: Tx, context: UserContext, parent: RevisionParent, revision: RevisionRow, settings: EngineeringSettingsDTO, today: string) {
  const spec = KIND[parent.kind];
  const document = await tx.document.findFirst({ where: { id: revision.documentId, companyId: context.companyId, status: "ACTIVE" }, select: { storageStatus: true, currentVersionId: true } });
  if (!document || document.storageStatus !== "AVAILABLE") throw fail("REVISION_FILE_NOT_READY", "The revision's file is still being processed. Try again in a moment.", "CONFLICT");
  const now = new Date();
  const moved = await table(tx, parent.kind).updateMany({
    where: { id: revision.id, status: "DRAFT" },
    data: { status: "SUBMITTED", submittedAt: now, submittedByMemberId: context.membershipId, documentVersionId: document.currentVersionId },
  });
  if (!moved.count) throw fail("REVISION_STALE", "This revision changed since you opened it. Reload to see the latest.", "CONFLICT");
  // A review without a date gets the company's default, counted from submission (§105, §279).
  const due = parent.dueAt ? dateOf(parent.dueAt)! : addLocalDays(today, settings.submittalDefaultReviewDays);
  await parents(tx, parent.kind).updateMany({ where: { id: parent.id }, data: { status: "SUBMITTED", currentRevisionId: revision.id, [spec.dueField]: at(due), version: { increment: 1 } } });
  await recordActivity(tx, context, { module: MODULE, entityType: spec.activity, entityId: parent.id, action: "REVISION_SUBMITTED", message: `submitted ${label(parent, revision)} for review` });
  await recordUserAction(
    context,
    { actionKey: spec.audit.submitted, entity: { type: spec.record, id: parent.id, label: parent.number }, projectId: parent.projectId, after: { revisionId: revision.id, revisionCode: revision.revisionCode, documentId: revision.documentId, documentVersionId: document.currentVersionId, status: "SUBMITTED" } },
    { tx },
  );
  await notifyEngineering(tx, {
    companyId: context.companyId,
    eventType: parent.kind === "document" ? NotificationEvent.ENGINEERING_DOCUMENT_SUBMITTED : NotificationEvent.SUBMITTAL_SUBMITTED,
    entityType: spec.record,
    entityId: parent.id,
    projectId: parent.projectId,
    actorMemberId: context.membershipId,
    memberIds: [parent.reviewerMemberId ?? parent.project.projectManagerMemberId, ...parent.watchers],
    payload: { number: parent.number, title: parent.title, revisionCode: revision.revisionCode, dueDate: due, dateLabel: dateLabel(due) },
  });
  if (parent.kind === "submittal") incrementCounter(Metric.SUBMITTAL_SUBMITTED);
}

export async function createRevision(context: UserContext, kind: RevisionKind, parentId: string, input: CreateRevisionInput): Promise<{ id: string; status: RevisionStatus }> {
  const parent = await loadRevisionParent(context, kind, parentId);
  const spec = KIND[kind];
  assertPermission(context, spec.edit);
  if (input.submit) assertPermission(context, spec.submit);
  assertLive(parent);
  const rows = await revisionsOf(prisma, kind, parent.id);
  const open = rows.find((row) => IN_PROGRESS.includes(row.status));
  if (open) throw fail("REVISION_IN_PROGRESS", `Rev ${open.revisionCode} is still ${open.status === "DRAFT" ? "a draft" : "with the reviewer"}. Finish it before adding another revision.`, "CONFLICT");
  if (rows.some((row) => row.revisionCode.toLowerCase() === input.revisionCode.toLowerCase())) throw fail("REVISION_CODE_TAKEN", `Rev ${input.revisionCode} already exists on this ${spec.noun}.`, "CONFLICT", { field: "revisionCode" });
  await assertRevisionFile(context, parent, input.documentId);
  const { settings, today } = await companyToday(context.companyId);
  const nextNumber = Math.max(0, ...rows.map((row) => row.revisionNumber ?? 0)) + 1;

  return prisma.$transaction(async (tx) => {
    const created = await table(tx, kind).create({
      data: { companyId: context.companyId, [spec.fk]: parent.id, revisionCode: input.revisionCode, revisionNumber: nextNumber, documentId: input.documentId, notes: input.notes, status: "DRAFT", createdByMemberId: context.membershipId },
      select: { id: true },
    });
    await recordUserAction(context, { actionKey: spec.audit.created, entity: { type: spec.record, id: parent.id, label: parent.number }, projectId: parent.projectId, after: { revisionId: created.id, revisionCode: input.revisionCode, documentId: input.documentId } }, { tx });
    if (!input.submit) {
      await recordActivity(tx, context, { module: MODULE, entityType: spec.activity, entityId: parent.id, action: "REVISION_CREATED", message: `added ${parent.number} Rev ${input.revisionCode} as a draft` });
      return { id: created.id, status: "DRAFT" as const };
    }
    const revision = toRow(kind, { ...COMMON_SELECT, id: created.id, companyId: context.companyId, [spec.fk]: parent.id, revisionCode: input.revisionCode, revisionNumber: nextNumber, documentId: input.documentId, documentVersionId: null, notes: input.notes, status: "DRAFT", submittedAt: null, submittedByMemberId: null, reviewStartedAt: null, reviewedAt: null, reviewedByMemberId: null, reviewDecision: null, reviewComment: null, supersededAt: null, createdByMemberId: context.membershipId, createdAt: new Date() });
    await submitInTransaction(tx, context, parent, revision, settings, today);
    return { id: created.id, status: "SUBMITTED" as const };
  }).then(async (result) => {
    if (result.status === "SUBMITTED") await settleSubmitted(context.companyId, parent);
    return result;
  });
}

/** A new submission answers "revision required" at once (§107, §198). */
async function settleSubmitted(companyId: string, parent: RevisionParent) {
  if (parent.kind === "submittal") await resolveAttentionForRecord(prisma, companyId, SUBMITTAL_RECORD, parent.id, ["SUBMITTAL_REVISION_REQUIRED"]);
}

export async function submitRevision(context: UserContext, kind: RevisionKind, revisionId: string): Promise<{ id: string }> {
  const { parent, revision } = await loadRevision(context, kind, revisionId);
  assertPermission(context, KIND[kind].submit);
  assertLive(parent);
  if (revision.status !== "DRAFT") throw fail("REVISION_NOT_DRAFT", "Only a draft revision is submitted; a submitted one is never changed.", "CONFLICT");
  const { settings, today } = await companyToday(context.companyId);
  await prisma.$transaction((tx) => submitInTransaction(tx, context, parent, revision, settings, today));
  await settleSubmitted(context.companyId, parent);
  return { id: revision.id };
}

export async function startReview(context: UserContext, kind: RevisionKind, revisionId: string): Promise<{ id: string }> {
  const { parent, revision } = await loadRevision(context, kind, revisionId);
  const spec = KIND[kind];
  assertPermission(context, spec.review);
  assertLive(parent);
  if (revision.status !== "SUBMITTED" || revision.id !== parent.currentRevisionId) throw fail("REVISION_NOT_SUBMITTED", "Only the submitted current revision goes under review.", "CONFLICT");
  const { settings } = await companyToday(context.companyId);
  const gate = reviewGate(context, parent, revision, settings);
  if (gate) throw fail(gate.startsWith("You submitted") ? "REVIEW_SELF_FORBIDDEN" : "REVIEW_NOT_ASSIGNED", gate, "FORBIDDEN");
  await prisma.$transaction(async (tx) => {
    const moved = await table(tx, kind).updateMany({ where: { id: revision.id, status: "SUBMITTED" }, data: { status: "UNDER_REVIEW", reviewStartedAt: new Date() } });
    if (!moved.count) throw fail("REVISION_STALE", "This revision changed since you opened it. Reload to see the latest.", "CONFLICT");
    await parents(tx, kind).updateMany({ where: { id: parent.id }, data: { status: "UNDER_REVIEW", version: { increment: 1 } } });
    await recordActivity(tx, context, { module: MODULE, entityType: spec.activity, entityId: parent.id, action: "REVIEW_STARTED", message: `started reviewing ${label(parent, revision)}` });
  });
  return { id: revision.id };
}

export async function decideRevision(context: UserContext, kind: RevisionKind, revisionId: string, input: ReviewDecisionInput): Promise<{ id: string; decision: ReviewDecision }> {
  const { parent, revision } = await loadRevision(context, kind, revisionId);
  const spec = KIND[kind];
  // Authority is checked here, server-side, whatever the page offered (§250, §252).
  assertPermission(context, spec.review);
  if (APPROVING_DECISIONS.includes(input.decision)) assertPermission(context, spec.approve);
  assertLive(parent);
  if (!IN_REVIEW.includes(revision.status) || revision.id !== parent.currentRevisionId) throw fail("REVISION_NOT_IN_REVIEW", "Only the current revision, while submitted or under review, takes a decision.", "CONFLICT");
  const { settings } = await companyToday(context.companyId);
  const gate = reviewGate(context, parent, revision, settings);
  if (gate) throw fail(gate.startsWith("You submitted") ? "REVIEW_SELF_FORBIDDEN" : "REVIEW_NOT_ASSIGNED", gate, "FORBIDDEN");

  const approving = APPROVING_DECISIONS.includes(input.decision);
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const moved = await table(tx, kind).updateMany({
      where: { id: revision.id, status: { in: IN_REVIEW } },
      data: { status: "FINALIZED", reviewDecision: input.decision, reviewComment: input.comment, reviewedAt: now, reviewedByMemberId: context.membershipId },
    });
    if (!moved.count) throw fail("REVISION_STALE", "This revision changed since you opened it. Reload to see the latest.", "CONFLICT");
    await parents(tx, kind).updateMany({ where: { id: parent.id }, data: { status: input.decision, version: { increment: 1 } } });

    if (approving) {
      // The approved revision is current; every older one is superseded and kept (§71, §81).
      const older = (await revisionsOf(tx, kind, parent.id)).filter((row) => row.id !== revision.id && (row.status === "FINALIZED" || row.status === "SUBMITTED" || row.status === "UNDER_REVIEW"));
      if (older.length) {
        await table(tx, kind).updateMany({ where: { id: { in: older.map((row) => row.id) } }, data: { status: "SUPERSEDED", supersededAt: now } });
        await recordUserAction(context, { actionKey: AuditAction.ENGINEERING_REVISION_SUPERSEDED, entity: { type: spec.record, id: parent.id, label: parent.number }, projectId: parent.projectId, after: { revisionIds: older.map((row) => row.id), supersededBy: revision.id } }, { tx });
      }
    }

    await recordUserAction(
      context,
      { actionKey: spec.audit.reviewed, entity: { type: spec.record, id: parent.id, label: parent.number }, projectId: parent.projectId, before: { revisionId: revision.id, revisionCode: revision.revisionCode, status: revision.status }, after: { revisionId: revision.id, revisionCode: revision.revisionCode, status: "FINALIZED", decision: input.decision } },
      { tx },
    );
    await recordActivity(tx, context, { module: MODULE, entityType: spec.activity, entityId: parent.id, action: "REVISION_REVIEWED", message: `reviewed ${label(parent, revision)}: ${REVIEW_DECISION_LABELS[input.decision].toLowerCase()}` });

    const eventType =
      kind === "document"
        ? approving ? NotificationEvent.ENGINEERING_DOCUMENT_APPROVED : NotificationEvent.ENGINEERING_DOCUMENT_REVISION_REQUIRED
        : approving ? NotificationEvent.SUBMITTAL_APPROVED : input.decision === "REJECTED" ? NotificationEvent.SUBMITTAL_REJECTED : NotificationEvent.SUBMITTAL_REVISION_REQUIRED;
    await notifyEngineering(tx, {
      companyId: context.companyId,
      eventType,
      entityType: spec.record,
      entityId: parent.id,
      projectId: parent.projectId,
      actorMemberId: context.membershipId,
      memberIds: [revision.submittedByMemberId, ...parent.watchers],
      payload: { number: parent.number, title: parent.title, revisionCode: revision.revisionCode, decision: input.decision, decisionLabel: REVIEW_DECISION_LABELS[input.decision].toLowerCase() },
    });
  });

  if (kind === "submittal" && input.decision === "REVISION_REQUIRED") incrementCounter(Metric.SUBMITTAL_REVISION_REQUIRED);
  if (revision.submittedAt) incrementCounter(Metric.ENGINEERING_REVIEW_DURATION, { kind }, Math.max(0, Math.round((now.getTime() - revision.submittedAt.getTime()) / 1000)));
  const ended = [spec.overdue, ...(kind === "submittal" ? ["SUBMITTAL_REVISION_REQUIRED"] : [])];
  await resolveAttentionForRecord(prisma, context.companyId, spec.record, parent.id, ended);
  return { id: revision.id, decision: input.decision };
}

/** Only a draft is thrown away; a submitted revision stays as it was submitted (§69, §103). */
export async function voidRevision(context: UserContext, kind: RevisionKind, revisionId: string): Promise<{ id: string }> {
  const { parent, revision } = await loadRevision(context, kind, revisionId);
  assertPermission(context, KIND[kind].edit);
  assertLive(parent);
  if (revision.status !== "DRAFT") throw fail("REVISION_NOT_DRAFT", "Only a draft revision can be discarded.", "CONFLICT");
  await prisma.$transaction(async (tx) => {
    const moved = await table(tx, kind).updateMany({ where: { id: revision.id, status: "DRAFT" }, data: { status: "VOID", voidedAt: new Date() } });
    if (!moved.count) throw fail("REVISION_STALE", "This revision changed since you opened it. Reload to see the latest.", "CONFLICT");
    await recordActivity(tx, context, { module: MODULE, entityType: KIND[kind].activity, entityId: parent.id, action: "REVISION_VOIDED", message: `discarded the draft ${label(parent, revision)}` });
  });
  return { id: revision.id };
}

/* -------------------------------------------------------------------------- */
/* Frozen files                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Whether a Document may take a new version. A file carried by a submitted
 * revision or an issued transmittal is part of the record and is never
 * overwritten — a correction is a new revision (§69, §103, §123, §289).
 */
export async function frozenDocumentReason(documentId: string): Promise<string | null> {
  const [documentRevisions, submittalRevisions, transmittals] = await Promise.all([
    prisma.engineeringDocumentRevision.count({ where: { documentId, status: { notIn: ["DRAFT", "VOID"] } } }),
    prisma.technicalSubmittalRevision.count({ where: { documentId, status: { notIn: ["DRAFT", "VOID"] } } }),
    prisma.documentTransmittalItem.count({ where: { documentId, transmittal: { status: "ISSUED" } } }),
  ]);
  if (documentRevisions || submittalRevisions) return "This file belongs to a submitted revision. Add a new revision instead of replacing it.";
  if (transmittals) return "This file was issued on a transmittal and cannot be replaced.";
  return null;
}

/** Sharing classification is metadata for a future portal; it opens nothing today (§128-§132, §255). */
export async function setSharingClassification(context: UserContext, kind: RevisionKind, parentId: string, documentId: string, classification: SharingClassification) {
  const parent = await loadRevisionParent(context, kind, parentId);
  assertPermission(context, KIND[kind].edit);
  // A void or closed record, or one on an archived project, is history: its files' metadata is too (PRD #47 §85).
  assertLive(parent);
  if (!filesOpen(context)) throw new AccessError("FORBIDDEN", "You cannot change documents.");
  const document = await prisma.document.findFirst({ where: { id: documentId, companyId: context.companyId, entityType: KIND[kind].record, entityId: parent.id }, select: { id: true, sharingClassification: true } });
  if (!document) throw fail("REVISION_FILE_INVALID", "That file is not on this record.", "NOT_FOUND");
  await prisma.$transaction(async (tx) => {
    await tx.document.update({ where: { id: document.id }, data: { sharingClassification: classification } });
    await recordUserAction(context, { actionKey: kind === "document" ? AuditAction.ENGINEERING_DOCUMENT_UPDATED : AuditAction.SUBMITTAL_UPDATED, entity: { type: KIND[kind].record, id: parent.id, label: parent.number }, projectId: parent.projectId, before: { documentId, sharingClassification: document.sharingClassification }, after: { documentId, sharingClassification: classification } }, { tx });
  });
}
