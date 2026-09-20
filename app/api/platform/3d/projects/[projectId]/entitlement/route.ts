import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { project3DEntitlementUpdateSchema } from "@/lib/modules/project-3d/project-3d.schema";
import { updateProject3DEntitlement } from "@/lib/modules/project-3d/project-3d.service";

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DEntitlementUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await updateProject3DEntitlement(context, projectId, input) });
  });
}
