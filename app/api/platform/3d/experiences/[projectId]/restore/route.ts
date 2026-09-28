import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { restoreProject3DExperience } from "@/lib/modules/project-3d/project-3d.lifecycle";
import { project3DRestoreSchema } from "@/lib/modules/project-3d/project-3d.schema";

/** Restores a deleted experience, OFFLINE and with a new public link (ADM-04A §9). */
export async function POST(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  return withPlatformContext(async (context) => {
    const { projectId } = await params;
    const input = project3DRestoreSchema.parse(await readJson(request));
    return apiOk({ data: await restoreProject3DExperience(context, projectId, input) });
  });
}
