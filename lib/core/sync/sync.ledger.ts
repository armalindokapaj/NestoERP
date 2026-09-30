import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";

import type { UserContext } from "@/lib/context/types";
import { prisma } from "@/lib/database/prisma";

import type { AdapterOutcome, SyncOperationEnvelope } from "./protocol";

/**
 * The operation ledger (MOB-09 §31, §82): what the server already did for a
 * device-generated operation id, kept so a retry is answered, not repeated.
 */

/** A stable hash of what the operation asks for, so one id cannot be reused for different work. */
export function hashOperation(operation: SyncOperationEnvelope): string {
  const canonical = JSON.stringify(sortKeys({ type: operation.type, projectId: operation.projectId, target: operation.target, expectedVersion: operation.expectedVersion, payload: operation.payload }));
  return createHash("sha256").update(canonical).digest("hex");
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, inner]) => [key, sortKeys(inner)]));
  }
  return value;
}

export type RecordedOperation = { payloadHash: string; outcome: AdapterOutcome };

export async function findRecorded(context: UserContext, operationId: string): Promise<RecordedOperation | null> {
  const row = await prisma.syncOperation.findUnique({
    where: { memberId_operationId: { memberId: context.membershipId, operationId } },
    select: { payloadHash: true, entityType: true, entityId: true, serverVersion: true, result: true },
  });
  if (!row) return null;
  const result = (row.result ?? {}) as { childId?: string };
  return {
    payloadHash: row.payloadHash,
    outcome: { entityType: row.entityType ?? "", entityId: row.entityId ?? "", ...(row.serverVersion === null ? {} : { serverVersion: row.serverVersion }), ...(result.childId ? { childId: result.childId } : {}) },
  };
}

/** Keeps a success. Two requests finishing the same operation at once: the second finds the first's row and is told so. */
export async function recordSuccess(context: UserContext, operation: SyncOperationEnvelope, payloadHash: string, outcome: AdapterOutcome): Promise<"recorded" | "already"> {
  try {
    await prisma.syncOperation.create({
      data: {
        companyId: context.companyId,
        memberId: context.membershipId,
        operationId: operation.operationId,
        type: operation.type,
        payloadHash,
        projectId: operation.projectId,
        entityType: outcome.entityType,
        entityId: outcome.entityId,
        serverVersion: outcome.serverVersion ?? null,
        result: { childId: outcome.childId ?? null } as Prisma.InputJsonValue,
      },
    });
    return "recorded";
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return "already";
    throw error;
  }
}
