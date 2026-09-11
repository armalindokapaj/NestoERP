import { withContext } from "@/lib/api/respond";
import * as departments from "@/lib/modules/team/departments/department.service";

type Params = { params: Promise<{ departmentId: string }> };

/** Archiving is blocked while active members remain (PRD #14 §123). */
export async function POST(_request: Request, { params }: Params) {
  const { departmentId } = await params;
  return withContext(async (context) => {
    await departments.archiveDepartment(context, departmentId);
    return new Response(null, { status: 204 });
  });
}
