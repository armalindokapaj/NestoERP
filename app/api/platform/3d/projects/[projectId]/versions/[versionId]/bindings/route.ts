import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { getProject3DUnitBindingWorkspace, replaceProject3DUnitBindings } from "@/lib/modules/project-3d/project-3d.binding";
import { project3DUnitBindingsReplaceSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, versionId } = await params;
    return apiOk({ data: await getProject3DUnitBindingWorkspace(context, projectId, versionId) });
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string; versionId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId, versionId } = await params;
    const input = project3DUnitBindingsReplaceSchema.parse(await readJson(request));
    return apiOk({ data: await replaceProject3DUnitBindings(context, projectId, versionId, input) });
  });
}
