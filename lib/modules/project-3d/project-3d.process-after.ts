import { after } from "next/server";

import { logger } from "@/lib/core/observability/logger";
import { processProject3DModelVersion, project3DProcessingInRequest } from "./project-3d.ingestion";

/**
 * Prepares one uploaded version after the current response has gone out, on a
 * deployment with no worker to do it (`project3DProcessingInRequest`). For
 * route handlers only: `after` belongs to a request, and the route's
 * `maxDuration` is how long the preparation may take.
 */
export async function prepareProject3DModelAfterResponse(versionId: string): Promise<"worker" | "request"> {
  if (!(await project3DProcessingInRequest())) return "worker";
  after(async () => {
    const outcome = await processProject3DModelVersion(versionId);
    logger.info("project3d.model.prepared_in_request", { versionId, outcome });
  });
  return "request";
}
