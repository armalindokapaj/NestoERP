import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createCrew, listCrews } from "@/lib/modules/workforce/crew.service";
import { createCrewSchema } from "@/lib/modules/workforce/workforce.schema";

/**
 * GET  /api/workforce/crews — the crews this reader may see: the company's, or
 *      those on their projects (E-04 §28, §150). `?status=ARCHIVED` for old ones,
 *      `?projectId=` for one project's.
 * POST /api/workforce/crews — make one (`workforce.crew.manage`).
 */
export async function GET(request: Request) {
  return withContext(async (context) => {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") === "ARCHIVED" ? "ARCHIVED" : "ACTIVE";
    const projectId = url.searchParams.get("projectId") ?? undefined;
    const search = url.searchParams.get("search")?.trim().slice(0, 120) || undefined;
    return apiOk({ data: await listCrews(context, { status, projectId, search }) });
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createCrewSchema.parse(await readJson(request));
    return apiOk({ data: await createCrew(context, input) }, { status: 201 });
  });
}
