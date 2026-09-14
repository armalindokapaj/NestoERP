import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { archiveWorkPackageSchema } from "@/lib/modules/contractors/contractor.schema";
import { archiveWorkPackage } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ workPackageId: string }> };

/** POST — archive a closed work package (PRD #46 §215). */
export async function POST(request: Request, { params }: Params) {
  const { workPackageId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = archiveWorkPackageSchema.parse(await readJson(request));
    return apiOk({ data: await archiveWorkPackage(context, workPackageId, input) });
  });
}
