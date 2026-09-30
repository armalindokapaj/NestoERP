import { withContext } from "@/lib/api/respond";
import { companyEnvironmentAsset } from "@/lib/modules/project-3d/project-3d.environment-assets";

/** An environment file the published release uses, for a signed-in company viewer. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; file: string }> }) {
  return withContext(async (context) => {
    const { projectId, file } = await params;
    return companyEnvironmentAsset(context, projectId, file);
  });
}
