import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { project3DStructureCreateSchema } from "@/lib/modules/project-3d/project-3d.schema";
import { createPlatformProjectStructure, getPlatformProjectStructure } from "@/lib/modules/project-3d/project-3d.structure";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    return apiOk({ data: await getPlatformProjectStructure(context, projectId) });
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DStructureCreateSchema.parse(await readJson(request));
    return apiOk({ data: await createPlatformProjectStructure(context, projectId, input) }, { status: 201 });
  });
}
