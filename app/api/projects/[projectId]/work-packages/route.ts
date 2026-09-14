import { apiError, apiOk, readJson, withContext } from "@/lib/api/respond";
import { checkRateLimit } from "@/lib/core/security/rate-limit";
import { createWorkPackageSchema, workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { createWorkPackage, listProjectWorkPackages } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — the project's work packages (PRD #46 §39, §215). */
export async function GET(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    const query = workPackageListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listProjectWorkPackages(context, projectId, query) });
  });
}

/** POST — add a work package (PRD #46 §33, §215). */
export async function POST(request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    if (!checkRateLimit("WRITE", context.membershipId).allowed) return apiError("VALIDATION_ERROR", "Too many changes at once. Try again shortly.");
    const input = createWorkPackageSchema.parse(await readJson(request));
    return apiOk({ data: await createWorkPackage(context, projectId, input) }, { status: 201 });
  });
}
