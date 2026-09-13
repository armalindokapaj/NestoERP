import { Prisma } from "@prisma/client";
import { z } from "zod";

import { can } from "@/lib/access/can";
import { AccessError } from "@/lib/access/guards";
import { buildMemberContexts } from "@/lib/context/member-context";
import type { UserContext } from "@/lib/context/types";
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
 * rejection is REJECTED. No workflow engine, no stages, no delegation.
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
  note: z.string().trim().max(1000).optional(),
});

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
  if (review.reviewerMemberId !== context.membershipId || !can(context, "document.review.decide")) {
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
      message: `${decision === "APPROVED" ? "approved" : "rejected"} version ${version.versionNumber}`,
      metadata: { versionNumber: version.versionNumber } as Prisma.InputJsonValue,
    });
    await recordUserAction(
      context,
      {
        actionKey: AuditAction.DOCUMENT_REVIEW_DECIDED,
        entity: { type: "Document", id: review.documentId, label: document.name },
        projectId: document.projectId,
        after: { status: decision, versionNumber: version.versionNumber },
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
