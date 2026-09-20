import { apiOk, withPlatformContext } from "@/lib/api/respond";
import { listProject3DWorkspaces } from "@/lib/modules/project-3d/project-3d.service";

export async function GET() {
  return withPlatformContext(async (context) => apiOk({ data: await listProject3DWorkspaces(context) }));
}

