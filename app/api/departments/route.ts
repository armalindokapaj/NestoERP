import { apiOk, readJson, withContext } from "@/lib/api/respond";
import * as departments from "@/lib/modules/team/departments/department.service";
import { createDepartmentSchema } from "@/lib/modules/team/team.schema";

export async function GET(request: Request) {
  return withContext(async (context) => {
    const includeArchived = new URL(request.url).searchParams.get("archived") === "true";
    return apiOk({ data: await departments.listDepartments(context, { includeArchived }) });
  });
}

export async function POST(request: Request) {
  return withContext(async (context) => {
    const input = createDepartmentSchema.parse(await readJson(request));
    const id = await departments.createDepartment(context, input);
    return apiOk({ data: await departments.getDepartment(context, id) }, { status: 201 });
  });
}
