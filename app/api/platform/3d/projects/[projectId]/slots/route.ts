import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createProject3DModelSlot } from "@/lib/modules/project-3d/project-3d.ingestion";
import { project3DSlotCreateSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DSlotCreateSchema.parse(await readJson(request));
    return apiOk({ data: await createProject3DModelSlot(context, projectId, input) }, { status: 201 });
  });
}

