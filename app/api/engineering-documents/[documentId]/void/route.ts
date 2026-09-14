import { z } from "zod";

import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { retireEngineeringDocument } from "@/lib/modules/engineering/engineering.documents";
import { reason } from "@/lib/modules/engineering/engineering.fields";

type Params = { params: Promise<{ documentId: string }> };

/** POST — void the entry, or mark the whole document superseded (PRD #46 §63, §81). */
export async function POST(request: Request, { params }: Params) {
  const { documentId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = z.object({ reason, status: z.enum(["VOID", "SUPERSEDED"]).default("VOID") }).parse(await readJson(request));
    return apiOk({ data: await retireEngineeringDocument(context, documentId, input) });
  });
}
