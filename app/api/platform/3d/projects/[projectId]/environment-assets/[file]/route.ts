import { withPlatformContext } from "@/lib/api/respond";
import { platformEnvironmentAsset } from "@/lib/modules/project-3d/project-3d.environment-assets";

/** An environment file for the editor and the Platform viewer. */
export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; file: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, file } = await params;
    return platformEnvironmentAsset(context, projectId, file);
  });
}
