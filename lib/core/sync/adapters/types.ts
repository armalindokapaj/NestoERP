import type { UserContext } from "@/lib/context/types";

import type { AdapterOutcome, MutationType, SyncOperationEnvelope } from "../protocol";

/**
 * A module's side of one queued mutation type (MOB-09 §144).
 *
 * `run` calls the canonical service — it never writes a row or a status itself
 * (§148, §149). Common behaviour (authorisation of the caller, the operation
 * ledger, error classes, batching) stays in `sync.service.ts`.
 */
export type SyncAdapter = {
  type: MutationType;
  /** Whether the envelope must carry the version the device based the change on. */
  requiresVersion: boolean;
  /** Validates and normalises the payload; throws a ZodError the dispatcher reports as VALIDATION. */
  run(context: UserContext, operation: SyncOperationEnvelope): Promise<AdapterOutcome>;
  /** What the server holds now, so a conflict can say so. Never throws. */
  describeCurrent?(context: UserContext, operation: SyncOperationEnvelope): Promise<{ status?: string; version?: number } | undefined>;
};
