import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { updateWorkPackageSchema } from "@/lib/modules/contractors/contractor.schema";
import { getWorkPackage, updateWorkPackage } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ workPackageId: string }> };

/** GET — one work package with its contractor, dates and linked work (PRD #46 §39, §215). */
export async function GET(_request: Request, { params }: Params) {
  const { workPackageId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await getWorkPackage(context, workPackageId) });
  });
}

/** PATCH — edit it; completion has its own command (PRD #46 §215). */
export async function PATCH(request: Request, { params }: Params) {
  const { workPackageId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = updateWorkPackageSchema.parse(await readJson(request));
    return apiOk({ data: await updateWorkPackage(context, workPackageId, input) });
  });
}
