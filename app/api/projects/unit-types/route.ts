import { apiOk, readJson, withContext } from "@/lib/api/respond";
import { createUnitTypeSchema } from "@/lib/modules/project-structure/structure.schema";
import { createUnitType, listUnitTypes } from "@/lib/modules/project-structure/unit-type.service";

/**
 * GET  /api/projects/unit-types — the company's unit types, with how many units use each (E-05B §20, §21).
 * POST /api/projects/unit-types — add one.
 *
 * Both work in the session's company and need `project.unit_type.manage`.
 */
export async function GET() {
  return withContext(async (context) => apiOk({ data: await listUnitTypes(context) }));
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createUnitTypeSchema.parse(await readJson(request));
    return apiOk({ data: await createUnitType(context, input) }, { status: 201 });
  });
}
