import { prisma } from "@/lib/database/prisma";
import type { ClassifiedError } from "./job.errors";

/**
 * The history of every failed attempt (PRD #51 §36, §39, §42, §205).
 *
 * Written for a failed scheduled run and for each failed attempt of an outbox
 * event. Never updated except to note that an operator retried it, and never
 * deleted by a retry — so the question "what happened to this event?" has an
 * answer after it has been fixed.
 */

export type JobFailureInput = {
  jobKey: string;
  companyId?: string | null;
  sourceType: "job" | "notification_event";
  sourceId?: string | null;
  attempt: number;
  error: ClassifiedError;
  correlationId?: string | null;
  workerId?: string | null;
};

export async function recordJobFailure(input: JobFailureInput): Promise<void> {
  await prisma.jobFailure.create({
    data: {
      jobKey: input.jobKey,
      companyId: input.companyId ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      attempt: input.attempt,
      errorCode: input.error.code,
      errorMessage: input.error.message.slice(0, 500),
      retryable: input.error.retryable,
      correlationId: input.correlationId ?? null,
      workerId: input.workerId ?? null,
    },
  });
}

export type JobFailureRow = {
  id: string;
  jobKey: string;
  companyId: string | null;
  sourceType: string;
  sourceId: string | null;
  attempt: number;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  correlationId: string | null;
  failedAt: Date;
  retriedAt: Date | null;
  retriedBy: string | null;
};

export async function listJobFailures(filter: { jobKey?: string; companyId?: string; sourceId?: string; limit?: number } = {}): Promise<JobFailureRow[]> {
  return prisma.jobFailure.findMany({
    where: {
      ...(filter.jobKey ? { jobKey: filter.jobKey } : {}),
      ...(filter.companyId ? { companyId: filter.companyId } : {}),
      ...(filter.sourceId ? { sourceId: filter.sourceId } : {}),
    },
    orderBy: { failedAt: "desc" },
    take: Math.min(Math.max(filter.limit ?? 50, 1), 500),
    select: {
      id: true,
      jobKey: true,
      companyId: true,
      sourceType: true,
      sourceId: true,
      attempt: true,
      errorCode: true,
      errorMessage: true,
      retryable: true,
      correlationId: true,
      failedAt: true,
      retriedAt: true,
      retriedBy: true,
    },
  });
}

/** Notes that an operator sent these work items round again; the rows themselves stay. */
export async function markFailuresRetried(input: { sourceType: JobFailureInput["sourceType"]; sourceIds: string[]; operator: string }): Promise<void> {
  if (input.sourceIds.length === 0) return;
  await prisma.jobFailure.updateMany({
    where: { sourceType: input.sourceType, sourceId: { in: input.sourceIds }, retriedAt: null },
    data: { retriedAt: new Date(), retriedBy: input.operator.slice(0, 200) },
  });
}
