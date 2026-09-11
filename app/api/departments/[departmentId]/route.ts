import { apiOk, readJson, withContext } from "@/lib/api/respond";
import * as departments from "@/lib/modules/team/departments/department.service";
import { updateDepartmentSchema } from "@/lib/modules/team/team.schema";

type Params = { params: Promise<{ departmentId: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { departmentId } = await params;
  return withContext(async (context) =>
    apiOk({ data: await departments.getDepartment(context, departmentId) }),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { departmentId } = await params;
  return withContext(async (context) => {
    const input = updateDepartmentSchema.parse(await readJson(request));
    await departments.updateDepartment(context, departmentId, input);
    return apiOk({ data: await departments.getDepartment(context, departmentId) });
  });
}
