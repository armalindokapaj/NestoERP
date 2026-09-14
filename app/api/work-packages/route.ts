import { apiOk, withContext } from "@/lib/api/respond";
import { workPackageListSchema } from "@/lib/modules/contractors/contractor.schema";
import { listWorkPackages } from "@/lib/modules/work-packages/work-package.service";

/** GET — work packages across the projects this reader can open (PRD #46 §215). */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const query = workPackageListSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return apiOk({ data: await listWorkPackages(context, query) });
  });
}
