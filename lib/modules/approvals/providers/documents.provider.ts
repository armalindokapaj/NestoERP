import type { DocumentReviewStatus, Prisma } from "@prisma/client";

import { can, canAccessModule, isModuleEnabled } from "@/lib/access/can";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { delegationsTo } from "@/lib/core/approvals/approval-delegations";
import { prisma } from "@/lib/database/prisma";
import { buildDocumentAccessWhere, findReadableDocument } from "@/lib/modules/documents/document.parent-access";
import { formatFileSize, isPreviewable } from "@/lib/modules/documents/document.files";
import { decideReview } from "@/lib/modules/documents/versions/review.service";
import {
  approvalError,
  dateRange,
  keysetWhere,
  memberNames,
  notFound,
  personOrUnknown,
  translateSourceError,
  type ApprovalProvider,
  type ProviderDetail,
  type ProviderItem,
  type ProviderQuery,
} from "../approvals.provider";
import type { ApprovalStepDTO, UnifiedApprovalHistoryEntry, UnifiedApprovalStatus } from "../approvals.types";
import { WINDOW } from "../approvals.cycle-provider";
import { excludesAmountFilter, formatDate, startOfToday } from "./shared";

/**
 * Document reviews in the Center (PRD #41 §62, §63, §265, §274).
 *
 * Each review request is one approval, addressed to one reviewer. Several
 * reviewers on the same version decide in parallel, and the version's own
 * rule completes it: every reviewer must approve, any rejection rejects
 * (§22). A reviewer away may have lent their reviews to a delegate who could
 * review the document in their own right (§33).
 *
 * The decision is the Documents service's `decideReview`, which re-checks the
 * reviewer, the requester and the document inside its own transaction.
 *
 * Queries (§250), always joined to documents the reader can open now:
 *   waiting    status = PENDING, reviewer = me or a delegator       [companyId, reviewerMemberId, status]
 *   requested  requestedByMemberId = me                             [companyId, documentId]
 *   decided    decidedByMemberId = me, status = outcome
 *   history    reviews on readable documents, approvals.history.view [companyId, status, dueAt]
 */

const KEY = "documents" as const;

const SELECT = {
  id: true,
  documentId: true,
  documentVersionId: true,
  requestedByMemberId: true,
  reviewerMemberId: true,
  status: true,
  requestNote: true,
  decisionNote: true,
  decidedByMemberId: true,
  dueAt: true,
  requestedAt: true,
  decidedAt: true,
  version: { select: { versionNumber: true, originalFileName: true, extension: true, sizeBytes: true, storageStatus: true, reviewState: true, createdAt: true, uploadedByMemberId: true } },
} satisfies Prisma.DocumentReviewSelect;

type ReviewRow = Prisma.DocumentReviewGetPayload<{ select: typeof SELECT }>;

const STATUS: Record<DocumentReviewStatus, UnifiedApprovalStatus> = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  CANCELLED: "CANCELLED",
};

async function readableDocuments(context: UserContext, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; name: string; project: { id: string; name: string; code: string } | null }>();
  const rows = await prisma.document.findMany({
    where: { AND: [await buildDocumentAccessWhere(context), { id: { in: [...new Set(ids)] } }] },
    select: { id: true, name: true, project: { select: { id: true, name: true, code: true } } },
  });
  return new Map(rows.map((row) => [row.id, row]));
}

/** Delegators whose pending reviews this person may take, still eligible themselves. */
async function lendersFor(context: UserContext): Promise<string[]> {
  if (!can(context, "document.review.decide")) return [];
  return (await delegationsTo(context.companyId, context.membershipId, KEY)).map((row) => row.fromMemberId);
}

async function stillReviewable(companyId: string, reviewerId: string, documentId: string): Promise<boolean> {
  const contexts = await buildMemberContexts(companyId, [reviewerId]);
  const reviewer = contexts.get(reviewerId);
  return Boolean(reviewer && can(reviewer, "document.review.decide") && (await findReadableDocument(reviewer, documentId)));
}

async function buildItems(context: UserContext, entries: Array<{ row: ReviewRow; sortAt: Date }>, lenders: string[]): Promise<ProviderItem[]> {
  const documents = await readableDocuments(context, entries.map((entry) => entry.row.documentId));
  const rows = entries.filter((entry) => documents.has(entry.row.documentId));
  const names = await memberNames(context.companyId, rows.flatMap(({ row }) => [row.requestedByMemberId, row.reviewerMemberId, row.decidedByMemberId]));
  const today = startOfToday();
  const items: ProviderItem[] = [];
  for (const { row, sortAt } of rows) {
    const document = documents.get(row.documentId)!;
    const pending = row.status === "PENDING";
    const mine = row.reviewerMemberId === context.membershipId;
    const lent = !mine && lenders.includes(row.reviewerMemberId) && pending && (await stillReviewable(context.companyId, row.reviewerMemberId, row.documentId));
    const self = row.requestedByMemberId === context.membershipId;
    const able = pending && (mine || lent) && !self && can(context, "document.review.decide");
    const overdue = pending && row.dueAt !== null && row.dueAt < today;
    items.push({
      id: `${KEY}:${row.id}`,
      providerKey: KEY,
      sourceType: "document",
      sourceId: row.documentId,
      approvalId: row.id,
      sourceLabel: "Document review",
      title: document.name,
      subtitle: `Version ${row.version.versionNumber}${row.version.originalFileName ? ` · ${row.version.originalFileName}` : ""}`,
      reference: `v${row.version.versionNumber}`,
      status: STATUS[row.status],
      priority: overdue ? "HIGH" : "NORMAL",
      amount: null,
      project: document.project ? { id: document.project.id, name: document.project.name, code: document.project.code } : null,
      requester: personOrUnknown(names, row.requestedByMemberId),
      requestedAt: row.requestedAt.toISOString(),
      dueAt: pending && row.dueAt ? row.dueAt.toISOString() : null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decidedBy: row.decidedByMemberId ? personOrUnknown(names, row.decidedByMemberId) : null,
      currentStep: null,
      totalSteps: null,
      stepLabel: null,
      href: `/documents/${row.documentId}`,
      canApprove: able,
      canReject: able,
      canReturn: false,
      requiresStrongConfirmation: false,
      blockedReason: pending && !able ? (self ? "You asked for this review, so somebody else decides it." : `Assigned to ${personOrUnknown(names, row.reviewerMemberId).name}.`) : null,
      onBehalfOf: able && lent ? personOrUnknown(names, row.reviewerMemberId) : null,
      version: 1,
      sortAt: sortAt.toISOString(),
    });
  }
  return items;
}

export const documentReviewProvider: ApprovalProvider = {
  key: KEY,
  moduleKey: "documents",
  label: "Documents",
  recordTypes: ["document"],

  available: (context) => isModuleEnabled(context, "documents") && canAccessModule(context, "documents") && can(context, "document.view"),

  async queue(context: UserContext, query: ProviderQuery) {
    if (excludesAmountFilter(query)) return [];
    const me = context.membershipId;
    const base: Prisma.DocumentReviewWhereInput[] = [{ companyId: context.companyId }];
    if (query.requesterId) base.push({ requestedByMemberId: query.requesterId });
    if (query.projectId || query.q) {
      const matching = await prisma.document.findMany({
        where: {
          AND: [
            await buildDocumentAccessWhere(context),
            query.projectId ? { projectId: query.projectId } : {},
            query.q ? { OR: [{ name: { contains: query.q, mode: "insensitive" } }, { originalFileName: { contains: query.q, mode: "insensitive" } }] } : {},
          ],
        },
        select: { id: true },
        take: 500,
      });
      base.push({ documentId: { in: matching.map((row) => row.id) } });
    }
    const statuses = query.statuses.filter((status) => status in STATUS) as DocumentReviewStatus[];
    const range = dateRange(query);
    const lenders = await lendersFor(context);

    let dateField: "requestedAt" | "decidedAt" = "requestedAt";
    switch (query.tab) {
      case "waiting":
        if (!can(context, "document.review.decide")) return [];
        base.push({ status: "PENDING", reviewerMemberId: { in: [me, ...lenders] }, requestedByMemberId: { not: me } });
        if (range) base.push({ requestedAt: range });
        break;
      case "requested":
        base.push({ requestedByMemberId: me });
        if (statuses.length) base.push({ status: { in: statuses } });
        if (range) base.push({ requestedAt: range });
        break;
      case "approved":
      case "rejected":
        dateField = "decidedAt";
        base.push({ decidedByMemberId: me, status: query.tab === "approved" ? "APPROVED" : "REJECTED" });
        if (range) base.push({ decidedAt: range });
        break;
      case "returned":
        return [];
      case "history":
        if (!can(context, "approvals.history.view")) return [];
        if (statuses.length) base.push({ status: { in: statuses } });
        if (range) base.push({ requestedAt: range });
        break;
    }

    const keyset = query.tab === "waiting" ? null : keysetWhere(dateField, KEY, query);
    const rows = await prisma.documentReview.findMany({
      where: { AND: [...base, ...(keyset ? [keyset as Prisma.DocumentReviewWhereInput] : [])] },
      orderBy: [{ [dateField]: query.order }, { id: query.order }],
      take: query.tab === "waiting" ? WINDOW : Math.min(WINDOW, query.limit * 2),
      select: SELECT,
    });
    const items = await buildItems(context, rows.map((row) => ({ row, sortAt: (row[dateField] ?? row.requestedAt) as Date })), lenders);
    // A delegated review whose reviewer can no longer review it stays with the reviewer.
    const visible = query.tab === "waiting" ? items.filter((item) => item.canApprove) : items;
    return visible.slice(0, query.tab === "waiting" ? WINDOW : query.limit);
  },

  async detail(context, approvalId): Promise<ProviderDetail | null> {
    const row = await prisma.documentReview.findFirst({ where: { id: approvalId, companyId: context.companyId }, select: SELECT });
    if (!row) return null;
    const document = await findReadableDocument(context, row.documentId);
    if (!document) return null;
    const lenders = await lendersFor(context);
    const [item] = await buildItems(context, [{ row, sortAt: row.requestedAt }], lenders);
    if (!item) return null;

    const [siblings, all, full] = await Promise.all([
      prisma.documentReview.findMany({ where: { documentVersionId: row.documentVersionId }, orderBy: { requestedAt: "asc" }, select: { id: true, reviewerMemberId: true, status: true, decidedByMemberId: true, decidedAt: true } }),
      prisma.documentReview.findMany({
        where: { documentId: row.documentId, companyId: context.companyId },
        orderBy: { requestedAt: "asc" },
        take: 60,
        select: { id: true, reviewerMemberId: true, requestedByMemberId: true, status: true, decidedByMemberId: true, decidedAt: true, requestedAt: true, decisionNote: true, requestNote: true, version: { select: { versionNumber: true } } },
      }),
      prisma.document.findUnique({ where: { id: row.documentId }, select: { name: true, description: true, project: { select: { name: true } }, uploadedBy: { select: { user: { select: { firstName: true, lastName: true } } } } } }),
    ]);
    const names = await memberNames(context.companyId, [...all.flatMap((review) => [review.reviewerMemberId, review.requestedByMemberId, review.decidedByMemberId])]);

    const steps: ApprovalStepDTO[] = siblings.map((review, index) => ({
      number: index + 1,
      label: personOrUnknown(names, review.reviewerMemberId).name,
      status: review.status === "PENDING" ? "PENDING" : review.status,
      decidedBy: review.decidedByMemberId ? personOrUnknown(names, review.decidedByMemberId).name : null,
      decidedAt: review.decidedAt?.toISOString() ?? null,
      onBehalfOf: review.decidedByMemberId && review.decidedByMemberId !== review.reviewerMemberId ? personOrUnknown(names, review.reviewerMemberId).name : null,
      decidedByMemberId: review.decidedByMemberId,
      onBehalfOfMemberId: review.decidedByMemberId && review.decidedByMemberId !== review.reviewerMemberId ? review.reviewerMemberId : null,
      labelMemberId: review.reviewerMemberId,
    }));

    const history: UnifiedApprovalHistoryEntry[] = [];
    for (const review of all) {
      history.push({
        id: `${review.id}:requested`,
        action: `Review of v${review.version.versionNumber} requested from ${personOrUnknown(names, review.reviewerMemberId).name}`,
        actorName: personOrUnknown(names, review.requestedByMemberId).name,
        actorRole: null,
        actor: personOrUnknown(names, review.requestedByMemberId),
        onBehalfOf: null,
        occurredAt: review.requestedAt.toISOString(),
        note: review.requestNote,
        step: null,
        tone: "info",
      });
      if (review.status !== "PENDING" && review.decidedAt) {
        history.push({
          id: `${review.id}:decided`,
          action: review.status === "APPROVED" ? `v${review.version.versionNumber} approved` : review.status === "REJECTED" ? `v${review.version.versionNumber} rejected` : "Review withdrawn",
          actorName: review.decidedByMemberId ? personOrUnknown(names, review.decidedByMemberId).name : null,
          actorRole: null,
          actor: review.decidedByMemberId ? personOrUnknown(names, review.decidedByMemberId) : null,
          onBehalfOf: null,
          occurredAt: review.decidedAt.toISOString(),
          note: review.decisionNote,
          step: null,
          tone: review.status === "APPROVED" ? "success" : review.status === "REJECTED" ? "danger" : "neutral",
        });
      }
    }

    const warnings = [];
    if (row.status === "PENDING" && row.dueAt && row.dueAt < startOfToday()) {
      warnings.push({ code: "REVIEW_OVERDUE", message: `The review was due ${formatDate(row.dueAt)}.`, severity: "WARNING" as const });
    }
    if (row.version.reviewState === "SUPERSEDED") warnings.push({ code: "VERSION_SUPERSEDED", message: "A newer approved version has replaced this one.", severity: "INFO" as const });
    if (item.onBehalfOf) warnings.push({ code: "DELEGATED", message: `You would decide this on behalf of ${item.onBehalfOf.name}, under their delegation.`, severity: "INFO" as const });
    const reviewer = await prisma.companyMember.findFirst({ where: { id: row.reviewerMemberId }, select: { status: true } });
    if (row.status === "PENDING" && reviewer?.status !== "ACTIVE") {
      warnings.push({ code: "APPROVER_INACTIVE", message: "The assigned reviewer is no longer active. Reassign the review from the document.", severity: "CRITICAL" as const });
    }

    return {
      item,
      reason: "A version is approved before it is relied on as the current document.",
      summary: [
        { label: "Document", value: full?.name ?? item.title },
        { label: "Version", value: String(row.version.versionNumber), emphasis: "strong" },
        { label: "File", value: row.version.originalFileName ?? "—" },
        { label: "Size", value: row.version.sizeBytes ? formatFileSize(row.version.sizeBytes) : "—" },
        { label: "Project", value: full?.project?.name ?? "—" },
        { label: "Due", value: formatDate(row.dueAt) },
      ],
      description: row.requestNote,
      warnings,
      documents: [
        {
          id: row.documentId,
          name: full?.name ?? item.title,
          fileName: row.version.originalFileName,
          extension: row.version.extension,
          sizeLabel: row.version.sizeBytes ? formatFileSize(row.version.sizeBytes) : null,
          versionNumber: row.version.versionNumber,
          uploadedAt: row.version.createdAt.toISOString(),
          href: `/documents/${row.documentId}`,
          previewable: row.version.storageStatus === "AVAILABLE" && isPreviewable(row.version.extension),
        },
      ],
      documentsAvailable: true,
      history,
      chainMode: siblings.length > 1 ? "PARALLEL" : "SINGLE",
      completionRule: siblings.length > 1 ? "ALL" : null,
      steps: siblings.length > 1 ? steps : [],
      commentsEnabled: true,
      discussion: { parentType: "document", parentId: row.documentId },
      sourceRecord: { label: "Open full document", href: `/documents/${row.documentId}` },
    };
  },

  async findByRecord(context, recordType, recordId) {
    if (recordType !== "document") return null;
    if (!(await findReadableDocument(context, recordId))) return null;
    const rows = await prisma.documentReview.findMany({
      where: { companyId: context.companyId, documentId: recordId },
      orderBy: { requestedAt: "desc" },
      take: 20,
      select: { id: true, status: true, reviewerMemberId: true },
    });
    return (
      rows.find((row) => row.status === "PENDING" && row.reviewerMemberId === context.membershipId) ??
      rows.find((row) => row.status === "PENDING") ??
      rows[0]
    )?.id ?? null;
  },

  async decide(context, approvalId, decision, input) {
    const row = await prisma.documentReview.findFirst({ where: { id: approvalId, companyId: context.companyId }, select: SELECT });
    if (!row || !(await findReadableDocument(context, row.documentId))) throw notFound();
    if (decision === "RETURN") throw approvalError("APPROVAL_RETURN_NOT_SUPPORTED", "A document version is approved or rejected; upload a new version to revise it.", "VALIDATION_ERROR");
    const wanted = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    if (row.status !== "PENDING") {
      if (row.decidedByMemberId === context.membershipId && row.status === wanted) return { outcome: wanted, alreadyApplied: true };
      throw approvalError("APPROVAL_ALREADY_DECIDED", "This approval was already decided.");
    }
    if (row.requestedByMemberId === context.membershipId) {
      throw approvalError("APPROVAL_SELF_APPROVAL_BLOCKED", "You asked for this review, so somebody else has to decide it.", "FORBIDDEN");
    }
    try {
      await decideReview(context, row.id, wanted, input.note ?? undefined);
    } catch (error) {
      translateSourceError(error);
    }
    return { outcome: wanted, alreadyApplied: false };
  },
};
