import { Prisma } from "@prisma/client";
import { z } from "zod";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
import { delegationBetween } from "@/lib/core/approvals/approval-delegations";
import { AuditAction } from "@/lib/core/audit/audit-policy.registry";
import { recordUserAction } from "@/lib/core/audit/audit.service";
import { NotificationEvent } from "@/lib/core/notifications/notification.events";
import { enqueueNotificationEvent } from "@/lib/core/notifications/notification.service";
import { prisma } from "@/lib/database/prisma";
import { recordActivity } from "@/lib/modules/shared/activity";
import { findReadableDocument } from "../document.parent-access";
import { requireDocument } from "../storage/storage-access.service";
import { documentReviewable } from "./version.service";

/**
 * Document review (PRD #38 §59-§65, §68).
 *
 * Deliberately small: a version is sent to named reviewers, each approves or
 * rejects it, and the version's state follows — all approved is APPROVED, any
 * rejection is REJECTED. That is a parallel approval whose completion rule is
 * ALL (PRD #41 §22). No workflow engine and no stages. A reviewer away can
 * lend the review to a delegate who could review the document themselves, and
 * a review can be reassigned to somebody else explicitly (PRD #41 §33, §236).
 *
 * Three rules hold throughout:
 *
 *   - a reviewer is only ever somebody who could open the document right now
 *     (same company, active, parent record in scope, `document.review.decide`)
 *   - nobody reviews a version they asked to have reviewed (PRD #38 §62)
 *   - approving a document approves the document: no invoice, contract, order
 *     or safety record changes because a file on it was approved (PRD #38 §64)
 */

export const requestReviewSchema = z.object({
  reviewerMemberId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(1000).optional(),
  /** When a decision is needed by — a calendar date; it puts the review on the calendar (PRD #39 §61). */
  dueDate: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date in the form YYYY-MM-DD.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export const decideReviewSchema = z.object({
  note: z.string().trim().max(5000).optional(),
});

export const reassignReviewSchema = z.object({
  reviewerMemberId: z.string().trim().min(1).max(64),
  reason: z.string().trim().max(1000).optional(),
});

/** The attention items one review raised — per reviewer, keyed by the review (PRD #41 §227). */
async function resolveReviewAttention(tx: Prisma.TransactionClient, companyId: string, reviewId: string): Promise<void> {
  await tx.attentionItem.updateMany({
    where: {
      companyId,
      conditionKey: { in: ["PENDING_APPROVAL", "APPROVAL_OVERDUE"] },
      entityType: "document",
      dedupeKey: { endsWith: `:${reviewId}` },
      status: "ACTIVE",
    },
    data: { status: "RESOLVED", resolvedAt: new Date() },
  });
}

/**
 * Whether this person may decide a review assigned to someone else, because
 * that reviewer delegated their approvals to them. The delegate must be able
 * to review the document in their own right, and so must the reviewer still:
 * a delegation lends authority, never access (PRD #41 §33, §34).
 */
async function reviewDelegation(context: UserContext, review: { reviewerMemberId: string; documentId: string }): Promise<string | null> {
  if (review.reviewerMemberId === context.membershipId) return null;
  const lent = await delegationBetween(context.companyId, review.reviewerMemberId, context.membershipId, "documents");
  if (!lent) return null;
  const [reviewerStill] = await eligibleReviewerIds(context.companyId, review.documentId, [review.reviewerMemberId]);
  return reviewerStill ? review.reviewerMemberId : null;
}

export type EligibleReviewerDTO = { memberId: string; fullName: string; jobTitle: string | null };

/** Members who could review this document: the question asked in their own contexts. */
async function eligibleReviewerIds(companyId: string, documentId: string, candidateIds: string[]): Promise<string[]> {
  const contexts = await buildMemberContexts(companyId, candidateIds);
  const eligible: string[] = [];
  for (const [memberId, memberContext] of contexts) {
    if (!can(memberContext, "document.review.decide")) continue;
    if (await findReadableDocument(memberContext, documentId)) eligible.push(memberId);
  }
  return eligible;
}

export async function listEligibleReviewers(
  context: UserContext,
  documentId: string,
  search: string | undefined,
): Promise<EligibleReviewerDTO[]> {
  const document = await requireDocument(context, documentId);
  if (!can(context, "document.review.request")) return [];

  const term = search?.trim().slice(0, 80);
  const candidates = await prisma.companyMember.findMany({
    where: {
      companyId: context.companyId,
      status: "ACTIVE",
      id: { not: context.membershipId },
      user: {
        status: "ACTIVE",
        ...(term ? { OR: [{ firstName: { contains: term, mode: "insensitive" } }, { lastName: { contains: term, mode: "insensitive" } }] } : {}),
      },
    },
    orderBy: [{ user: { firstName: "asc" } }],
    take: 60,
    select: { id: true, jobTitle: true, user: { select: { firstName: true, lastName: true } } },
  });
  const eligible = new Set(await eligibleReviewerIds(context.companyId, document.id, candidates.map((row) => row.id)));
  return candidates
    .filter((row) => eligible.has(row.id))
    .slice(0, 20)
    .map((row) => ({ memberId: row.id, fullName: `${row.user.firstName} ${row.user.lastName}`, jobTitle: row.jobTitle }));
}

export async function requestReview(
  context: UserContext,
  versionId: string,
  input: z.infer<typeof requestReviewSchema>,
): Promise<{ reviewId: string }> {
  if (!can(context, "document.review.request")) throw new AccessError("FORBIDDEN", "You cannot request reviews.");

  // The version is found through a document this caller can read, never on
  // its own id (PRD #38 §150).
  const versionRow = await prisma.documentVersion.findFirst({
    where: { id: versionId, companyId: context.companyId },
    select: { id: true, documentId: true, versionNumber: true, storageStatus: true, reviewState: true, uploadedByMemberId: true },
  });
  if (!versionRow) throw new AccessError("NOT_FOUND");
  const document = await requireDocument(context, versionRow.documentId).catch(() => {
    throw new AccessError("NOT_FOUND");
  });

  if (document.status === "ARCHIVED" || document.archivedAt) throw new AccessError("CONFLICT", "DOCUMENT_ARCHIVED");
  if (!documentReviewable(document)) throw new AccessError("CONFLICT", "REVIEW_NOT_AVAILABLE");
  if (versionRow.storageStatus !== "AVAILABLE") throw new AccessError("CONFLICT", "VERSION_NOT_AVAILABLE");
  if (versionRow.reviewState === "APPROVED" || versionRow.reviewState === "SUPERSEDED") {
    throw new AccessError("CONFLICT", "VERSION_ALREADY_DECIDED");
  }

  if (input.reviewerMemberId === context.membershipId) {
    throw new AccessError("VALIDATION_ERROR", "SELF_REVIEW_NOT_ALLOWED");
  }
  const [eligible] = await eligibleReviewerIds(context.companyId, document.id, [input.reviewerMemberId]);
  if (!eligible) throw new AccessError("VALIDATION_ERROR", "REVIEWER_NOT_ALLOWED");

  try {
    return await prisma.$transaction(async (tx) => {
      const review = await tx.documentReview.create({
        data: {
          companyId: context.companyId,
          documentId: document.id,
          documentVersionId: versionRow.id,
          requestedByMemberId: context.membershipId,
          reviewerMemberId: eligible,
          status: "PENDING",
          requestNote: input.note || null,
          // Kept at midday UTC like every business date, so it is the same day in every zone.
          dueAt: input.dueDate ? new Date(`${input.dueDate}T12:00:00.000Z`) : null,
          pendingKey: `${versionRow.id}:${eligible}`,
        },
        select: { id: true },
      });
      await tx.documentVersion.update({ where: { id: versionRow.id }, data: { reviewState: "IN_REVIEW" } });

      await recordActivity(tx, context, {
        module: "documents",
        entityType: "Document",
        entityId: document.id,
        action: "DOCUMENT_REVIEW_REQUESTED",
        message: `requested a review of version ${versionRow.versionNumber}`,
        metadata: { versionNumber: versionRow.versionNumber, reviewerMemberId: eligible } as Prisma.InputJsonValue,
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.DOCUMENT_REVIEW_REQUESTED,
          entity: { type: "Document", id: document.id, label: document.name },
          projectId: document.projectId,
          after: { versionNumber: versionRow.versionNumber, reviewerMemberId: eligible },
        },
        { tx },
      );
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.DOCUMENT_REVIEW_REQUESTED,
        moduleKey: "documents",
        entityType: "document",
        entityId: document.id,
        actorMemberId: context.membershipId,
        projectId: document.projectId,
        payload: {
          reviewId: review.id,
          reviewerMemberId: eligible,
          requesterName: context.fullName,
          documentName: document.name,
          versionNumber: versionRow.versionNumber,
        },
      });

      return { reviewId: review.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccessError("CONFLICT", "REVIEW_ALREADY_PENDING");
    }
    throw error;
  }
}

export async function decideReview(
  context: UserContext,
  reviewId: string,
  decision: "APPROVED" | "REJECTED",
  note: string | undefined,
): Promise<{ versionState: string }> {
  const review = await prisma.documentReview.findFirst({
    where: { id: reviewId, companyId: context.companyId },
    select: { id: true, documentId: true, documentVersionId: true, reviewerMemberId: true, requestedByMemberId: true, status: true },
  });
  if (!review) throw new AccessError("NOT_FOUND");

  // Access to the document right now, not when the review was requested.
  const document = await requireDocument(context, review.documentId).catch(() => {
    throw new AccessError("NOT_FOUND");
  });
  const onBehalfOf = await reviewDelegation(context, review);
  if ((review.reviewerMemberId !== context.membershipId && !onBehalfOf) || !can(context, "document.review.decide")) {
    throw new AccessError("FORBIDDEN", "This review is assigned to someone else.");
  }
  // Belt and braces: the request refused it, and a changed membership must not create it.
  if (review.requestedByMemberId === context.membershipId) throw new AccessError("FORBIDDEN", "SELF_REVIEW_NOT_ALLOWED");
  if (decision === "REJECTED" && !note?.trim()) throw new AccessError("VALIDATION_ERROR", "REJECTION_NOTE_REQUIRED");

  return prisma.$transaction(async (tx) => {
    // Conditional on PENDING: two clicks, or two tabs, settle it once (PRD #38 §154).
    const settled = await tx.documentReview.updateMany({
      where: { id: review.id, status: "PENDING" },
      data: {
        status: decision,
        decisionNote: note?.trim() || null,
        decidedAt: new Date(),
        decidedByMemberId: context.membershipId,
        pendingKey: null,
      },
    });
    if (settled.count === 0) throw new AccessError("CONFLICT", "REVIEW_ALREADY_DECIDED");
    await resolveReviewAttention(tx, context.companyId, review.id);

    const version = await tx.documentVersion.findUniqueOrThrow({
      where: { id: review.documentVersionId },
      select: { id: true, versionNumber: true, uploadedByMemberId: true },
    });

    let versionState: "IN_REVIEW" | "APPROVED" | "REJECTED" = "IN_REVIEW";
    const superseded: number[] = [];

    if (decision === "REJECTED") {
      versionState = "REJECTED";
      await tx.documentReview.updateMany({
        where: { documentVersionId: version.id, status: "PENDING" },
        data: { status: "CANCELLED", decidedAt: new Date(), pendingKey: null },
      });
      await tx.documentVersion.update({ where: { id: version.id }, data: { reviewState: "REJECTED" } });
    } else {
      const stillPending = await tx.documentReview.count({ where: { documentVersionId: version.id, status: "PENDING" } });
      if (stillPending === 0) {
        versionState = "APPROVED";
        await tx.documentVersion.update({ where: { id: version.id }, data: { reviewState: "APPROVED" } });
        // Older approved versions are superseded, not deleted: their files and
        // their review history stay (PRD #38 §65).
        const older = await tx.documentVersion.findMany({
          where: { documentId: review.documentId, reviewState: "APPROVED", versionNumber: { lt: version.versionNumber } },
          select: { id: true, versionNumber: true },
        });
        if (older.length > 0) {
          await tx.documentVersion.updateMany({
            where: { id: { in: older.map((row) => row.id) } },
            data: { reviewState: "SUPERSEDED", supersededAt: new Date() },
          });
          superseded.push(...older.map((row) => row.versionNumber));
        }
      }
    }

    await recordActivity(tx, context, {
      module: "documents",
      entityType: "Document",
      entityId: review.documentId,
      action: decision === "APPROVED" ? "DOCUMENT_REVIEW_APPROVED" : "DOCUMENT_REVIEW_REJECTED",
      message: `${decision === "APPROVED" ? "approved" : "rejected"} version ${version.versionNumber}${onBehalfOf ? " on behalf of the assigned reviewer" : ""}`,
      metadata: { versionNumber: version.versionNumber, ...(onBehalfOf ? { onBehalfOfMemberId: onBehalfOf } : {}) } as Prisma.InputJsonValue,
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.DOCUMENT_REVIEW_DECIDED,
        entity: { type: "Document", id: review.documentId, label: document.name },
        projectId: document.projectId,
        after: { status: decision, versionNumber: version.versionNumber, ...(onBehalfOf ? { onBehalfOfMemberId: onBehalfOf } : {}) },
      },
      { tx },
    );

    const base = {
      companyId: context.companyId,
      moduleKey: "documents",
      entityType: "document",
      entityId: review.documentId,
      actorMemberId: context.membershipId,
      projectId: document.projectId,
    };
    if (versionState !== "IN_REVIEW") {
      await enqueueNotificationEvent(tx, {
        ...base,
        eventType: versionState === "APPROVED" ? NotificationEvent.DOCUMENT_APPROVED : NotificationEvent.DOCUMENT_REJECTED,
        payload: {
          documentName: document.name,
          versionNumber: version.versionNumber,
          requestedByMemberId: review.requestedByMemberId,
          uploadedByMemberId: version.uploadedByMemberId,
          reviewerName: context.fullName,
          note: note?.trim() || null,
        },
      });
    }
    for (const number of superseded) {
      await enqueueNotificationEvent(tx, {
        ...base,
        eventType: NotificationEvent.DOCUMENT_SUPERSEDED,
        payload: { documentName: document.name, supersededVersionNumber: number, versionNumber: version.versionNumber },
      });
    }

    return { versionState };
  });
}

/**
 * Hands a pending review to somebody else (PRD #41 §235-§237): the reviewer
 * has left, is away for good, or was the wrong person. An explicit command —
 * never a side effect of deactivating someone — taken by whoever asked for the
 * review or anybody who may manage the document, audited, and told to both
 * reviewers. The new reviewer must be eligible exactly as at request time.
 */
export async function reassignReview(
  context: UserContext,
  reviewId: string,
  input: z.infer<typeof reassignReviewSchema>,
): Promise<{ reviewId: string }> {
  const review = await prisma.documentReview.findFirst({
    where: { id: reviewId, companyId: context.companyId },
    select: { id: true, documentId: true, documentVersionId: true, reviewerMemberId: true, requestedByMemberId: true, status: true },
  });
  if (!review) throw new AccessError("NOT_FOUND");
  const document = await requireDocument(context, review.documentId).catch(() => {
    throw new AccessError("NOT_FOUND");
  });
  const mayReassign = review.requestedByMemberId === context.membershipId ? can(context, "document.review.request") : can(context, "document.review.request") && can(context, "document.archive");
  if (!mayReassign) throw new AccessError("FORBIDDEN", "Only whoever asked for this review, or a document manager, can reassign it.");
  if (review.status !== "PENDING") throw new AccessError("CONFLICT", "REVIEW_ALREADY_DECIDED", { code: "APPROVAL_ALREADY_DECIDED" });

  const target = input.reviewerMemberId;
  if (target === review.reviewerMemberId) throw new AccessError("VALIDATION_ERROR", "REVIEWER_UNCHANGED");
  if (target === review.requestedByMemberId) throw new AccessError("VALIDATION_ERROR", "SELF_REVIEW_NOT_ALLOWED");
  const [eligible] = await eligibleReviewerIds(context.companyId, document.id, [target]);
  if (!eligible) throw new AccessError("VALIDATION_ERROR", "REVIEWER_NOT_ALLOWED");

  const names = await prisma.companyMember.findMany({
    where: { id: { in: [review.reviewerMemberId, target] }, companyId: context.companyId },
    select: { id: true, user: { select: { firstName: true, lastName: true } } },
  });
  const nameOf = (id: string) => {
    const row = names.find((member) => member.id === id);
    return row ? `${row.user.firstName} ${row.user.lastName}` : "a colleague";
  };

  try {
    return await prisma.$transaction(async (tx) => {
      const moved = await tx.documentReview.updateMany({
        where: { id: review.id, status: "PENDING", reviewerMemberId: review.reviewerMemberId },
        data: { reviewerMemberId: target, pendingKey: `${review.documentVersionId}:${target}` },
      });
      if (moved.count === 0) throw new AccessError("CONFLICT", "REVIEW_ALREADY_DECIDED", { code: "APPROVAL_ALREADY_DECIDED" });
      await resolveReviewAttention(tx, context.companyId, review.id);

      await recordActivity(tx, context, {
        module: "documents",
        entityType: "Document",
        entityId: document.id,
        action: "DOCUMENT_REVIEW_REASSIGNED",
        message: `reassigned a review from ${nameOf(review.reviewerMemberId)} to ${nameOf(target)}`,
        metadata: { reviewId: review.id, fromMemberId: review.reviewerMemberId, toMemberId: target } as Prisma.InputJsonValue,
      });
      await recordUserAction(
        context,
        {
          actionKey: AuditAction.APPROVAL_REASSIGNED,
          entity: { type: "document", id: document.id, label: document.name },
          projectId: document.projectId,
          before: { from: review.reviewerMemberId },
          after: { approvalId: review.id, providerKey: "documents", sourceType: "document", from: review.reviewerMemberId, to: target },
          reason: input.reason || null,
        },
        { tx },
      );
      await enqueueNotificationEvent(tx, {
        companyId: context.companyId,
        eventType: NotificationEvent.APPROVAL_REASSIGNED,
        moduleKey: "documents",
        entityType: "document",
        entityId: document.id,
        actorMemberId: context.membershipId,
        projectId: document.projectId,
        payload: { recordLabel: document.name, fromMemberId: review.reviewerMemberId, toMemberId: target, toName: nameOf(target), reviewId: review.id },
      });
      return { reviewId: review.id };
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AccessError("CONFLICT", "REVIEW_ALREADY_PENDING");
    }
    throw error;
  }
}
