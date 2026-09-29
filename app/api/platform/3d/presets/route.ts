import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { createEnvironmentPreset, environmentPresetCreateSchema, listEnvironmentPresets } from "@/lib/modules/project-3d/project-3d.presets";

export async function GET() {
  return withPlatformContext(async (context) => apiOk({ data: await listEnvironmentPresets(context) }));
}

export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const input = environmentPresetCreateSchema.parse(await readJson(request));
    return apiOk({ data: await createEnvironmentPreset(context, input) }, { status: 201 });
  });
}
