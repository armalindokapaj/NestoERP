import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { deleteEnvironmentPreset, environmentPresetUpdateSchema, updateEnvironmentPreset } from "@/lib/modules/project-3d/project-3d.presets";

export async function PATCH(request: Request, { params }: { params: Promise<{ presetId: string }> }) {
  return withPlatformContext(async (context) => {
    const { presetId } = await params;
    const input = environmentPresetUpdateSchema.parse(await readJson(request));
    return apiOk({ data: await updateEnvironmentPreset(context, presetId, input) });
  });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ presetId: string }> }) {
  return withPlatformContext(async (context) => {
    const { presetId } = await params;
    return apiOk({ data: await deleteEnvironmentPreset(context, presetId) });
  });
}
