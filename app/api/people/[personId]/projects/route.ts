import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { assignProjectSchema } from "@/lib/modules/people/people.schema";
import { assignableProjects, assignPersonToProject } from "@/lib/modules/people/person.projects";

type Params = { params: Promise<{ personId: string }> };

/** GET /api/people/:personId/projects — the projects this reader may put the person on (E-08 §49, §50, §64). */
export async function GET(_request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => apiOk({ data: await assignableProjects(context, personId) }));
}

/** POST /api/people/:personId/projects — puts them on one, through the project's own team door. */
export async function POST(request: Request, { params }: Params) {
  const { personId } = await params;
  return withContext(async (context) => {
    const input = assignProjectSchema.parse(await readJson(request));
    await assignPersonToProject(context, personId, input);
    return apiOk({ data: { assigned: true } }, { status: 201 });
  });
}
