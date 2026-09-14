import { apiOk, withContext } from "@/lib/api/respond";
import { workPackageOptions } from "@/lib/modules/work-packages/work-package.service";

type Params = { params: Promise<{ projectId: string }> };

/** GET — contractors on the project, contracts and people a work package may name (PRD #46 §37, §38). */
export async function GET(_request: Request, { params }: Params) {
  const { projectId } = await params;
  return withContext(async (context) => {
    return apiOk({ data: await workPackageOptions(context, projectId) });
  });
}
