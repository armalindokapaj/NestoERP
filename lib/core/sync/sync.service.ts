import { AccessError } from "@/lib/access/guards";
import type { UserContext } from "@/lib/context/types";
import { incrementCounter, Metric } from "@/lib/core/observability/metrics";
import { logger } from "@/lib/core/observability/logger";

import { SYNC_ADAPTERS } from "./adapters";
import { minimumSyncProtocolVersion, SYNC_PROTOCOL_VERSION, type SyncBatchResponse, type SyncOperationEnvelope, type SyncOperationResult } from "./protocol";
import { MAX_BATCH, operationEnvelopeSchema } from "./protocol.schema";
import { classifyFailure } from "./sync.errors";
import { findRecorded, hashOperation, recordSuccess } from "./sync.ledger";

/**
 * The server's sync dispatcher (MOB-09 §145-§149).
 *
 * It is not a second write path. Every operation is authorised as the signed-in
 * caller, then handed to the module adapter, which calls the same service the
 * ordinary API calls — state machines, permissions and audit included. One
 * operation failing never affects another (§146).
 */

function tally(type: string, outcome: string): void {
  incrementCounter(Metric.SYNC_OPERATION, { type, outcome });
}

async function applyOne(context: UserContext, raw: unknown): Promise<SyncOperationResult> {
  const rawId = typeof (raw as { operationId?: unknown })?.operationId === "string" ? (raw as { operationId: string }).operationId : "unknown";
  const parsed = operationEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    tally("invalid", "REJECTED");
    return { operationId: rawId, result: "REJECTED", errorType: "VALIDATION", code: "VALIDATION_ERROR", message: parsed.error.issues[0]?.message ?? "This change is not valid." };
  }
  const operation: SyncOperationEnvelope = parsed.data;
  const base = { operationId: operation.operationId };
  const adapter = SYNC_ADAPTERS[operation.type];

  // The device's record of which company this belongs to is not authority: the session is (§57, §100).
  if (operation.claimedCompanyId !== context.companyId) {
    tally(operation.type, "REJECTED");
    return { ...base, result: "REJECTED", errorType: "AUTH", code: "WORKSPACE_MISMATCH", message: "This change belongs to a different company than the one you are signed in to." };
  }
  if (adapter.requiresVersion && operation.expectedVersion === null) {
    tally(operation.type, "REJECTED");
    return { ...base, result: "REJECTED", errorType: "VALIDATION", code: "VERSION_REQUIRED", message: "This change must say which version it was based on." };
  }

  const payloadHash = hashOperation(operation);
  try {
    const recorded = await findRecorded(context, operation.operationId);
    if (recorded) {
      if (recorded.payloadHash !== payloadHash) {
        tally(operation.type, "REJECTED");
        return { ...base, result: "REJECTED", errorType: "VALIDATION", code: "OPERATION_ID_REUSED", message: "This operation id was already used for a different change." };
      }
      tally(operation.type, "DUPLICATE");
      return { ...base, result: "DUPLICATE", entityType: recorded.outcome.entityType, canonicalEntityId: recorded.outcome.entityId, serverVersion: recorded.outcome.serverVersion, childId: recorded.outcome.childId };
    }

    const outcome = await adapter.run(context, operation);
    const kept = await recordSuccess(context, operation, payloadHash, outcome);
    tally(operation.type, kept === "recorded" ? "APPLIED" : "DUPLICATE");
    return { ...base, result: kept === "recorded" ? "APPLIED" : "DUPLICATE", entityType: outcome.entityType, canonicalEntityId: outcome.entityId, serverVersion: outcome.serverVersion, childId: outcome.childId };
  } catch (error) {
    const failure = classifyFailure(error);
    tally(operation.type, failure.result);
    if (failure.result === "RETRY") logger.error("sync.operation_failed", { type: operation.type, code: failure.code });
    const current = failure.result === "CONFLICT" ? await adapter.describeCurrent?.(context, operation) : undefined;
    return { ...base, result: failure.result, errorType: failure.errorType, code: failure.code, message: failure.message, ...(current ? { current } : {}) };
  }
}

/** `operations` arrive as untrusted JSON; each is validated on its own so one bad entry does not sink the batch. */
export async function processSyncBatch(context: UserContext, request: { protocolVersion: number; operations: unknown[] }): Promise<SyncBatchResponse> {
  if (request.operations.length > MAX_BATCH) throw new AccessError("VALIDATION_ERROR", `Send at most ${MAX_BATCH} changes at a time.`);
  incrementCounter(Metric.SYNC_BATCH);
  const tooOld = request.protocolVersion < minimumSyncProtocolVersion();
  const results: SyncOperationResult[] = [];
  // In order: a chain the device built (create, then edit, then submit) may share a batch.
  for (const raw of request.operations) {
    if (tooOld) {
      const id = typeof (raw as { operationId?: unknown })?.operationId === "string" ? (raw as { operationId: string }).operationId : "unknown";
      results.push({ operationId: id, result: "REJECTED", errorType: "UNSUPPORTED_VERSION", code: "UNSUPPORTED_SYNC_PROTOCOL", message: "Update NESTO to sync these changes." });
      continue;
    }
    results.push(await applyOne(context, raw));
  }
  return { protocolVersion: SYNC_PROTOCOL_VERSION, serverTime: new Date().toISOString(), results };
}
