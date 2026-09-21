import { apiOk, readJson, withPlatformContext } from "@/lib/api/respond";
import { project3DExperienceCreateSchema, project3DExperienceListQuerySchema } from "@/lib/modules/project-3d/project-3d.schema";
import { createProject3DExperience, listProject3DExperiences } from "@/lib/modules/project-3d/project-3d.service";

export async function GET(request: Request) {
  return withPlatformContext(async (context) => {
    const search = Object.fromEntries(new URL(request.url).searchParams.entries());
    const query = project3DExperienceListQuerySchema.parse(search);
    return apiOk({ data: await listProject3DExperiences(context, query) });
  });
}

export async function POST(request: Request) {
  return withPlatformContext(async (context) => {
    const input = project3DExperienceCreateSchema.parse(await readJson(request));
    return apiOk({ data: await createProject3DExperience(context, input) }, { status: 201 });
  });
}
