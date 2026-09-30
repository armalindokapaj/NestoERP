import { z } from "zod";

import { MUTATION_TYPES } from "./protocol";

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,80}$/;

/** The most operations one request carries; a device sends more in another round. */
export const MAX_BATCH = 50;

export const operationEnvelopeSchema = z.object({
  operationId: z.string().regex(OPERATION_ID),
  type: z.enum(MUTATION_TYPES),
  claimedCompanyId: z.string().regex(ID),
  projectId: z.string().regex(ID).nullable().default(null),
  target: z.object({ entityType: z.string().max(60), entityId: z.string().regex(ID) }).nullable().default(null),
  expectedVersion: z.number().int().min(1).nullable().default(null),
  payload: z.record(z.string(), z.unknown()),
  capturedAt: z.string().datetime().nullable().default(null),
});

export const batchRequestSchema = z.object({
  protocolVersion: z.number().int().min(1),
  operations: z.array(z.unknown()).min(1).max(MAX_BATCH),
});
