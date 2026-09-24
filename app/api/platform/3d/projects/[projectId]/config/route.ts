import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { getProject3DExperienceState, updateProject3DExperience } from "@/lib/modules/project-3d/project-3d.editor";
import { project3DExperienceUpdateSchema } from "@/lib/modules/project-3d/project-3d.schema";

export async function GET(_request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    return apiOk({ data: await getProject3DExperienceState(context, projectId) });
  });
}

export async function PUT(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DExperienceUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await updateProject3DExperience(context, projectId, input) });
  });
}
