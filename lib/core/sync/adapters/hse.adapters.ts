import { incidentSchema } from "@/lib/modules/hse/hse.schema";
import { createIncident } from "@/lib/modules/hse/incidents/incident.service";

import type { SyncAdapter } from "./types";

/**
 * A reported incident. Sent under the device's operation id, so a retry finds
 * the incident instead of reporting it twice. Serious incidents raise their
 * alerts here, when the server first holds them — never earlier (§50).
 */
export const hseCreate: SyncAdapter = {
  type: "HSE_CREATE",
  requiresVersion: false,
  async run(context, operation) {
    // A device clock a little ahead of the server's must not turn a just-now report into "in the future" (§73).
    const occurred = new Date(String(operation.payload.occurredAt));
    const occurredAt = Number.isFinite(occurred.getTime()) && occurred.getTime() > Date.now() ? new Date() : occurred;
    const input = incidentSchema.parse({ ...operation.payload, projectId: operation.projectId ?? undefined, occurredAt });
    const incident = await createIncident(context, input, { clientOperationId: operation.operationId });
    return { entityType: "HseIncident", entityId: incident.id };
  },
};
